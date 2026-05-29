const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const appRoot = path.resolve(__dirname, "..", "..", "App");
const qaFile = path.join(os.tmpdir(), "baad-qa-accounts.txt");
const port = Number(process.env.BAAD_LOCAL_QA_PORT || 4317);
const configuredAppUrl = (process.env.BAAD_BROWSER_QA_APP_URL || "").replace(/\/$/, "");
const baseUrl = configuredAppUrl || `http://127.0.0.1:${port}`;
const allowLocalMutation = process.env.BAAD_ALLOW_LOCAL_BROWSER_QA_MUTATION === "1";

function parseQaFile() {
  const values = {};
  if (fs.existsSync(qaFile)) {
    for (const line of fs.readFileSync(qaFile, "utf8").split(/\r?\n/)) {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) values[match[1].trim()] = match[2].trim();
    }
  }
  return values;
}

function requireValue(value, name) {
  if (!value) throw new Error(`${name} is required for browser QA.`);
  return value;
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
  }[extension] || "application/octet-stream";
}

function startStaticServer() {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, baseUrl);
    const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
    const target = path.resolve(appRoot, `.${decodeURIComponent(pathname)}`);
    if (!target.startsWith(appRoot)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    fs.readFile(target, (error, data) => {
      if (error) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      response.writeHead(200, { "Content-Type": contentType(target) });
      response.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function createQaFiles(runId, prefix = "baad-qa-upload") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "baad-browser-qa-"));
  const pngPath = path.join(dir, `${prefix}-${runId}.png`);
  const pdfPath = path.join(dir, `${prefix}-${runId}.pdf`);
  const samplePdfPath = path.join(appRoot, "samples", "sample_requirements_pack.pdf");
  const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
  fs.writeFileSync(pngPath, Buffer.from(onePixelPng, "base64"));
  fs.copyFileSync(samplePdfPath, pdfPath);
  return { dir, files: [pngPath, pdfPath] };
}

function futureDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function appRoute(hash) {
  return configuredAppUrl ? `${baseUrl}/#${hash}` : `${baseUrl}/index.html#${hash}`;
}

async function waitForApp(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
  await page.waitForSelector("#passwordLoginEmail", { timeout: 30000 });
}

async function pickFirstWorkspaceContext(page) {
  await page.waitForFunction(() => {
    const options = Array.from(document.querySelectorAll("#clientUploadContext option"));
    return options.some((option) => option.value && option.value !== "workspace:");
  }, null, { timeout: 30000 });
  const value = await page.evaluate(() => {
    const options = Array.from(document.querySelectorAll("#clientUploadContext option"));
    const usable = options.find((option) => option.value && option.value !== "workspace:");
    return usable ? usable.value : "";
  });
  if (!value) throw new Error("No project or work item was available in the upload context list.");
  await page.selectOption("#clientUploadContext", value);
  return value;
}

async function pickWorkspaceContextContaining(page, text) {
  await page.waitForFunction(() => {
    const options = Array.from(document.querySelectorAll("#clientUploadContext option"));
    return options.some((option) => option.value && option.value !== "workspace:");
  }, null, { timeout: 30000 });
  const value = await page.evaluate((expectedText) => {
    const options = Array.from(document.querySelectorAll("#clientUploadContext option"));
    const requestOption = options.find((option) => option.value.startsWith("request:") && (option.textContent || "").includes(expectedText));
    const projectOption = options.find((option) => (option.textContent || "").includes(expectedText));
    return requestOption?.value || projectOption?.value || "";
  }, text);
  if (!value) throw new Error(`No workspace context was available for ${text}.`);
  await page.selectOption("#clientUploadContext", value);
  return value;
}

async function expectUploadValidation(page, pattern, label) {
  await page.click("#clientUploadForm button[type='submit']");
  await page.waitForTimeout(500);
  const feedback = await page.evaluate(() => [
    document.querySelector("#clientUploadStatus")?.textContent || "",
    document.querySelector("#toastText")?.textContent || "",
    ...Array.from(document.querySelectorAll("#clientUploadForm .field-error-note")).map((item) => item.textContent || ""),
  ].join(" "));
  if (!pattern.test(feedback)) {
    throw new Error(`${label} did not show the expected validation message. Feedback: ${feedback || "none"}`);
  }
  const busy = await page.getAttribute("#clientUploadForm button[type='submit']", "data-busy");
  if (busy === "true") {
    throw new Error(`${label} left the upload button in a busy state.`);
  }
}

