#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const APP_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const DEFAULT_ENV_FILE = "/home/codexbot/.codex/project-env/ba-advisory-desk.env";
const DEFAULT_SUPABASE_URL = "https://ydkehgqitnxmvqoicxwu.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_uPALQNXCxAUarwj9lCSnpg_WtJifDRe";
const SERVICE_KEY = "procurement_response_engine";
const USER_PASSWORD = `Qa${crypto.randomBytes(10).toString("hex")}!2026`;
const runStamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const runId = `qa-${runStamp}-${crypto.randomBytes(3).toString("hex")}`;
const orgName = `ZZ QA BidProposal ${runId}`;
const existingOrgName = `ZZ QA Existing Client ${runId}`;
const checks = [];
const created = { users: {}, orgs: {}, requests: {}, deliverables: {} };

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(process.env.BAAD_ENV_FILE || DEFAULT_ENV_FILE);
loadEnvFile(path.join(APP_ROOT, ".env.local"));
loadEnvFile(path.join(APP_ROOT, ".env"));

const appUrl = String(process.env.QA_APP_URL || process.env.PUBLIC_BASE_URL || "https://baadvisorydesk.com").replace(/\/$/, "");
const supabaseUrl = String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, "");
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is required.");
  process.exit(2);
}

const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function log(message, detail = null) {
  const suffix = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[${new Date().toISOString()}] ${message}${suffix}`);
}

function record(name, passed, detail = "") {
  checks.push({ name, passed: Boolean(passed), detail: String(detail || "") });
  const mark = passed ? "PASS" : "FAIL";
  console.log(`${mark} ${name}${detail ? ` | ${detail}` : ""}`);
  if (!passed) {
    const error = new Error(`${name}: ${detail || "check failed"}`);
    error.qaFailure = true;
    throw error;
  }
}

async function api(pathname, options = {}) {
  const method = options.method || (options.body ? "POST" : "GET");
  const headers = { ...(options.headers || {}) };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const response = await fetch(`${appUrl}${pathname}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const contentType = response.headers.get("content-type") || "";
  if (options.binary) {
    return { response, status: response.status, buffer: Buffer.from(await response.arrayBuffer()), contentType };
  }
  const text = await response.text();
  let data = null;
  if (contentType.includes("application/json")) {
    try {
      data = JSON.parse(text || "{}");
    } catch {
      data = null;
    }
  }
  return { response, status: response.status, data, text, contentType };
}

async function createAuthUser(label, confirmed = true) {
  const email = `baad.${label}.${runId}@baadvisorydesk.com`.toLowerCase();
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: USER_PASSWORD,
    email_confirm: confirmed,
    user_metadata: {
      email_verified: confirmed,
      qa_run: runId,
    },
  });
  if (error) throw error;
  created.users[label] = { id: data.user.id, email };
  return { id: data.user.id, email, password: USER_PASSWORD };
}

async function signIn(user) {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) throw error;
  return { client, token: data.session.access_token, userId: data.user.id };
}

async function makeAdmin() {
  const admin = await createAuthUser("admin", true);
  await service.from("profiles").upsert({
    id: admin.id,
    auth_email: admin.email,
    auth_provider: "email",
    email_verified: true,
    first_name: "QA",
    last_name: "Admin",
    work_email: admin.email,
    role: "admin",
    updated_at: new Date().toISOString(),
  });

  const { data: existing, error: findError } = await service
    .from("admin_sso_allowlist")
    .select("id")
    .eq("email", admin.email)
    .maybeSingle();
  if (findError) throw findError;
  if (existing?.id) {
    const { error } = await service
      .from("admin_sso_allowlist")
      .update({ status: "active", provider: "email", note: `Live QA ${runId}` })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await service.from("admin_sso_allowlist").insert({
      email: admin.email,
      provider: "email",
      status: "active",
      note: `Live QA ${runId}`,
    });
    if (error) throw error;
  }
  return { ...admin, ...(await signIn(admin)) };
}

async function saveWorkspaceProfile(client, user, options = {}) {
  const { data, error } = await client.rpc("save_client_workspace_profile_v2", {
    p_org_name: options.orgName,
    p_industry: options.industry || "Recruiting and staffing",
    p_country: "Canada",
    p_timezone: "America/Toronto",
    p_company_type: "Recruiting firm",
    p_billing_email: options.billingEmail || user.email,
    p_first_name: options.firstName || "QA",
    p_last_name: options.lastName || "Recruiter",
    p_work_email: user.email,
    p_phone: "613-555-0100",
    p_job_title: options.jobTitle || "Recruiter",
    p_department: "Delivery",
    p_preferred_working_style: "Secure workspace with clear package status.",
    p_primary_business_need: "Prepare candidate bid packages faster.",
    p_join_existing: Boolean(options.joinExisting),
    p_service_interest: options.serviceInterest || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

async function findMember(profileId, organizationId) {
  const { data, error } = await service
    .from("client_organization_members")
    .select("id,organization_id,profile_id,role,status,service_interest")
    .eq("profile_id", profileId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function approveMember(adminToken, memberId, role = "recruiter") {
  const result = await api("/api/organization-members", {
    token: adminToken,
    body: { memberId, status: "active", role },
  });
  record(`approve member as ${role}`, result.status === 200, result.text);
  return result.data.member;
}

async function setMemberStatus(adminToken, memberId, status, role = "recruiter") {
  return api("/api/organization-members", {
    token: adminToken,
    body: { memberId, status, role },
  });
}

async function requestAccess(token, note) {
  return api("/api/response-engine-access", {
    token,
    body: { note },
  });
}

async function approveAccess(adminToken, organizationId, credits, notes = "QA pilot credits") {
  return api("/api/response-engine-access", {
    token: adminToken,
    body: {
      adminAction: true,
      action: "approve",
      organizationId,
      credits,
      notes,
      idempotencyKey: `qa-${runId}-${organizationId}-${credits}`,
    },
  });
}

async function responseBalance(organizationId) {
  const { data, error } = await service
    .from("response_credit_balance_summary")
    .select("balance,reserved_balance,available_balance,status")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return {
    balance: Number(data?.balance || 0),
    reservedBalance: Number(data?.reserved_balance || 0),
    availableBalance: Number(data?.available_balance || 0),
    status: data?.status || "missing",
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data || ""), "utf8");
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const localDirectory = Buffer.concat(localParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localDirectory.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localDirectory, centralDirectory, eocd]);
}

function xml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function officeProps(title) {
  return {
    core: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title><dc:creator>BA Advisory Desk</dc:creator><cp:lastModifiedBy>BA Advisory Desk</cp:lastModifiedBy></cp:coreProperties>`,
    app: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>BA Advisory Desk</Application><Company>BA Advisory Desk</Company><Manager>BA Advisory Desk</Manager></Properties>`,
  };
}

function docxBuffer(text, title = "BA Advisory Desk QA Document") {
  const props = officeProps(title);
  const paragraphs = String(text || "").split(/\r?\n/).map((line) => `<w:p><w:r><w:t>${xml(line)}</w:t></w:r></w:p>`).join("");
  return zipBuffer([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: "word/document.xml", data: `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>` },
    { name: "docProps/core.xml", data: props.core },
    { name: "docProps/app.xml", data: props.app },
  ]);
}

function xlsxBuffer(rows, title = "BA Advisory Desk QA Workbook") {
  const props = officeProps(title);
  const sheetRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, cellIndex) => {
    const col = String.fromCharCode(65 + cellIndex);
    return `<c r="${col}${rowIndex + 1}" t="inlineStr"><is><t>${xml(cell)}</t></is></c>`;
  }).join("")}</row>`).join("");
  return zipBuffer([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Criteria Map" sheetId="1" r:id="r1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
    { name: "xl/worksheets/sheet1.xml", data: `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>` },
    { name: "docProps/core.xml", data: props.core },
    { name: "docProps/app.xml", data: props.app },
  ]);
}

function pptxBuffer(text) {
  return zipBuffer([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>` },
    { name: "ppt/presentation.xml", data: `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst/></p:presentation>` },
    { name: "ppt/slides/slide1.xml", data: `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>${xml(text)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>` },
  ]);
}