async function removeUploadedFile(page, fileName) {
  await page.evaluate((name) => {
    const rows = Array.from(document.querySelectorAll(".workspace-file-row"));
    const row = rows.find((item) => item.textContent.includes(name));
    const button = row?.querySelector("[data-delete-source-file]");
    if (!button) throw new Error(`Remove button was not available for ${name}.`);
    button.click();
  }, fileName);
  try {
    await page.waitForFunction((name) => {
      const rows = Array.from(document.querySelectorAll(".workspace-file-row"));
      return !rows.some((item) => item.textContent.includes(name));
    }, fileName, { timeout: 30000 });
  } catch (error) {
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll(".workspace-file-row")).map((item) => item.textContent.trim()));
    const status = await page.textContent("#clientUploadStatus").catch(() => "");
    throw new Error(`Removed file still appeared in the client file list: ${fileName}. Status: ${status || "none"}. Rows: ${rows.join(" | ") || "none"}`);
  }
}

async function expectUploadedFileRows(page, fileNames) {
  await page.evaluate(() => {
    const filePanel = document.querySelector("#clientWorkspaceFiles");
    if (filePanel) filePanel.open = true;
  });
  try {
    await page.waitForFunction((names) => {
      const rows = Array.from(document.querySelectorAll(".workspace-file-row"));
      return names.every((name) => rows.some((item) => item.textContent.includes(name)));
    }, fileNames, { timeout: 30000 });
  } catch (error) {
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll(".workspace-file-row")).map((item) => item.textContent.trim()));
    throw new Error(`Uploaded files did not appear in the client file list. Rows: ${rows.join(" | ") || "none"}`);
  }
}

async function selectOptionContainingText(page, selector, text) {
  await page.waitForFunction(
    ({ selector: selectSelector, text: expectedText }) => {
      const select = document.querySelector(selectSelector);
      if (!select) return false;
      return Array.from(select.options).some((item) => (item.textContent || "").includes(expectedText));
    },
    { selector, text },
    { timeout: 30000 }
  ).catch(() => null);
  const value = await page.evaluate(
    ({ selector: selectSelector, text: expectedText }) => {
      const select = document.querySelector(selectSelector);
      if (!select) return "";
      const option = Array.from(select.options).find((item) => (item.textContent || "").includes(expectedText));
      return option?.value || "";
    },
    { selector, text }
  );
  if (!value) {
    throw new Error(`No option containing "${text}" was available in ${selector}.`);
  }
  await page.selectOption(selector, value);
  return value;
}

async function runNewProjectRequestQa(page, runId) {
  const requestFiles = createQaFiles(runId, "baad-qa-request");
  const projectName = `Browser QA Project ${runId}`;
  const requestType = "Requirements clarity package";

  try {
    await page.goto(appRoute("request"), { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("#requestForm", { timeout: 30000 });
    await page.waitForSelector("#view-request.active", { timeout: 30000 });
    await page.waitForSelector("#requestSubmitButton:visible", { timeout: 30000 });
    await page.selectOption("#requestProjectSelect", "__new__");
    await page.fill("#requestProjectName", projectName);
    await page.selectOption("#requestCreditEstimate", "1");
    await page.fill("#businessGoal", `Validate project scoped request and file upload ${runId}.`);
    await page.fill("#targetAudience", "Browser QA reviewer");
    await page.fill("#desiredOutput", "A requirements clarity package that proves project scoped intake works.");
    await page.fill("#decisionDeadline", futureDate(7));
    await page.setInputFiles("#fileUpload", requestFiles.files);
    await page.fill("#attachmentDescription", `Two source files for project scoped browser QA ${runId}.`);
    await page.click("#requestSubmitButton");

    await page.waitForFunction(() => {
      const status = document.querySelector("#requestStatus")?.textContent || "";
      const toast = document.querySelector("#toastText")?.textContent || "";
      return /request received|file upload needs attention|could not|insufficient|verify enough|please open billing/i.test(`${status} ${toast}`);
    }, null, { timeout: 180000 });

    const requestStatus = await page.textContent("#requestStatus").catch(() => "");
    const toastText = await page.textContent("#toastText").catch(() => "");
    const combinedStatus = `${requestStatus || ""} ${toastText || ""}`;
    if (!/request received/i.test(combinedStatus)) {
      throw new Error(`Project request did not complete successfully. URL: ${page.url()}. Status: ${combinedStatus || "none"}`);
    }

    await page.goto(appRoute("dashboard"), { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("#clientProjectFilter", { timeout: 30000 });
    await selectOptionContainingText(page, "#clientProjectFilter", projectName);
    await page.waitForTimeout(750);

    const projectVisible = await page.textContent("#clientProjectFocusTitle");
    if (!projectVisible || !projectVisible.includes(projectName)) {
      throw new Error(`Client project focus did not switch to ${projectName}.`);
    }

    const requestRows = await page.textContent("#requestTable tbody");
    if (!requestRows || !requestRows.includes(requestType)) {
      throw new Error(`The new project request was not visible in the client request table. Rows: ${requestRows || "none"}`);
    }

    await expectUploadedFileRows(page, [`baad-qa-request-${runId}.png`, `baad-qa-request-${runId}.pdf`]);
    if (configuredAppUrl) {
      await removeUploadedFile(page, `baad-qa-request-${runId}.png`);
      await removeUploadedFile(page, `baad-qa-request-${runId}.pdf`);
    }
    return { projectName, requestType };
  } finally {
    fs.rmSync(requestFiles.dir, { recursive: true, force: true });
  }
}

async function run() {
  if (!configuredAppUrl && !allowLocalMutation) {
    throw new Error("Set BAAD_BROWSER_QA_APP_URL to the deployed site for authenticated upload QA. Local static mode cannot clean up server-backed upload records.");
  }

  const qa = parseQaFile();
  const email = requireValue(process.env.BAAD_QA_CLIENT_EMAIL || qa.client, "BAAD_QA_CLIENT_EMAIL");
  const password = requireValue(process.env.BAAD_QA_CLIENT_PASSWORD || qa.password, "BAAD_QA_CLIENT_PASSWORD");
  const runId = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const { dir, files } = createQaFiles(runId);
  const server = configuredAppUrl ? null : await startStaticServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("dialog", (dialog) => dialog.accept());

  try {
    await page.goto(appRoute("login"), { waitUntil: "domcontentloaded", timeout: 30000 });
    await waitForApp(page);

    const appScript = await page.getAttribute("script[src*='app.js']", "src");
    const cacheVersion = Number((appScript || "").match(/[?&]v=(\d+)/)?.[1] || 0);
    if (!appScript || cacheVersion < 24) {
      throw new Error(`Expected app.js cache version v=24 or newer, found ${appScript || "none"}.`);
    }

    await page.fill("#passwordLoginEmail", email);
    await page.fill("#passwordLoginPassword", password);
    await page.click("#passwordSignInForm button[type='submit']");
    await page.waitForFunction(() => {
      const routeReady = ["#dashboard", "#admin"].includes(window.location.hash);
      const clientReady = Boolean(document.querySelector("#clientName")?.textContent?.trim());
      return routeReady && clientReady;
    }, null, { timeout: 45000 });

    const requestQa = await runNewProjectRequestQa(page, runId);

    await page.goto(appRoute("messages"), { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("#clientUploadForm", { timeout: 30000 });
    await expectUploadValidation(page, /select at least one file|complete the highlighted upload fields/i, "Empty upload validation");
    if (requestQa?.projectName) {
      await pickWorkspaceContextContaining(page, requestQa.projectName);
    } else {
      await pickFirstWorkspaceContext(page);
    }
    await expectUploadValidation(page, /select at least one file/i, "Missing file validation");
    await page.selectOption("#clientUploadPurpose", "Revision notes");
    await page.fill("#clientUploadNotes", `Browser QA upload ${runId}`);
    await page.setInputFiles("#clientUploadFiles", files);
    await page.click("#clientUploadForm button[type='submit']");

    await page.waitForFunction(() => {
      const status = document.querySelector("#clientUploadStatus")?.textContent || "";
      return /uploaded and attached|could not|stopped|too long|try again/i.test(status);
    }, null, { timeout: 180000 });

    const uploadStatus = await page.textContent("#clientUploadStatus");
    if (!/uploaded and attached/i.test(uploadStatus || "")) {
      throw new Error(`Client upload did not complete successfully. Status: ${uploadStatus}`);
    }

    await expectUploadedFileRows(page, [`baad-qa-upload-${runId}.png`, `baad-qa-upload-${runId}.pdf`]);
    if (configuredAppUrl) {
      await removeUploadedFile(page, `baad-qa-upload-${runId}.png`);
      await removeUploadedFile(page, `baad-qa-upload-${runId}.pdf`);
    }

    await page.goto(appRoute("billing"), { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("#billingCreditBalance", { timeout: 30000 });

    await page.click("[data-sign-out]");
    await page.waitForSelector("#passwordLoginEmail", { timeout: 30000 });

    console.log(`PASS | Browser client journey | project request, upload, billing, and sign out passed for QA run ${runId}`);
  } finally {
    await browser.close().catch(() => null);
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(`FAIL | Browser client journey | ${error.stack || error.message}`);
  process.exit(1);
});