function pdfBuffer(text) {
  return Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n2 0 obj << /Length ${text.length} >> stream\n${text}\nendstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`, "utf8");
}

function makeSourceFiles() {
  const longDescription = `${"Mandatory evidence notes. ".repeat(60)}End.`;
  return [
    {
      name: "Candidate Resume Jordan Lee.docx",
      role: "candidate_resume",
      description: "Original candidate resume with business analysis, procurement, and stakeholder work.",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      data: docxBuffer("Jordan Lee resume. Senior Business Analyst. Requirements workshops. Process mapping. User stories. Acceptance criteria. UAT support.", "Candidate Resume"),
    },
    {
      name: "Opportunity Statement of Work.pdf",
      role: "rfp_sow",
      description: "Opportunity SOW requiring public sector business analysis, mandatory criteria, and rated examples.",
      contentType: "application/pdf",
      data: pdfBuffer("Statement of Work. The supplier must show business analysis, stakeholder engagement, process modelling, user stories, and public sector delivery."),
    },
    {
      name: "Mandatory Criteria Grid.xlsx",
      role: "mandatory_grid",
      description: longDescription,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      data: xlsxBuffer([
        ["Criterion", "Requirement", "Evidence"],
        ["M1", "Five years of business analysis", "Resume experience"],
        ["M2", "Requirements documentation and traceability", "Project examples"],
      ], "Mandatory Criteria"),
    },
    {
      name: "Rated Criteria Notes.pptx",
      role: "rated_grid",
      description: "Rated scoring notes for stakeholder facilitation and requirements quality.",
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      data: pptxBuffer("Rated criteria. Stakeholder engagement. Process analysis. Documentation quality."),
    },
    {
      name: "Client Resume Template.docx",
      role: "client_template",
      description: "Client requested resume template for final formatting.",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      data: docxBuffer("Client template. Candidate name. Role summary. Project experience. Fit-Gap Assessment.", "Client Template"),
    },
    {
      name: "Recruiter Email Instructions.pdf",
      role: "unexpected_custom_role",
      description: "Recruiter email saved as PDF with submission instructions. The role is intentionally invalid for normalization testing.",
      contentType: "application/pdf",
      data: pdfBuffer("Recruiter instructions. Keep claims factual. Include fit gap notes for recruiter follow-up."),
    },
  ];
}

async function createPackage(token, options = {}) {
  return api("/api/response-engine-package", {
    token,
    body: {
      action: "create",
      packageTitle: options.packageTitle || `QA Candidate Submission ${runId}`,
      candidateName: options.candidateName || "Jordan Lee",
      targetRole: options.targetRole || "Senior Business Analyst",
      opportunityName: options.opportunityName || "Public Sector Requirements Support",
      notes: options.notes || "Use only the uploaded evidence. Flag visible gaps for recruiter follow-up.",
      deadline: "2026-06-15",
      outputOptions: options.outputOptions || ["polished_resume", "mandatory_matrix", "rated_matrix", "combined_grid", "client_template"],
      outputFormats: options.outputFormats || ["docx", "xlsx", "uploaded_template"],
    },
  });
}

async function uploadFiles(client, userId, requestId, organizationId, projectId, token, files) {
  const fileRecords = [];
  for (const [index, file] of files.entries()) {
    const cleanName = file.name.replace(/[^a-zA-Z0-9._ -]+/g, "_");
    const storagePath = `${userId}/response-engine/${requestId}/${crypto.randomUUID()}-${index + 1}-${cleanName}`;
    const { error } = await client.storage.from("client-files").upload(storagePath, file.data, {
      contentType: file.contentType,
      upsert: false,
    });
    if (error) throw error;
    fileRecords.push({
      storagePath,
      fileName: file.name,
      fileSizeBytes: file.data.length,
      contentType: file.contentType,
      fileRole: file.role,
      fileDescription: file.description,
    });
  }
  const result = await api("/api/source-file-finalize", {
    token,
    body: {
      action: "finalize",
      fileKind: "request_file",
      organizationId,
      projectId,
      requestId,
      files: fileRecords,
    },
  });
  return { result, fileRecords };
}

async function queuePackage(token, requestId) {
  return api("/api/response-engine-package", {
    token,
    body: { action: "queue", requestId },
  });
}

async function cancelPackage(token, requestId, reason) {
  return api("/api/response-engine-package", {
    token,
    body: { action: "cancel", requestId, reason },
  });
}

async function writeMockProvider() {
  const mockPath = path.join(os.tmpdir(), `baad-response-mock-${runId}.mjs`);
  const source = String.raw`#!/usr/bin/env node
import fsp from "node:fs/promises";
import path from "node:path";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function zipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data || ""), "utf8");
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const localDirectory = Buffer.concat(localParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12); eocd.writeUInt32LE(localDirectory.length, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localDirectory, centralDirectory, eocd]);
}
function xml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function props(title) {
  return {
    core: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' + xml(title) + '</dc:title><dc:creator>BA Advisory Desk</dc:creator><cp:lastModifiedBy>BA Advisory Desk</cp:lastModifiedBy></cp:coreProperties>',
    app: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>BA Advisory Desk</Application><Company>BA Advisory Desk</Company><Manager>BA Advisory Desk</Manager></Properties>',
  };
}
function docx(text, title) {
  const p = props(title);
  const body = text.split(/\r?\n/).map((line) => '<w:p><w:r><w:t>' + xml(line) + '</w:t></w:r></w:p>').join("");
  return zipBuffer([
    { name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>' },
    { name: "_rels/.rels", data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: "word/document.xml", data: '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '</w:body></w:document>' },
    { name: "docProps/core.xml", data: p.core },
    { name: "docProps/app.xml", data: p.app },
  ]);
}
function xlsx(rows, title) {
  const p = props(title);
  const sheetRows = rows.map((row, r) => '<row r="' + (r + 1) + '">' + row.map((cell, c) => '<c r="' + String.fromCharCode(65 + c) + (r + 1) + '" t="inlineStr"><is><t>' + xml(cell) + '</t></is></c>').join("") + '</row>').join("");
  return zipBuffer([
    { name: "[Content_Types].xml", data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>' },
    { name: "_rels/.rels", data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: "xl/workbook.xml", data: '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Criteria Map" sheetId="1" r:id="r1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>' },
    { name: "xl/_rels/workbook.xml.rels", data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: "xl/worksheets/sheet1.xml", data: '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + sheetRows + '</sheetData></worksheet>' },
    { name: "docProps/core.xml", data: p.core },
    { name: "docProps/app.xml", data: p.app },
  ]);
}
const jobDir = process.env.RESPONSE_ENGINE_JOB_DIR || process.cwd();
const manifest = JSON.parse(await fsp.readFile(path.join(jobDir, "manifest", "job.json"), "utf8"));
await fsp.mkdir(path.join(jobDir, "outputs"), { recursive: true });
await fsp.mkdir(path.join(jobDir, "manifest"), { recursive: true });
const sourceNames = (manifest.files || []).map((file) => file.fileName);
const resumeText = [
  "Candidate Resume Package",
  "Candidate: " + manifest.candidateName,
  "Target role: " + manifest.targetRole,
  "Profile summary",
  "Jordan Lee has business analysis experience across requirements workshops, process mapping, user stories, acceptance criteria, traceability, and user acceptance support.",
  "Selected evidence",
  "The source package supports stakeholder engagement, requirements documentation, public sector delivery, and criteria mapping.",
  "Fit-Gap Assessment",
  "Strong matches: business analysis, stakeholder workshops, requirements documentation, process mapping, and UAT support.",
  "Visible gaps: the recruiter should confirm exact dates, contract values, tool versions, and named client environments before final submission.",
  "Recruiter follow-up questions: confirm the number of years for each mandatory criterion and ask the candidate for one concise example for each rated criterion."
].join("\n");
const gridRows = [
  ["Criterion", "Status", "Mapped evidence", "Recruiter action"],
  ["M1 Business analysis experience", "Supported", sourceNames.join(", "), "Confirm exact years with candidate"],
  ["M2 Requirements traceability", "Supported", sourceNames.join(", "), "Confirm artifact names"],
  ["R1 Stakeholder facilitation", "Strong", sourceNames.join(", "), "Ask for one project example"],
  ["Fit-Gap Assessment", "Included", "Strong matches and visible gaps are listed in the resume package", "Review with candidate before external use"]
];
await fsp.writeFile(path.join(jobDir, "outputs", "candidate-resume-package.docx"), docx(resumeText, "Candidate Resume Package"));
await fsp.writeFile(path.join(jobDir, "outputs", "criteria-mapping-grid.xlsx"), xlsx(gridRows, "Criteria Mapping Grid"));
const outputManifest = {
  status: "ready",
  summary: "Candidate package completed with factual evidence mapping and recruiter fit-gap notes.",
  files: [
    { relativePath: "outputs/candidate-resume-package.docx", fileName: "Candidate Resume Package.docx", label: "Polished candidate resume" },
    { relativePath: "outputs/criteria-mapping-grid.xlsx", fileName: "Criteria Mapping Grid.xlsx", label: "Criteria mapping grid" }
  ]
};
const qa = {
  score: 9.2,
  summary: "Package cleared evidence, wording, metadata, and formatting checks.",
  hardGateFailures: [],
  qualityChecks: {
    sourceReviewComplete: true,
    evidenceTraceability: true,
    mandatoryCriteriaIntegrity: true,
    ratedCriteriaCoverage: true,
    keywordCoverage: true,
    industryTerminology: true,
    humanWrittenResumeTone: true,
    noEmDashOrEnDash: true,
    noGenericAiLanguage: true,
    resumeFitGapAssessment: true,
    consultingGradeFormatting: true,
    gridPresentationQuality: true,
    naturalLanguageQuality: true,
    metadataAndTraceCleanup: true,
    formatAndTraceCleanup: true,
    independentFinalQA: true
  },
  subagentUsage: {
    mode: "six-specialist-workstreams",
    subagentsUsed: Math.min(6, Number(manifest.orchestrationPolicy?.maxSubagents || 6)),
    roles: (manifest.orchestrationPolicy?.roles || []).map((item) => item.role).slice(0, 6)
  },
  factualGrounding: {
    allClientClaimsSupported: true,
    noUnsupportedClaims: true,
    evidenceMapReviewed: true
  },
  sourceFileCoverage: {
    allUploadedFilesReviewed: true,
    filesReviewed: sourceNames
  },
  keywordCoverage: {
    mandatoryAndRatedKeywordsCovered: true,
    criteriaKeywordsUsedNaturally: true
  },
  industryTerminology: {
    terminologySubstantiated: true
  },
  humanEditorialReview: {
    humanWrittenTone: true,
    noGenericAiLanguage: true,
    noEmDashOrEnDash: true
  },
  fitGapAssessment: {
    includedInResumePackage: true,
    strongMatches: ["business analysis", "requirements documentation", "stakeholder workshops"],
    visibleGaps: ["exact dates", "tool versions", "named environments"]
  },
  formattingQuality: {
    consultingGradeDocuments: true,
    gridPresentationQuality: true
  },
  metadataReview: {
    baAdvisoryDeskMetadataApplied: true,
    restrictedTermsRemoved: true
  }
};
const evidenceMap = {
  claims: [
    { claim: "Candidate has business analysis experience.", sourceFiles: sourceNames },
    { claim: "Fit gap notes require recruiter follow-up on dates and tools.", sourceFiles: sourceNames }
  ],
  criteriaMappings: [
    { criterion: "M1", requirement: "Business analysis experience", met: true, sourceFiles: sourceNames },
    { criterion: "M2", requirement: "Requirements documentation and traceability", met: true, sourceFiles: sourceNames }
  ]
};
await fsp.writeFile(path.join(jobDir, "manifest", "output-manifest.json"), JSON.stringify(outputManifest, null, 2));
await fsp.writeFile(path.join(jobDir, "manifest", "qa-report.json"), JSON.stringify(qa, null, 2));
await fsp.writeFile(path.join(jobDir, "manifest", "evidence-map.json"), JSON.stringify(evidenceMap, null, 2));
console.log(JSON.stringify({ ok: true, files: outputManifest.files.length }));
`;
  await fsp.writeFile(mockPath, source, { mode: 0o755 });
  await fsp.chmod(mockPath, 0o755).catch(() => null);
  return mockPath;
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || APP_ROOT,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}`.trim() }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function runWorkerForQueuedJob(requestId) {
  const { data: job, error } = await service
    .from("response_engine_jobs")
    .select("id,status")
    .eq("request_id", requestId)
    .maybeSingle();
  if (error) throw error;
  record("queued job exists", Boolean(job?.id && job.status === "queued"), JSON.stringify(job || {}));
  await service
    .from("response_engine_jobs")
    .update({ queued_at: "1900-01-01T00:00:00.000Z" })
    .eq("id", job.id);
  const mockPath = await writeMockProvider();
  const jobRoot = path.join(os.tmpdir(), `baad-response-jobs-${runId}`);
  const nodeBin = process.env.QA_NODE_BIN || (fs.existsSync("/usr/bin/node") ? "/usr/bin/node" : "node");
  const result = await run(nodeBin, ["scripts/response-engine-worker.js", "--limit=1"], {
    cwd: APP_ROOT,
    env: {
      RESPONSE_ENGINE_CODEX_BIN: nodeBin,
      RESPONSE_ENGINE_CODEX_ARGS: mockPath,
      RESPONSE_ENGINE_JOB_ROOT: jobRoot,
      RESPONSE_ENGINE_CODEX_TIMEOUT_MS: "120000",
    },
  });
  record("worker completed with mock provider", result.code === 0, `${result.stdout}\n${result.stderr}`.slice(0, 1000));
  return job.id;
}

function parseZipNames(buffer) {
  const names = [];
  let offset = 0;
  while (offset < buffer.length - 46) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === 0x02014b50) {
      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      names.push(buffer.slice(offset + 46, offset + 46 + nameLength).toString("utf8"));
      offset += 46 + nameLength + extraLength + commentLength;
      continue;
    }
    offset += 1;
  }
  return names;
}

async function main() {
  log("starting live Bid/Proposal Automation QA", { appUrl, runId });
  const publicHome = await fetch(`${appUrl}/`);
  const publicText = await publicHome.text();
  record("public site includes Bid/Proposal Automation", publicText.includes("Bid/Proposal Automation"));
  record("public site has no visible Response Engine label", !publicText.includes("Response Engine"));
  const deletedTestPage = await fetch(`${appUrl}/live-payment-test`);
  record("public live payment test page is not reachable", deletedTestPage.status === 404, `status=${deletedTestPage.status}`);

  const admin = await makeAdmin();
  const adminSession = await api("/api/admin-session", { token: admin.token });
  record("admin session accepted", adminSession.status === 200, adminSession.text);

  const owner = await createAuthUser("owner", true);
  const ownerAuth = await signIn(owner);
  const ownerProfile = await saveWorkspaceProfile(ownerAuth.client, owner, {
    orgName,
    serviceInterest: "response_engine",
    firstName: "Olivia",
    lastName: "Owner",
    jobTitle: "Delivery Lead",
  });
  const organizationId = ownerProfile.organization_id;
  created.orgs.main = organizationId;
  record("owner signup creates active organization", Boolean(organizationId && ownerProfile.membership_status === "active"), JSON.stringify(ownerProfile));

  const pending = await createAuthUser("pending", true);
  const pendingAuth = await signIn(pending);
  const pendingProfile = await saveWorkspaceProfile(pendingAuth.client, pending, {
    orgName,
    joinExisting: true,
    serviceInterest: "response_engine",
    firstName: "Peter",
    lastName: "Pending",
  });
  const pendingMember = await findMember(pending.id, organizationId);
  record("second recruiter is pending", pendingProfile.membership_status === "pending" && pendingMember?.status === "pending", JSON.stringify(pendingMember));
  const pendingBlocked = await api("/api/organization-members", { token: pendingAuth.token });
  record("pending recruiter cannot open organization roster", pendingBlocked.status === 403, pendingBlocked.text);
  await approveMember(admin.token, pendingMember.id, "recruiter");
  const pendingRoster = await api("/api/organization-members", { token: pendingAuth.token });
  record("approved recruiter can open organization roster", pendingRoster.status === 200 && pendingRoster.data.members.length >= 2, pendingRoster.text);

  const rejected = await createAuthUser("rejected", true);
  const rejectedAuth = await signIn(rejected);
  await saveWorkspaceProfile(rejectedAuth.client, rejected, {
    orgName,
    joinExisting: true,
    serviceInterest: "response_engine",
    firstName: "Riley",
    lastName: "Rejected",
  });
  const rejectedMember = await findMember(rejected.id, organizationId);
  const rejectResult = await setMemberStatus(admin.token, rejectedMember.id, "rejected", "recruiter");
  record("admin can reject recruiter", rejectResult.status === 200, rejectResult.text);
  const rejectedBlocked = await api("/api/response-engine-access", { token: rejectedAuth.token });
  record("rejected recruiter cannot access service", rejectedBlocked.status === 403, rejectedBlocked.text);

  const viewer = await createAuthUser("viewer", true);
  const viewerAuth = await signIn(viewer);
  await saveWorkspaceProfile(viewerAuth.client, viewer, {
    orgName,
    joinExisting: true,
    serviceInterest: "response_engine",
    firstName: "Vera",
    lastName: "Viewer",
  });
  const viewerMember = await findMember(viewer.id, organizationId);
  await approveMember(admin.token, viewerMember.id, "viewer");

  const ownerMember = await findMember(owner.id, organizationId);
  const demoteOwner = await setMemberStatus(admin.token, ownerMember.id, "active", "recruiter");
  record("last owner cannot be demoted", demoteOwner.status === 409, demoteOwner.text);

  const accessRequest = await requestAccess(ownerAuth.token, "Live QA request for Bid/Proposal pilot access.");
  record("owner can request Bid/Proposal access", accessRequest.status === 200, accessRequest.text);
  const approve9 = await approveAccess(admin.token, organizationId, 9);
  record("admin approves service with pilot credits", approve9.status === 200, approve9.text);
  const balance9 = await responseBalance(organizationId);
  record("response credits granted to 9", balance9.balance === 9 && balance9.availableBalance === 9, JSON.stringify(balance9));
  const approve9Again = await approveAccess(admin.token, organizationId, 9);
  record("same credit limit does not duplicate grant", approve9Again.status === 200, approve9Again.text);
  const balanceStill9 = await responseBalance(organizationId);
  record("balance remains 9 after idempotent approval", balanceStill9.balance === 9, JSON.stringify(balanceStill9));
  const approve12 = await approveAccess(admin.token, organizationId, 12, "Increase QA pilot credits");
  record("credit limit increase is accepted", approve12.status === 200, approve12.text);
  const balance12 = await responseBalance(organizationId);
  record("only delta credits are granted", balance12.balance === 12, JSON.stringify(balance12));

  const viewerCreate = await createPackage(viewerAuth.token, { outputOptions: ["polished_resume"], outputFormats: ["docx"] });
  record("viewer cannot spend package credits", viewerCreate.status === 403, viewerCreate.text);

  const tempPackage = await createPackage(ownerAuth.token, {
    packageTitle: `QA Empty Queue ${runId}`,
    outputOptions: ["polished_resume"],
    outputFormats: ["docx"],
  });
  record("temp package created for negative upload tests", tempPackage.status === 200, tempPackage.text);
  const emptyQueue = await queuePackage(ownerAuth.token, tempPackage.data.requestId);
  record("queue rejects package without files", emptyQueue.status === 400, emptyQueue.text);
  const elevenFiles = Array.from({ length: 11 }, (_, index) => ({
    name: `Too Many ${index + 1}.pdf`,
    role: "reference_material",
    description: "Negative upload limit test.",
    contentType: "application/pdf",
    data: pdfBuffer(`File ${index + 1}`),
  }));
  const upload11 = await uploadFiles(ownerAuth.client, owner.id, tempPackage.data.requestId, organizationId, tempPackage.data.projectId, ownerAuth.token, elevenFiles);
  record("finalize rejects more than 10 files", upload11.result.status === 400, upload11.result.text);
  const cancelTemp = await cancelPackage(ownerAuth.token, tempPackage.data.requestId, "Negative test package cancelled.");
  record("cancel releases temp package reservation", cancelTemp.status === 200, cancelTemp.text);

  const mainPackage = await createPackage(ownerAuth.token);
  record("main package created", mainPackage.status === 200 && mainPackage.data.creditCost === 5, mainPackage.text);
  created.requests.main = mainPackage.data.requestId;
  const sourceFiles = makeSourceFiles();
  const uploaded = await uploadFiles(
    ownerAuth.client,
    owner.id,
    mainPackage.data.requestId,
    organizationId,
    mainPackage.data.projectId,
    ownerAuth.token,
    sourceFiles
  );
  record("valid source files finalized", uploaded.result.status === 200 && uploaded.result.data.uploaded === sourceFiles.length, uploaded.result.text);
  const { data: savedFiles, error: savedFilesError } = await service
    .from("request_files")
    .select("id,file_name,file_role,file_description")
    .eq("request_id", mainPackage.data.requestId)
    .order("created_at", { ascending: true });
  if (savedFilesError) throw savedFilesError;
  record("invalid direct file role normalized to other", savedFiles.some((file) => file.file_name.includes("Recruiter Email") && file.file_role === "other"), JSON.stringify(savedFiles));
  record("long file description capped at 1000 characters", savedFiles.some((file) => file.file_name.includes("Mandatory") && String(file.file_description || "").length === 1000));

  const queue = await queuePackage(ownerAuth.token, mainPackage.data.requestId);
  record("main package queued", queue.status === 200 && queue.data.queued, queue.text);
  const queueAgain = await queuePackage(ownerAuth.token, mainPackage.data.requestId);
  record("queue retry is idempotent", queueAgain.status === 200 && queueAgain.data.alreadyQueued, queueAgain.text);
  await runWorkerForQueuedJob(mainPackage.data.requestId);

  const { data: jobRow, error: jobError } = await service
    .from("response_engine_jobs")
    .select("id,status,qa_score,output_manifest")
    .eq("request_id", mainPackage.data.requestId)
    .maybeSingle();
  if (jobError) throw jobError;
  record("worker delivered package", jobRow?.status === "delivered" && Number(jobRow.qa_score) >= 8.5, JSON.stringify(jobRow || {}));
  const deliveredBalance = await responseBalance(organizationId);
  record("reserved credits consumed after delivery", deliveredBalance.balance === 7 && deliveredBalance.reservedBalance === 0, JSON.stringify(deliveredBalance));
  const release = jobRow.output_manifest?.release;
  record("worker release includes deliverable version", Boolean(release?.deliverableId && release?.versionId), JSON.stringify(release || {}));
  created.deliverables.main = release?.deliverableId;

  const { data: deliverableFiles, error: deliverableFileError } = await service
    .from("deliverable_version_files")
    .select("id,file_name,organization_id,project_id,deliverable_version_id")
    .eq("deliverable_version_id", release.versionId)
    .order("created_at", { ascending: true });
  if (deliverableFileError) throw deliverableFileError;
  record("deliverable files released", deliverableFiles.length >= 2, JSON.stringify(deliverableFiles));

  const clientDownload = await api("/api/deliverable-download-url", {
    token: ownerAuth.token,
    body: { fileId: deliverableFiles[0].id, organizationId, projectId: mainPackage.data.projectId },
  });
  record("client individual download URL created", clientDownload.status === 200 && clientDownload.data.signedUrl, clientDownload.text);
  const signed = await fetch(clientDownload.data.signedUrl);
  record("client signed file URL opens", signed.status === 200, `status=${signed.status}`);

  const adminDownload = await api("/api/deliverable-download-url", {
    token: admin.token,
    body: { fileId: deliverableFiles[0].id, organizationId, projectId: mainPackage.data.projectId },
  });
  record("admin individual download URL created", adminDownload.status === 200 && adminDownload.data.signedUrl, adminDownload.text);

  const clientZip = await api("/api/deliverable-download-bundle", {
    token: ownerAuth.token,
    body: { versionId: release.versionId, organizationId, projectId: mainPackage.data.projectId },
    binary: true,
  });
  const zipNames = parseZipNames(clientZip.buffer);
  record("client ZIP download works", clientZip.status === 200 && clientZip.buffer.slice(0, 2).toString() === "PK" && zipNames.length >= 2, `status=${clientZip.status}; names=${zipNames.join(",")}`);

  const adminZip = await api("/api/deliverable-download-bundle", {
    token: admin.token,
    body: { versionId: release.versionId, organizationId, projectId: mainPackage.data.projectId },
    binary: true,
  });
  record("admin ZIP download works", adminZip.status === 200 && adminZip.buffer.slice(0, 2).toString() === "PK", `status=${adminZip.status}`);

  const existingOwner = await createAuthUser("existing", true);
  const existingAuth = await signIn(existingOwner);
  const existingProfile = await saveWorkspaceProfile(existingAuth.client, existingOwner, {
    orgName: existingOrgName,
    serviceInterest: null,
    firstName: "Evan",
    lastName: "Existing",
  });
  const existingOrgId = existingProfile.organization_id;
  created.orgs.existing = existingOrgId;
  const existingRequest = await requestAccess(existingAuth.token, "Existing client activating Bid/Proposal service.");
  record("existing client can request new service line", existingRequest.status === 200, existingRequest.text);
  const existingApprove = await approveAccess(admin.token, existingOrgId, 2);
  record("admin approves existing client activation", existingApprove.status === 200, existingApprove.text);
  const insufficient = await createPackage(existingAuth.token, {
    packageTitle: `QA Insufficient Credits ${runId}`,
    outputOptions: ["polished_resume", "mandatory_matrix", "rated_matrix"],
    outputFormats: ["docx"],
  });
  record("insufficient credits return clean 402", insufficient.status === 402, insufficient.text);
  const crossOrgDownload = await api("/api/deliverable-download-url", {
    token: existingAuth.token,
    body: { fileId: deliverableFiles[0].id, organizationId: existingOrgId, projectId: mainPackage.data.projectId },
  });
  record("cross-organization deliverable download is blocked", crossOrgDownload.status === 403, crossOrgDownload.text);
  const wrongScopeDownload = await api("/api/deliverable-download-url", {
    token: ownerAuth.token,
    body: { fileId: deliverableFiles[0].id, organizationId: existingOrgId, projectId: mainPackage.data.projectId },
  });
  record("tampered client organization scope is blocked", wrongScopeDownload.status === 403, wrongScopeDownload.text);

  const sourceDownload = await api("/api/source-file-download-url", {
    token: ownerAuth.token,
    body: { fileId: savedFiles[0].id, organizationId, projectId: mainPackage.data.projectId },
  });
  record("client source file download URL works", sourceDownload.status === 200 && sourceDownload.data.signedUrl, sourceDownload.text);
  const sourceCrossOrg = await api("/api/source-file-download-url", {
    token: existingAuth.token,
    body: { fileId: savedFiles[0].id, organizationId: existingOrgId, projectId: mainPackage.data.projectId },
  });
  record("cross-organization source file download is blocked", sourceCrossOrg.status === 403, sourceCrossOrg.text);

  const unverified = await createAuthUser("unverified", false);
  let unverifiedBlocked = false;
  try {
    const unverifiedAuth = await signIn(unverified);
    const unverifiedApi = await api("/api/organization-members", { token: unverifiedAuth.token });
    unverifiedBlocked = unverifiedApi.status === 403;
  } catch (_error) {
    unverifiedBlocked = true;
  }
  record("unverified account is blocked", unverifiedBlocked);

  const { data: normalCreditAccount, error: creditError } = await service
    .from("credit_accounts")
    .select("id,balance,reserved_balance")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (creditError) throw creditError;
  record("standard advisory credits remain separate", !normalCreditAccount, JSON.stringify(normalCreditAccount || {}));

  const { data: auditRows, error: auditError } = await service
    .from("audit_events")
    .select("event_type,actor_id,related_entity_type")
    .eq("organization_id", organizationId)
    .in("event_type", [
      "organization_join_requested",
      "organization_member_approved",
      "organization_member_rejected",
      "response_engine_access_requested",
      "response_engine_access_updated",
      "response_engine_package_created",
      "response_engine_job_queued",
      "response_engine_package_cancelled",
      "response_engine_package_delivered",
    ]);
  if (auditError) throw auditError;
  const auditEvents = new Set((auditRows || []).map((row) => row.event_type));
  for (const eventType of [
    "organization_join_requested",
    "organization_member_approved",
    "organization_member_rejected",
    "response_engine_access_requested",
    "response_engine_access_updated",
    "response_engine_package_created",
    "response_engine_job_queued",
    "response_engine_package_cancelled",
    "response_engine_package_delivered",
  ]) {
    record(`audit event recorded: ${eventType}`, auditEvents.has(eventType));
  }

  const summary = {
    runId,
    appUrl,
    organizationId,
    existingOrgId,
    requestId: mainPackage.data.requestId,
    deliverableId: release.deliverableId,
    versionId: release.versionId,
    checksPassed: checks.filter((check) => check.passed).length,
    checksTotal: checks.length,
    created,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  console.error(JSON.stringify({
    runId,
    checksPassed: checks.filter((check) => check.passed).length,
    checksTotal: checks.length,
    failedChecks: checks.filter((check) => !check.passed),
    created,
  }, null, 2));
  process.exit(1);
});
