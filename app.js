const config = {
  domain: "baadvisorydesk.com",
  adminEmail: "",
  supportEmail: "support@baadvisorydesk.com",
  maxFileSizeMb: 50,
  maxFilesPerUpload: 10,
  allowedFileTypes: ["PDF", "Word", "Excel", "PowerPoint", "PNG", "JPG"],
  starterCredits: 5,
  topUpCredits: 3,
  topUpPrice: 1000,
  topUpExpiryDays: 30,
  lowCreditThreshold: 2,
  stripePrices: {
    rescueSprint: "price_1TYXC8APPPI08UZD46QIjVCk",
    starterMonthly: "price_1TYXCtAPPPI08UZDJVWzzJhv",
    creditTopUp: "price_1TYXDQAPPPI08UZDPKSUXUQv",
  },
  stripePaymentLinks: {
  },
  ...(window.BAAD_CONFIG || {}),
};

const siteContent = window.BAAD_CONTENT || {};
const ADMIN_ALL_PROJECTS_VALUE = "__all__";

window.BAAD_RUNTIME_CONFIG = {
  domain: config.domain,
  stripePrices: config.stripePrices,
  stripePaymentLinks: config.stripePaymentLinks,
  hasSupabase: Boolean(config.supabaseUrl && config.supabaseAnonKey),
};

const supabaseClient =
  window.supabase && config.supabaseUrl && config.supabaseAnonKey
    ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
    : null;

const privateWorkspaceStorageKeys = [
  "baad-client",
  "baad-requests",
  "baad-credits",
  "baad-credit-threshold",
  "baad-credit-history",
  "baad-payment-history",
  "baad-audit-events",
  "baad-deliverables",
  "baad-client-messages",
  "baad-client-uploads",
  "baad-request-files",
  "baad-client-projects",
  "baad-selected-project-id",
  "baad-admin-client-id",
  "baad-admin-project-id",
];

function clearPrivateWorkspaceStorage() {
  privateWorkspaceStorageKeys.forEach((key) => localStorage.removeItem(key));
}

clearPrivateWorkspaceStorage();

const state = {
  client: {
    email: "",
    company: "Your organization",
  },
  requests: [],
  creditsLeft: 0,
  creditThreshold: Number(config.lowCreditThreshold),
  creditHistory: [],
  paymentHistory: [],
  auditEvents: [],
  deliverables: [],
  clientMessages: [],
  clientUploads: [],
  requestFiles: [],
  clientProjects: [],
  selectedProjectId: "",
  adminDeliverables: [],
  adminDeliverableFiles: [],
  adminClientUploads: [],
  adminRequestFiles: [],
  adminProjects: [],
  adminCreditLedger: [],
  adminPaymentHistory: [],
  adminAuditEvents: [],
  session: null,
  adminAccess: false,
  adminStatusChecked: false,
  adminStatusUserId: "",
  adminQueue: [],
  adminClients: [],
  selectedAdminClientId: "",
  selectedAdminProjectId: "",
  adminUploadProjectId: null,
  adminQueueFocus: "",
  adminMessageContext: null,
  adminNewCount: 0,
  quoteCount: 0,
  passwordRecovery: false,
  profileOrganizationId: "",
  workspaceLoadIssue: "",
  reservedCredits: 0,
};

const views = {
  home: document.querySelector("#view-home"),
  about: document.querySelector("#view-about"),
  services: document.querySelector("#view-services"),
  samples: document.querySelector("#view-samples"),
  faq: document.querySelector("#view-faq"),
  pricing: document.querySelector("#view-pricing"),
  security: document.querySelector("#view-security"),
  login: document.querySelector("#view-login"),
  dashboard: document.querySelector("#view-dashboard"),
  profile: document.querySelector("#view-profile"),
  request: document.querySelector("#view-request"),
  billing: document.querySelector("#view-billing"),
  "checkout-success": document.querySelector("#view-checkout-success"),
  admin: document.querySelector("#view-admin"),
  quote: document.querySelector("#view-quote"),
};

const routeAliases = {
  messages: "dashboard",
  files: "dashboard",
  deliverables: "dashboard",
};

function saveState() {
  clearPrivateWorkspaceStorage();
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  const toastText = document.querySelector("#toastText");
  if (!toast || !toastText) return;
  toastText.textContent = message;
  toast.classList.remove("persistent");
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 5200);
}

function showPersistentNotice(message) {
  const toast = document.querySelector("#toast");
  const toastText = document.querySelector("#toastText");
  if (!toast || !toastText) return;
  toastText.textContent = message;
  window.clearTimeout(showToast.timer);
  toast.classList.add("show", "persistent");
}

function hideToast() {
  const toast = document.querySelector("#toast");
  if (toast) toast.classList.remove("show", "persistent");
}

function setInlineStatus(selector, message, level = "") {
  const status = document.querySelector(selector);
  if (!status) return;
  status.textContent = message;
  status.classList.remove("warning", "success");
  if (level) status.classList.add(level);
}

function clearFieldErrors(containerSelector) {
  const container = document.querySelector(containerSelector) || document;
  container.querySelectorAll(".field-error").forEach((field) => {
    field.classList.remove("field-error");
    field.removeAttribute("aria-invalid");
    const errorId = field.dataset.errorId;
    if (errorId) {
      const describedBy = (field.getAttribute("aria-describedby") || "")
        .split(/\s+/)
        .filter((id) => id && id !== errorId)
        .join(" ");
      if (describedBy) {
        field.setAttribute("aria-describedby", describedBy);
      } else {
        field.removeAttribute("aria-describedby");
      }
      delete field.dataset.errorId;
    }
  });
  container.querySelectorAll(".field-error-note").forEach((note) => note.remove());
}

function markFieldError(selector, message = "Required") {
  const field = document.querySelector(selector);
  if (!field) return null;
  field.classList.add("field-error");
  field.setAttribute("aria-invalid", "true");
  const label = field.closest("label");
  const safeId = `${selector.replace(/[^A-Za-z0-9_-]/g, "")}-error`;
  field.dataset.errorId = safeId;
  const currentDescribedBy = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
  if (!currentDescribedBy.includes(safeId)) {
    field.setAttribute("aria-describedby", [...currentDescribedBy, safeId].join(" "));
  }
  if (label && !label.querySelector(".field-error-note")) {
    const note = document.createElement("small");
    note.id = safeId;
    note.className = "field-error-note";
    note.textContent = message;
    label.appendChild(note);
  }
  return field;
}

function focusFirstField(selectors) {
  const field = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
  if (!field) return;
  field.scrollIntoView({ block: "center", behavior: "smooth" });
  window.requestAnimationFrame(() => field.focus());
}

function validateFieldSet({ fields, containerSelector, statusSelector, message }) {
  clearFieldErrors(containerSelector);
  const missing = fields
    .filter((field) => !field.when || field.when())
    .filter((field) => !field.isValid())
    .map((field) => {
      markFieldError(field.selector, field.message || "Required");
      return field.selector;
    });

  if (!missing.length) return true;
  setInlineStatus(statusSelector, message, "warning");
  showPersistentNotice(message);
  focusFirstField(missing);
  return false;
}

function setButtonBusy(button, busy, labelWhenBusy = "Working") {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalLabel) {
      button.dataset.originalLabel = button.textContent;
    }
    button.textContent = labelWhenBusy;
    button.disabled = true;
    button.dataset.busy = "true";
    return;
  }
  button.textContent = button.dataset.originalLabel || button.textContent;
  button.disabled = false;
  delete button.dataset.busy;
  delete button.dataset.originalLabel;
}

function formatToday() {
  return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDisplayDate(value) {
  if (!value) return "To be confirmed";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatUsdFromCents(amountCents, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: String(currency || "usd").toUpperCase(),
  }).format(Number(amountCents || 0) / 100);
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (!size) return "File size not recorded";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateTime(value) {
  if (!value) return "Date not recorded";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function getIsoNow() {
  return new Date().toISOString();
}

function generateRequestCode() {
  const now = new Date();
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const randomPart = String(Math.floor(1000 + Math.random() * 9000));
  return `REQ ${datePart} ${randomPart}`;
}

function productLabel(productType) {
  const labels = {
    rescue_sprint: "BA Rescue Sprint",
    starter_monthly: "BA Advisory Desk Starter",
    credit_top_up: "Credit Top Up",
  };
  return labels[productType] || productType || "Payment";
}

function addAuditEvent(event, details) {
  state.auditEvents.unshift({
    date: formatToday(),
    event,
    client: state.client.company,
    details,
  });
  state.auditEvents = state.auditEvents.slice(0, 20);
}

function addCreditHistory(deliverable, credits, balance) {
  state.creditHistory.unshift({
    date: formatToday(),
    deliverable,
    credits,
    balance,
  });
  state.creditHistory = state.creditHistory.slice(0, 20);
}

function addPaymentHistory(item, amount, status) {
  state.paymentHistory.unshift({
    date: formatToday(),
    item,
    amount,
    status,
  });
  state.paymentHistory = state.paymentHistory.slice(0, 20);
}

function isPaidPaymentStatus(status) {
  const normalized = String(status || "").toLowerCase();
  return new Set(["paid", "succeeded", "complete", "completed", "active", "trialing", "payment_succeeded"]).has(normalized);
}

function hasRecordedPayment(labelFragment) {
  const target = String(labelFragment || "").toLowerCase();
  return state.paymentHistory.some((payment) => {
    const item = String(payment.item || "").toLowerCase();
    return item.includes(target) && isPaidPaymentStatus(payment.status);
  });
}

function hasRescueSprintAccess() {
  return hasRecordedPayment("rescue sprint");
}

function getAvailableCredits(balance = state.creditsLeft, reserved = state.reservedCredits) {
  return Math.max(0, Number(balance || 0) - Number(reserved || 0));
}

function getCreditBalanceLabel() {
  const available = getAvailableCredits();
  const reserved = Number(state.reservedCredits || 0);
  if (reserved > 0) {
    return `${available} available. ${reserved} reserved for active work.`;
  }
  return `${available}`;
}

function getCreditAlertState(balance = getAvailableCredits(), threshold = state.creditThreshold) {
  if (balance <= 0) {
    return {
      level: "depleted",
      count: 1,
      summary: "Credits depleted",
      message: "No Advisory Credits remain. Delivery is paused until credits are added.",
    };
  }

  if (balance <= threshold) {
    return {
      level: "low",
      count: 1,
      summary: "Low credit balance",
      message: `${balance} Advisory Credits remain. Review planned deliverables before approving new work.`,
    };
  }

  return {
    level: "healthy",
    count: 0,
    summary: "No credit alerts",
    message: "Credit balance is healthy.",
  };
}

function getEmptyAdminClient() {
  return {
    id: "",
    selectionId: "",
    name: "Select a client",
    email: "",
    balance: 0,
    lowCreditThreshold: config.lowCreditThreshold,
    status: "No client selected",
  };
}

function getSelectedAdminClient() {
  if (!state.selectedAdminClientId) return getEmptyAdminClient();
  return (
    state.adminClients.find((client) => client.selectionId === state.selectedAdminClientId || client.id === state.selectedAdminClientId) ||
    getEmptyAdminClient()
  );
}

function getAdminClientByOrganization(organizationId) {
  if (!organizationId) return getEmptyAdminClient();
  return (
    state.adminClients.find((client) => client.id === organizationId || client.selectionId === organizationId) ||
    getEmptyAdminClient()
  );
}

function getAdminCreditBalanceForOrganization(organizationId) {
  const client = getAdminClientByOrganization(organizationId);
  if (client.id) return getAvailableCredits(client.balance, client.reservedBalance);
  return organizationId === state.selectedAdminClientId ? getAvailableCredits() : 0;
}

function getCreditBalanceLabelForAdmin(client) {
  const available = getAvailableCredits(client?.balance, client?.reservedBalance);
  const reserved = Number(client?.reservedBalance || 0);
  return reserved > 0 ? `${available} available, ${reserved} reserved` : `${available}`;
}

function getShortEntityId(prefix, id) {
  const compact = String(id || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  return compact ? `${prefix}-${compact.slice(0, 8)}` : `${prefix}-PENDING`;
}

function looksLikeInternalId(value) {
  const source = String(value || "").trim();
  if (!source) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(source)) return true;
  if (/^[0-9a-f]{24,}$/i.test(source)) return true;
  return false;
}

function cleanDisplayText(value, fallback = "") {
  const source = String(value || "").trim();
  if (!source || looksLikeInternalId(source)) return fallback;
  return source;
}

function getClientDisplayId(client) {
  return getShortEntityId("CL", client?.id || client?.organizationId || client?.selectionId || "");
}

function getProjectDisplayId(project) {
  const code = String(project?.projectCode || project?.project_code || "").trim();
  if (code && code.toUpperCase() !== "GEN") return code;
  return "";
}

function getProjectDisplayRef(project) {
  return getProjectDisplayId(project) || getShortEntityId("PRJ", project?.id || project?.projectId || project?.project_id || "");
}

function getProjectLabel(project) {
  if (!project) return "General advisory work";
  const name = project.name || project.projectName || project.title || "General advisory work";
  return name;
}

function getRequestDisplayRef(request) {
  const explicit = cleanDisplayText(request?.requestCode || request?.request_code || request?.id, "");
  if (explicit) return explicit;
  return getShortEntityId("REQ", request?.requestId || request?.request_id || request?.relatedEntityId || "");
}

function getAdminItemDisplayRef(item) {
  if (!item) return "ITEM-PENDING";
  if (item.queueType === "request" || item.relatedEntityType === "request") return getRequestDisplayRef(item);
  if (item.queueType === "quote") return getShortEntityId("QUOTE", item.requestId || item.id);
  if (item.queueType === "payment") return getShortEntityId("PAY", item.requestId || item.id);
  if (item.queueType === "notification") return getShortEntityId("NOTICE", item.relatedEntityId || item.requestId || item.id);
  if (item.queueType === "client-message") return getShortEntityId("MSG", item.id || item.requestId);
  if (item.queueType === "request-file" || item.queueType === "client-upload") return getShortEntityId("FILE", item.fileId || item.id);
  return getShortEntityId("ITEM", item.id || item.requestId || item.relatedEntityId);
}

function getProjectById(projectId, projects = state.clientProjects) {
  if (!projectId) return null;
  return projects.find((project) => String(project.id) === String(projectId)) || null;
}

function getClientProjectLabel(projectOrId) {
  if (projectOrId && typeof projectOrId === "object") {
    if (projectOrId.projectLabel) return projectOrId.projectLabel;
    if (projectOrId.projectId || projectOrId.project_id) {
      const project =
        getProjectById(projectOrId.projectId || projectOrId.project_id, state.clientProjects) ||
        getProjectById(projectOrId.projectId || projectOrId.project_id, state.adminProjects);
      return project ? getProjectLabel(project) : getProjectLabel(projectOrId);
    }
    return getProjectLabel(projectOrId);
  }
  const project = getProjectById(projectOrId, state.clientProjects) || getProjectById(projectOrId, state.adminProjects);
  return getProjectLabel(project);
}

function getAdminProjectIdForApi(explicitProjectId = "") {
  const value = explicitProjectId || state.selectedAdminProjectId || "";
  return value === ADMIN_ALL_PROJECTS_VALUE ? "" : value;
}

function getAdminUploadProjectId() {
  const select = document.querySelector("#adminUploadProjectSelect");
  const value = select ? select.value || "" : state.adminUploadProjectId || "";
  return value === ADMIN_ALL_PROJECTS_VALUE ? "" : value;
}

function isActiveProject(project) {
  return !["archived", "closed"].includes(normalizeStatusValue(project?.status || project?.projectStatus || project?.project_status));
}

function getActiveClientProjects() {
  return state.clientProjects.filter(isActiveProject);
}

function getAdminProjectsForClient(client = getSelectedAdminClient()) {
  if (!client?.id) return [];
  return state.adminProjects.filter((project) => (project.organizationId === client.id || project.organization_id === client.id) && isActiveProject(project));
}

function getSelectedAdminProject() {
  if (state.selectedAdminProjectId === ADMIN_ALL_PROJECTS_VALUE) return null;
  const client = getSelectedAdminClient();
  const projects = getAdminProjectsForClient(client);
  if (!projects.length) return null;
  return projects.find((project) => project.id === state.selectedAdminProjectId) || null;
}

function syncSelectedAdminProjectToClient() {
  const projects = getAdminProjectsForClient();
  if (!projects.length) {
    state.selectedAdminProjectId = "";
    return;
  }
  if (state.selectedAdminProjectId === ADMIN_ALL_PROJECTS_VALUE) return;
  if (!projects.some((project) => project.id === state.selectedAdminProjectId)) {
    state.selectedAdminProjectId = ADMIN_ALL_PROJECTS_VALUE;
  }
}

function syncSelectedAdminClientToState() {
  const client = getSelectedAdminClient();
  state.selectedAdminClientId = client.selectionId || client.id || "";
  state.creditsLeft = Number(client.balance ?? 0);
  state.reservedCredits = Number(client.reservedBalance ?? 0);
  state.creditThreshold = Number(client.lowCreditThreshold ?? config.lowCreditThreshold);
  syncSelectedAdminProjectToClient();
}

function hasSelectedAdminClient() {
  const client = getSelectedAdminClient();
  return Boolean(state.selectedAdminClientId && (client.id || client.email));
}

function updateSelectedAdminClientCreditAccount(balance, lowCreditThreshold) {
  const client = getSelectedAdminClient();
  if (!state.adminClients.length || !client.id) return;
  client.balance = balance;
  client.reservedBalance = state.reservedCredits;
  client.lowCreditThreshold = lowCreditThreshold;
}

function normalizeStatusValue(status) {
  return String(status || "").trim().toLowerCase().replace(/_/g, " ");
}

function toRequestStorageStatus(status) {
  return normalizeStatusValue(status).replace(/\s+/g, "_");
}

function isPausedStatus(status) {
  const normalized = normalizeStatusValue(status);
  return normalized.includes("pause") || normalized.includes("awaiting credit");
}

function isShippedStatus(status) {
  const normalized = normalizeStatusValue(status);
  return normalized.includes("complete") || normalized.includes("delivered") || normalized.includes("shipped");
}

function isPendingStatus(status) {
  const normalized = normalizeStatusValue(status);
  return (
    !isShippedStatus(status) &&
    !isPausedStatus(status) &&
    !["sent", "paid", "addressed", "reviewed", "dismissed", "archived", "closed", "completed", "checked"].includes(normalized)
  );
}

function isAdminQueueOpenItem(item) {
  if (!item) return false;
  const normalized = normalizeStatusValue(item.status);
  if (["admin sent", "admin email pending", "email queued"].includes(normalized)) return false;
  if (["request-file", "client-upload"].includes(item.queueType)) return !["reviewed", "addressed", "dismissed"].includes(normalizeStatusValue(item.status));
  if (item.queueType === "payment") return !["paid", "addressed", "dismissed", "checked"].includes(normalizeStatusValue(item.status));
  return isPendingStatus(item.status);
}

function isDueSoon(value) {
  if (!value) return false;
  const dueDate = new Date(value);
  if (Number.isNaN(dueDate.getTime())) return false;
  const today = new Date();
  const limit = new Date();
  limit.setDate(today.getDate() + 7);
  return dueDate <= limit;
}

function getClientEmail(client) {
  return client?.email || client?.billingEmail || client?.billing_email || "";
}

function getClientMailto(client, subject = "BA Advisory Desk follow up") {
  const email = getClientEmail(client) || config.supportEmail;
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}`;
}

function buildAdminQueueKey(item) {
  if (!item) return "item:unknown";
  const queueType = item.queueType || "item";
  const primary =
    queueType === "request"
      ? item.requestId || item.id
      : queueType === "request-file" || queueType === "client-upload"
        ? item.fileId || item.id
        : item.id || item.relatedEntityId || item.fileId || item.requestId || item.dueAt;
  return [queueType, item.organizationId || item.clientEmail || "no-client", item.projectId || "no-project", primary || "unknown"].join(":");
}

function getAdminQueueItemByKey(key) {
  return state.adminQueue.find((item) => buildAdminQueueKey(item) === key);
}

function getAdminStatusLevel(status) {
  const normalized = normalizeStatusValue(status);
  if (normalized.includes("pause") || normalized.includes("blocked") || normalized.includes("failed")) return "blocked";
  if (normalized.includes("deliver") || normalized.includes("complete") || normalized.includes("sent") || normalized.includes("paid")) return "delivered";
  if (normalized.includes("review") || normalized.includes("progress") || normalized.includes("received")) return "review";
  if (normalized.includes("approved")) return "approved";
  return "new";
}

function getAdminWorkTitle(item) {
  if (!item) return "Workspace item";
  if (item.queueType === "request") return cleanDisplayText(item.type, "Client request");
  if (item.queueType === "request-file" || item.queueType === "client-upload") return cleanDisplayText(item.fileName || item.type, "Source file");
  if (item.queueType === "client-message") return cleanDisplayText(item.type, "Client message");
  if (item.queueType === "notification") return cleanDisplayText(item.type, "Workspace notice");
  if (item.queueType === "payment") return cleanDisplayText(item.type, "Payment activity");
  if (item.queueType === "quote") return cleanDisplayText(item.type, "Custom scope inquiry");
  return cleanDisplayText(item.type, "Workspace item");
}

function getAdminWorkDetail(item) {
  if (!item) return "";
  const itemRef = getAdminItemDisplayRef(item);
  let detail = "";
  if (item.summarySnippet) detail = cleanDisplayText(item.summarySnippet, "Review the client context.");
  else if (item.note) detail = cleanDisplayText(item.note, "Review the uploaded file note.");
  else if (item.businessGoal) detail = cleanDisplayText(item.businessGoal, "Review the client request.");
  else if (item.body) detail = cleanDisplayText(item.body, "Review the workspace message.");
  else if (item.attachmentDescription) detail = cleanDisplayText(item.attachmentDescription, "Review the attached files and intake details.");
  else if (item.budget) detail = `Budget: ${item.budget}`;
  else if (item.contextLabel) detail = cleanDisplayText(item.contextLabel, "Review the workspace context.");
  else detail = item.action || "Review this workspace item.";
  return itemRef ? `${itemRef} | ${detail}` : detail;
}

function getAdminNextAction(item) {
  if (!item) return "Review";
  if (item.queueType === "request") {
    if (isShippedStatus(item.status)) return "Confirm client review";
    if (isPausedStatus(item.status)) return "Resolve pause";
    return "Scope or release work";
  }
  if (item.queueType === "client-message") return "Respond";
  if (item.queueType === "request-file" || item.queueType === "client-upload") return "Review file";
  if (item.queueType === "payment") return "Confirm billing";
  if (item.queueType === "quote") return "Follow up";
  if (item.queueType === "notification") return "Check notice";
  return item.action || "Review";
}

function getAdminQueueResolution(item) {
  if (!item) return { action: "addressed", label: "Mark Addressed" };
  if (item.queueType === "request") {
    if (isShippedStatus(item.status)) return { action: "completed", label: "Close Request" };
    if (isPausedStatus(item.status)) return { action: "reviewed", label: "Mark Reviewed" };
    return { action: "reviewed", label: "Mark Scoped" };
  }
  if (item.queueType === "request-file" || item.queueType === "client-upload") return { action: "reviewed", label: "Reviewed" };
  if (item.queueType === "client-message") return { action: "addressed", label: "Addressed" };
  if (item.queueType === "quote") return { action: "addressed", label: "Addressed" };
  if (item.queueType === "notification") return { action: "dismissed", label: "Dismiss" };
  if (item.queueType === "payment") return { action: "addressed", label: "Mark Checked" };
  return { action: "addressed", label: "Mark Addressed" };
}

function scrollToAdminSection(sectionId) {
  const section = document.querySelector(`#${sectionId}`);
  if (!section) return;
  if (section.tagName === "DETAILS") section.open = true;
  const parentDetails = section.closest("details");
  if (parentDetails) parentDetails.open = true;
  section.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getAuditDetailText(detail) {
  if (!detail) return "";
  if (typeof detail === "string") return detail;
  const reason = detail.reason || detail.message || detail.note || detail.status || "";
  const credits = detail.credits || detail.credits_used || "";
  const balance = detail.balance_after || detail.balance || "";
  const parts = [];
  if (reason) parts.push(reason);
  if (credits) parts.push(`Credits: ${credits}`);
  if (balance !== "") parts.push(`Balance: ${balance}`);
  return parts.length ? parts.join(". ") : JSON.stringify(detail);
}

function isSelectedAdminRecord(record, client = getSelectedAdminClient()) {
  if (!client?.id && !client?.email && !client?.name) return false;
  if (!client?.id && client?.email) return record.clientEmail === client.email || record.client_email === client.email;
  if (!client?.id && client?.name) return record.client === client.name;
  if (!client?.id) return false;
  return record.organizationId === client.id || record.organization_id === client.id;
}

function isSelectedAdminProjectRecord(record, project = getSelectedAdminProject()) {
  const recordProjectId = record.projectId || record.project_id || record.deliverable_versions?.project_id || record.requests?.project_id || "";
  if (!project?.id) {
    const recordProjectStatus =
      record.projectStatus ||
      record.project_status ||
      record.client_projects?.status ||
      record.project?.status ||
      getProjectById(recordProjectId, state.adminProjects)?.status ||
      "";
    return recordProjectStatus ? isActiveProject({ status: recordProjectStatus }) : true;
  }
  return String(recordProjectId || "") === String(project.id);
}

function isSelectedAdminScopedRecord(record, client = getSelectedAdminClient(), project = getSelectedAdminProject()) {
  return isSelectedAdminRecord(record, client) && isSelectedAdminProjectRecord(record, project);
}

function getSelectedAdminQueueItems() {
  const selectedClient = getSelectedAdminClient();
  const applyFocus = (items) =>
    state.adminQueueFocus === "quote"
      ? items.filter((item) => item.queueType === "quote")
      : items;
  if (!state.selectedAdminClientId) return applyFocus(state.adminQueue.filter(isAdminQueueOpenItem));
  if (!selectedClient.id && !selectedClient.email && !selectedClient.name) return [];
  return applyFocus(state.adminQueue.filter((item) => isSelectedAdminScopedRecord(item, selectedClient) && isAdminQueueOpenItem(item)));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setTextContent(selector, value) {
  const element = document.querySelector(selector);
  if (element && value) element.textContent = value;
}

function cardHtml(item) {
  return `
    <article>
      <span>${escapeHtml(item.label || "")}</span>
      <strong>${escapeHtml(item.title || "")}</strong>
      <small>${escapeHtml(item.body || "")}</small>
    </article>
  `;
}

function faqDetailsHtml(item) {
  return `
    <details class="capability-card faq-card">
      <summary>
        <span>Question</span>
        <strong>${escapeHtml(item.question || "")}</strong>
      </summary>
      <p>${escapeHtml(item.answer || "")}</p>
    </details>
  `;
}

function renderContentDrivenSections() {
  const hero = siteContent.hero || {};
  setTextContent('[data-content="hero-eyebrow"]', hero.eyebrow);
  setTextContent('[data-content="hero-headline"]', hero.headline);
  setTextContent('[data-content="hero-benefit"]', hero.benefit);
  setTextContent('[data-content="hero-body"]', hero.body);

  const proofGrid = document.querySelector('[data-render="hero-proof"]');
  if (proofGrid && Array.isArray(hero.proofPoints)) {
    proofGrid.innerHTML = hero.proofPoints
      .map(
        (item) => `
          <article>
            <strong>${escapeHtml(item.title || "")}</strong>
            <span>${escapeHtml(item.body || "")}</span>
          </article>
        `
      )
      .join("");
  }

  const offer = siteContent.advisoryOffer || {};
  const offerPanel = document.querySelector('[data-render="advisory-offer"]');
  if (offerPanel && offer.headline) {
    offerPanel.innerHTML = `
      <div class="card-head">
        <span>${escapeHtml(offer.eyebrow || "")}</span>
        <strong>${escapeHtml(offer.headline || "")}</strong>
      </div>
      <p class="offer-intro">${escapeHtml(offer.intro || "")}</p>
      <div class="offer-flow" aria-label="Business Analysis offer flow">
        ${(offer.steps || []).map((step) => `<span>${escapeHtml(step)}</span>`).join("")}
      </div>
      <div class="advisory-scorecard offer-stack">
        ${(offer.cards || [])
          .map(
            (item) => `
              <article>
                <span>${escapeHtml(item.number || "")}</span>
                <div>
                  <em>${escapeHtml(item.label || "")}</em>
                  <strong>${escapeHtml(item.title || "")}</strong>
                  <small>${escapeHtml(item.body || "")}</small>
                </div>
              </article>
            `
          )
          .join("")}
      </div>
      <div class="offer-result">
        <strong>${escapeHtml(offer.resultLabel || "")}</strong>
        <span>${escapeHtml(offer.result || "")}</span>
      </div>
    `;
  }

  const outcomes = siteContent.representativeOutcomes || {};
  setTextContent('[data-content="outcomes-eyebrow"]', outcomes.eyebrow);
  setTextContent('[data-content="outcomes-headline"]', outcomes.headline);
  setTextContent('[data-content="outcomes-body"]', outcomes.body);
  const outcomesGrid = document.querySelector('[data-render="representative-outcomes"]');
  if (outcomesGrid && Array.isArray(outcomes.items)) {
    outcomesGrid.innerHTML = outcomes.items.map(cardHtml).join("");
  }

  const services = siteContent.services || {};
  setTextContent('[data-content="services-eyebrow"]', services.eyebrow);
  setTextContent('[data-content="services-headline"]', services.headline);
  setTextContent('[data-content="services-body"]', services.body);
  const servicesGrid = document.querySelector('[data-render="services-grid"]');
  if (servicesGrid && Array.isArray(services.items)) {
    servicesGrid.innerHTML = services.items.map(cardHtml).join("");
  }

  const faq = siteContent.faq || {};
  setTextContent('[data-content="faq-eyebrow"]', faq.eyebrow);
  setTextContent('[data-content="faq-headline"]', faq.headline);
  setTextContent('[data-content="faq-body"]', faq.body);

  const faqFeatured = document.querySelector('[data-render="faq-featured"]');
  if (faqFeatured && Array.isArray(faq.featured)) {
    faqFeatured.innerHTML = faq.featured
      .map(
        (item) => `
          <article>
            <strong>${escapeHtml(item.question || "")}</strong>
            <p>${escapeHtml(item.answer || "")}</p>
          </article>
        `
      )
      .join("");
  }

  const faqBoard = document.querySelector('[data-render="faq-categories"]');
  if (faqBoard && Array.isArray(faq.categories)) {
    faqBoard.innerHTML = faq.categories
      .map(
        (category) => `
          <section class="faq-category">
            <div>
              <span>${escapeHtml(category.title || "")}</span>
              <p>${escapeHtml(category.description || "")}</p>
            </div>
            <div class="capability-board">
              ${(category.questions || []).map(faqDetailsHtml).join("")}
            </div>
          </section>
        `
      )
      .join("");
  }
}

function getLowCreditMessage() {
  return getCreditAlertState().message;
}

function getCreditPromptHtml() {
  const availableCredits = getAvailableCredits();
  if (availableCredits <= 0) {
    return `No Advisory Credits remain. <a href="#billing" data-action="buy-topup">Add a Credit Top Up</a> before starting new credit based work.`;
  }
  if (availableCredits <= state.creditThreshold) {
    return `${availableCredits} Advisory Credits remain. <a href="#billing" data-action="buy-topup">Add a Credit Top Up</a> before the next deliverable is scoped.`;
  }
  if (Number(state.reservedCredits || 0) > 0) {
    return `${availableCredits} Advisory Credits are available after ${state.reservedCredits} reserved for active work.`;
  }
  return "Your workspace has enough Advisory Credits for the current delivery cycle.";
}

function getRequestCreditScope() {
  const estimateValue = document.querySelector("#requestCreditEstimate")?.value || "1";
  const requestedCredits = estimateValue === "custom" || estimateValue === "rescue" ? 0 : Number(estimateValue || 1);
  return {
    estimateValue,
    requestedCredits: Number.isFinite(requestedCredits) ? requestedCredits : 1,
  };
}

function getInsufficientCreditMessage(requestedCredits, balance = state.creditsLeft) {
  const safeBalance = Math.max(0, Number(balance || 0));
  return `This request needs ${requestedCredits} Advisory Credit${requestedCredits === 1 ? "" : "s"}. Your workspace currently has ${safeBalance}. Add credits in Billing, or choose Custom Scope if this work should be priced separately.`;
}

function updateRequestReadinessStatus(files = []) {
  const statusSelector = "#requestStatus";
  const { estimateValue, requestedCredits } = getRequestCreditScope();
  const selectedFiles = Array.from(files || document.querySelector("#fileUpload")?.files || []);
  const validationError = selectedFiles.length ? validateWorkspaceFiles(selectedFiles) : "";
  const projectSelect = document.querySelector("#requestProjectSelect");
  const needsNewProjectName = projectSelect && (projectSelect.value === "__new__" || !projectSelect.value);
  const hasProjectName = Boolean(normalizeProjectName(document.querySelector("#requestProjectName")?.value || ""));

  if (validationError) {
    setInlineStatus(statusSelector, validationError, "warning");
    return;
  }

  if (!selectedFiles.length) {
    setInlineStatus(statusSelector, "Requests are checked against your profile, credit balance, and selected files before submission.");
    return;
  }

  if (needsNewProjectName && !hasProjectName) {
    setInlineStatus(statusSelector, "Files selected. Choose an existing project or enter a new project name before submitting.", "warning");
    return;
  }

  if (estimateValue === "custom") {
    setInlineStatus(statusSelector, "Files selected. Custom advisory work is reviewed through the custom scope form.", "success");
    return;
  }

  if (estimateValue === "rescue") {
    setInlineStatus(statusSelector, "Files selected. Submit once your Rescue Sprint purchase is connected to this workspace.", "success");
    return;
  }

  const availableCredits = getAvailableCredits();
  if (requestedCredits > 0 && availableCredits < requestedCredits) {
    setInlineStatus(statusSelector, getInsufficientCreditMessage(requestedCredits, availableCredits), "warning");
    return;
  }

  setInlineStatus(statusSelector, `${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} selected. Complete the request details and submit when ready.`, "success");
}

function withClientTimeout(promise, timeoutMs, message) {
  let timerId;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timerId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => window.clearTimeout(timerId));
}

function getFriendlyWorkspaceError(error, fallback = "The workspace request could not be completed.") {
  const message = typeof error === "string" ? error : error?.message || "";
  if (!message) return fallback;
  const lower = message.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("took too long")) {
    return "The request took too long. Please refresh the workspace and try again.";
  }
  if (lower.includes("network") || lower.includes("failed to fetch")) {
    return "The workspace connection was interrupted. Please check your connection and try again.";
  }
  if (lower.includes("jwt") || lower.includes("token") || lower.includes("auth")) {
    return "Your secure session needs to be refreshed. Please sign out, then sign in again.";
  }
  return fallback;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000, timeoutMessage = "The request took too long.") {
  const controller = new AbortController();
  const timerId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: options.signal || controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    window.clearTimeout(timerId);
  }
}

async function refreshCreditBalanceForSubmit(organizationId) {
  if (!supabaseClient || !organizationId) {
    return { ok: true, balance: Number(state.creditsLeft || 0) };
  }

  const { data, error } = await supabaseClient
    .rpc("get_current_credit_balance", {
      p_organization_id: organizationId,
    })
    .maybeSingle();

  if (error) return { ok: false, error: error.message };

  const balance = Number(data?.balance ?? 0);
  const reservedBalance = Number(data?.reserved_balance ?? 0);
  const availableBalance = Math.max(0, balance - reservedBalance);
  state.creditsLeft = balance;
  state.reservedCredits = reservedBalance;
  state.creditThreshold = Number(data?.low_credit_threshold ?? config.lowCreditThreshold);
  saveState();
  render();
  return { ok: true, balance: availableBalance, totalBalance: balance, reservedBalance };
}

function getStatusGroup(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("complete") || normalized.includes("delivered")) return "completed";
  if (normalized.includes("review")) return "inReview";
  if (normalized.includes("pause") || normalized.includes("awaiting credit") || normalized.includes("attention") || normalized.includes("blocked")) return "paused";
  return "pending";
}

function getStatusLabel(group) {
  return {
    pending: "pending",
    inReview: "in review",
    paused: "paused",
    completed: "completed",
  }[group] || "pending";
}

function normalizeVerificationStatus(value) {
  const status = String(value || "").trim();
  if (!status) return "Released for client review";
  const normalized = normalizeStatusValue(status);
  const labels = {
    pending_scope: "Ready for advisory scoping",
    "pending scope": "Ready for advisory scoping",
    file_upload_attention: "File upload needs attention",
    "file upload attention": "File upload needs attention",
    awaiting_credit: "Waiting for credit top up",
    "awaiting credit": "Waiting for credit top up",
    admin_email_pending: "Email delivery needs review",
    "admin email pending": "Email delivery needs review",
    queued: "Queued for delivery",
    received: "Received",
    approved: "Approved",
    reviewed: "Reviewed",
    addressed: "Addressed",
    dismissed: "Dismissed",
    checked: "Checked",
    delivered: "Delivered",
    completed: "Completed",
    sent: "Sent",
    paid: "Paid",
    failed: "Needs review",
  };
  if (labels[normalized]) return labels[normalized];
  return status
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getVerificationLevel(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("approved") || normalized.includes("accepted") || normalized.includes("complete")) return "approved";
  if (normalized.includes("revision") || normalized.includes("change") || normalized.includes("review")) return "review";
  if (normalized.includes("blocked") || normalized.includes("issue")) return "blocked";
  return "ready";
}

function getDeliverableReleasedAt(deliverable) {
  return deliverable?.updatedAt || deliverable?.versions?.[0]?.uploadedAt || "";
}

function isNewDeliverable(deliverable) {
  const releasedAt = getDeliverableReleasedAt(deliverable);
  if (!releasedAt) return false;
  return Date.now() - new Date(releasedAt).getTime() <= 14 * 24 * 60 * 60 * 1000;
}

function getAuthRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

function getNormalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isStrongPassword(password) {
  const value = String(password || "");
  return (
    value.length >= 12 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

function getFriendlyAuthError(error, fallback = "Account access could not be completed.") {
  const rawMessage = typeof error === "string" ? error : error?.message || "";
  const message = rawMessage.toLowerCase();
  if (!rawMessage) return fallback;
  if (message.includes("already") || message.includes("registered")) {
    return "An account may already exist for this email. Please sign in or reset your password.";
  }
  if (message.includes("invalid login") || message.includes("invalid credentials")) {
    return "The email or password does not match an active account. Please check the details or reset your password.";
  }
  if (message.includes("email not confirmed") || message.includes("confirm")) {
    return "Please verify your email before signing in. Check your inbox for the BA Advisory Desk email.";
  }
  if (message.includes("rate") || message.includes("too many")) {
    return "Too many attempts were made. Please wait a few minutes and try again.";
  }
  return fallback;
}

function validatePasswordPair(password, confirm) {
  if (!isStrongPassword(password)) {
    return "Password must be at least 12 characters and include upper and lower case letters, a number, and a symbol.";
  }
  if (password !== confirm) {
    return "Password confirmation does not match.";
  }
  return "";
}

function syncAuthEmailFields(email = state.client.email || getUserEmail()) {
  const normalized = getNormalizedEmail(email);
  setFieldValue("#passwordLoginEmail", normalized);
  setFieldValue("#passwordSignupEmail", normalized);
  setFieldValue("#passwordResetEmail", normalized);
}

function clearPublicAuthFields() {
  [
    "#passwordLoginEmail",
    "#passwordSignupEmail",
    "#passwordResetEmail",
    "#passwordSignupCompany",
    "#passwordLoginPassword",
    "#passwordSignupPassword",
    "#passwordSignupConfirm",
    "#passwordRecoveryNew",
    "#passwordRecoveryConfirm",
  ].forEach((selector) => {
    const field = document.querySelector(selector);
    if (field) field.value = "";
  });
}

function clearClientForms() {
  ["#profileForm", "#requestForm", "#clientMessageForm", "#clientUploadForm", "#quoteForm"].forEach((formSelector) => {
    const form = document.querySelector(formSelector);
    if (!form) return;
    form.querySelectorAll("input, textarea, select").forEach((field) => {
      if (field.type === "checkbox" || field.type === "radio") {
        field.checked = Boolean(field.defaultChecked);
      } else if (field.tagName === "SELECT") {
        field.selectedIndex = 0;
      } else {
        field.value = "";
      }
    });
  });

  [
    ["#fileList", "No files selected yet."],
    ["#clientUploadFileList", "No files selected yet."],
    ["#adminDeliverableFileList", "No deliverable files selected yet."],
  ].forEach(([selector, text]) => {
    const node = document.querySelector(selector);
    if (node) node.textContent = text;
  });
}

function getUserEmail() {
  return state.session?.user?.email || "";
}

function getUserMetadata() {
  return state.session?.user?.user_metadata || {};
}

function getProviderName(provider) {
  return {
    google: "Google",
    apple: "Apple",
  }[provider] || "the selected sign in option";
}

function getAuthProvider() {
  return state.session?.user?.app_metadata?.provider || state.session?.user?.identities?.[0]?.provider || "";
}

function getPendingPostAuthRoute() {
  return localStorage.getItem("baad-post-auth-route");
}

function setPendingPostAuthRoute(route) {
  localStorage.setItem("baad-post-auth-route", route || "dashboard");
}

function applyPendingPostAuthRoute() {
  if (!state.session?.user) return;
  const pendingRoute = getPendingPostAuthRoute();
  if (!pendingRoute) return;
  const route = isAdminUser() ? "admin" : routeAliases[pendingRoute] || pendingRoute;
  localStorage.removeItem("baad-post-auth-route");
  if (route && window.location.hash.replace("#", "") !== route) {
    window.location.hash = route;
  }
}

function getPendingCheckoutType() {
  return localStorage.getItem("baad-pending-checkout");
}

function setPendingCheckoutType(type) {
  if (type) {
    localStorage.setItem("baad-pending-checkout", type);
  }
}

function clearPendingCheckoutType() {
  localStorage.removeItem("baad-pending-checkout");
}

function setPendingCheckoutSessionId(sessionId) {
  if (sessionId) localStorage.setItem("baad-pending-checkout-session-id", sessionId);
}

function getPendingCheckoutSessionId() {
  return localStorage.getItem("baad-pending-checkout-session-id") || "";
}

function clearPendingCheckoutSessionId() {
  localStorage.removeItem("baad-pending-checkout-session-id");
}

function isEmailVerified() {
  const user = state.session?.user;
  if (!user) return false;
  return Boolean(user.email_confirmed_at || user.confirmed_at || user.user_metadata?.email_verified);
}

function resetClientWorkspaceState() {
  state.session = null;
  resetAdminAccessState();
  clearPublicAuthFields();
  clearClientForms();
  state.client = { email: "", company: "" };
  state.requests = [];
  state.deliverables = [];
  state.clientMessages = [];
  state.clientUploads = [];
  state.requestFiles = [];
  state.clientProjects = [];
  state.selectedProjectId = "";
  state.creditHistory = [];
  state.auditEvents = [];
  state.paymentHistory = [];
  state.adminQueue = [];
  state.adminClients = [];
  state.adminDeliverables = [];
  state.adminDeliverableFiles = [];
  state.adminClientUploads = [];
  state.adminRequestFiles = [];
  state.adminProjects = [];
  state.adminCreditLedger = [];
  state.adminPaymentHistory = [];
  state.adminAuditEvents = [];
  state.selectedAdminClientId = "";
  state.creditsLeft = 0;
  state.reservedCredits = 0;
  state.creditThreshold = 2;
  state.passwordRecovery = false;
  state.profileOrganizationId = "";
  state.selectedAdminProjectId = "";
  clearPrivateWorkspaceStorage();
  localStorage.removeItem("baad-post-auth-route");
  clearPendingCheckoutType();
  clearPendingCheckoutSessionId();
}

function clearSupabaseAuthStorage() {
  const keys = new Set(["supabase.auth.token"]);
  try {
    const projectRef = config.supabaseUrl ? new URL(config.supabaseUrl).hostname.split(".")[0] : "";
    if (projectRef) {
      keys.add(`sb-${projectRef}-auth-token`);
      keys.add(`sb-${projectRef}-auth-token-code-verifier`);
    }
  } catch (_error) {
    // If the project URL cannot be parsed, the generic cleanup below still runs.
  }

  [localStorage, sessionStorage].forEach((storage) => {
    if (!storage) return;
    Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter(Boolean)
      .filter((key) => keys.has(key) || key.startsWith("sb-") && key.includes("-auth-token"))
      .forEach((key) => storage.removeItem(key));
  });
}

function isProtectedRoute(route) {
  return new Set(["dashboard", "profile", "request", "billing", "checkout-success", "admin", "messages", "files", "deliverables"]).has(route);
}

function closeNavigationMenus() {
  document.querySelectorAll("[data-nav-menu].open").forEach((menu) => {
    menu.classList.remove("open");
    menu.querySelector("[data-nav-toggle]")?.setAttribute("aria-expanded", "false");
  });
}

function clearSensitiveAuthFields() {
  [
    "#passwordLoginPassword",
    "#passwordSignupPassword",
    "#passwordSignupConfirm",
    "#passwordRecoveryNew",
    "#passwordRecoveryConfirm",
    "#accountNewPassword",
    "#accountConfirmPassword",
  ].forEach((selector) => {
    const field = document.querySelector(selector);
    if (field) field.value = "";
  });
}

function scrollPageToStart() {
  const setTop = () => {
    if (typeof window.scrollTo === "function") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      return;
    }
    const scrollRoot = document.scrollingElement || document.documentElement || document.body;
    if (scrollRoot) scrollRoot.scrollTop = 0;
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  };
  window.requestAnimationFrame(() => {
    setTop();
    window.requestAnimationFrame(setTop);
  });
}

function openClientWorkspaceSection(routeKey) {
  const sectionMap = {
    deliverables: "#clientDeliverablesList",
    messages: "#clientWorkspaceMessages",
    files: "#clientWorkspaceFiles",
  };
  const targetSelector = sectionMap[routeKey];
  if (!targetSelector) return;

  if (routeKey === "messages" || routeKey === "files") {
    const detail = document.querySelector(targetSelector);
    if (detail) detail.open = true;
  }

  window.requestAnimationFrame(() => {
    document.querySelector(targetSelector)?.scrollIntoView({ block: "start", behavior: "auto" });
  });
}

async function routeAfterAuth(defaultRoute = "dashboard") {
  if (!state.session?.user) return;
  const currentRoute = routeAliases[window.location.hash.replace("#", "")] || window.location.hash.replace("#", "");
  if (!isEmailVerified()) {
    localStorage.removeItem("baad-post-auth-route");
    window.location.hash = "login";
    setAuthStatus("Please verify your email before opening the client workspace.");
    return;
  }
  const isAdmin = await refreshAdminStatus(true);
  updateAuthUi();
  if (isAdmin) {
    localStorage.removeItem("baad-post-auth-route");
    if (window.location.hash.replace("#", "") === "admin") {
      setView();
    } else {
      window.location.hash = "admin";
    }
    return;
  }

  let organizationId = "";
  try {
    organizationId = await withClientTimeout(
      getProfileOrganizationId(),
      10000,
      "Profile verification took too long. Refresh the workspace and try again."
    );
  } catch (error) {
    setAuthStatus(error.message || "Profile verification could not be completed. Please refresh and sign in again.");
    return;
  }
  if (organizationId && getPendingCheckoutType()) {
    await resumePendingCheckout();
    return;
  }
  const pendingRoute = currentRoute === "checkout-success" ? "checkout-success" : getPendingPostAuthRoute() || defaultRoute;
  localStorage.removeItem("baad-post-auth-route");
  const nextRoute = organizationId ? pendingRoute : "profile";
  if (window.location.hash.replace("#", "") === nextRoute) {
    setView();
    return;
  }
  window.location.hash = nextRoute;
}

function getAuthErrorMessage() {
  const params = new URLSearchParams(window.location.search);
  const hashValue = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const hashParams = new URLSearchParams(hashValue);
  const error = params.get("error_description") || params.get("error") || hashParams.get("error_description") || hashParams.get("error");
  return error
    ? getFriendlyAuthError(decodeURIComponent(error).replace(/\+/g, " "), "Sign in could not be completed. Please choose a sign in option and try again.")
    : "";
}

function isPasswordRecoveryUrl() {
  const hashValue = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const hashParams = new URLSearchParams(hashValue);
  const queryParams = new URLSearchParams(window.location.search);
  return hashParams.get("type") === "recovery" || queryParams.get("type") === "recovery";
}

function isAdminUser() {
  return Boolean(state.session?.user && state.adminAccess);
}

function resetAdminAccessState() {
  state.adminAccess = false;
  state.adminStatusChecked = false;
  state.adminStatusUserId = "";
}

async function refreshAdminStatus(force = false) {
  const userId = getUserId();
  if (!state.session?.user || !userId) {
    resetAdminAccessState();
    return false;
  }

  if (!force && state.adminStatusChecked && state.adminStatusUserId === userId) {
    return state.adminAccess;
  }

  const result = await fetchAdminApi("/api/admin-session");
  state.adminAccess = Boolean(result.ok && result.data?.isAdmin);
  state.adminStatusChecked = true;
  state.adminStatusUserId = userId;
  return state.adminAccess;
}

async function ensureAdminAccess() {
  if (isAdminUser()) return true;
  return refreshAdminStatus(true);
}

function setAuthStatus(message) {
  const status = document.querySelector("#authStatus");
  if (status) {
    status.textContent = message;
    status.classList.remove("hidden");
  }
}

function updateAuthUi() {
  const isSignedIn = Boolean(state.session?.user);
  const loginButton = document.querySelector("#loginButton");
  const signOutButtons = document.querySelectorAll("[data-sign-out]");
  const providerButtons = document.querySelectorAll("[data-provider]");
  const emailAuthGrid = document.querySelector(".email-auth-grid");
  const authIntro = document.querySelector(".auth-intro");
  const authDivider = document.querySelector(".auth-divider");
  const ssoActions = document.querySelector(".sso-actions");
  const resetForm = document.querySelector("#passwordResetForm");
  const recoveryForm = document.querySelector("#passwordRecoveryForm");
  const showEmailOptions = !isSignedIn && !state.passwordRecovery;
  const enabledProviders = config.authProviders || {};
  const enabledProviderCount = ["google", "apple"].filter((provider) => enabledProviders[provider] !== false).length;

  if (loginButton) {
    loginButton.textContent = isSignedIn ? "Go To Dashboard" : "Client Login";
  }

  providerButtons.forEach((button) => {
    const provider = button.dataset.provider;
    button.classList.toggle("hidden", !showEmailOptions || enabledProviders[provider] === false);
  });
  ssoActions?.classList.toggle("hidden", !showEmailOptions || enabledProviderCount === 0);
  if (authIntro && !isSignedIn) {
    const providerLabels = [
      enabledProviders.google === false ? "" : "Google",
      enabledProviders.apple ? "Apple" : "",
      enabledProviders.emailPassword === false ? "" : "email and password",
    ].filter(Boolean);
    const formattedProviders =
      providerLabels.length > 2
        ? `${providerLabels.slice(0, -1).join(", ")}, or ${providerLabels.at(-1)}`
        : providerLabels.join(" or ");
    authIntro.textContent = `Use ${formattedProviders || "a secure account"} to access your client workspace.`;
  }
  authIntro?.classList.toggle("hidden", !showEmailOptions);
  authDivider?.classList.toggle("hidden", !showEmailOptions || enabledProviderCount === 0);
  emailAuthGrid?.classList.toggle("hidden", !showEmailOptions);
  resetForm?.classList.add("hidden");
  recoveryForm?.classList.toggle("hidden", !state.passwordRecovery);

  signOutButtons.forEach((button) => button.classList.toggle("hidden", !isSignedIn));

  if (isSignedIn) {
    state.client.email = getUserEmail() || state.client.email;
    syncAuthEmailFields(state.client.email);
    setFieldValue("#quoteEmail", state.client.email);
    document.querySelector("#accountSecurityForm")?.classList.toggle("hidden", getAuthProvider() !== "email");
    saveState();
    if (state.passwordRecovery) {
      setAuthStatus("Enter a new password to finish securing your account.");
    } else if (!isEmailVerified()) {
      setAuthStatus("Please verify your email before opening the client workspace.");
    } else {
      setAuthStatus(isAdminUser() ? `Signed in as ${state.client.email}. Admin access is available.` : `Signed in as ${state.client.email}.`);
    }
  } else {
    clearPublicAuthFields();
    document.querySelector("#accountSecurityForm")?.classList.add("hidden");
    const requestedRoute = getPendingPostAuthRoute() || window.location.hash.replace("#", "");
    setAuthStatus(
      state.passwordRecovery
        ? "Enter a new password to finish securing your account."
        : requestedRoute === "admin"
        ? "Please sign in with the administrator email to open the admin workspace."
        : "Sign in or create an account with your work email."
    );
  }
}

async function signOutCurrentUser(event) {
  event?.preventDefault();
  resetClientWorkspaceState();
  updateAuthUi();
  window.history.replaceState(null, "", `${window.location.pathname}#login`);
  setView();
  try {
    if (supabaseClient) {
      await withClientTimeout(
        supabaseClient.auth.signOut(),
        8000,
        "Remote sign out took longer than expected. Your local session has been cleared."
      );
    }
  } catch (_error) {
    // Local session has already been cleared so the client is not left trapped in the workspace.
  } finally {
    clearSupabaseAuthStorage();
    showToast("Signed out.");
  }
}

async function initAuth() {
  state.passwordRecovery = isPasswordRecoveryUrl();

  if (!supabaseClient) {
    setAuthStatus("Secure account access is temporarily unavailable. Please contact support for assistance.");
    return;
  }

  let sessionData = null;
  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
      clearSupabaseAuthStorage();
      setAuthStatus("Your previous session expired. Please sign in again.");
    }
    sessionData = data;
  } catch (_error) {
    clearSupabaseAuthStorage();
    setAuthStatus("Your previous session expired. Please sign in again.");
  }

  state.session = sessionData?.session || null;
  if (state.session?.user) {
    if (state.passwordRecovery) {
      window.history.replaceState(null, "", `${window.location.pathname}#login`);
    } else if (!isEmailVerified()) {
      setAuthStatus("Please verify your email before opening the secure workspace.");
    } else {
      await loadSignedInProfile();
      await loadClientWorkspaceData();
      await refreshAdminStatus(true);
      await routeAfterAuth();
    }
  }
  updateAuthUi();

  const authError = getAuthErrorMessage();
  if (authError) {
    setAuthStatus(authError);
  }

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    state.session = session;
    if (event === "PASSWORD_RECOVERY") {
      state.passwordRecovery = true;
      window.location.hash = "login";
      updateAuthUi();
      render();
      return;
    }
    updateAuthUi();
    if (session?.user && !state.passwordRecovery && isEmailVerified()) {
      await loadSignedInProfile();
      await loadClientWorkspaceData();
      await refreshAdminStatus(true);
      updateAuthUi();
      await routeAfterAuth();
      render();
    } else if (session?.user && !state.passwordRecovery) {
      setAuthStatus("Please verify your email before opening the secure workspace.");
      resetAdminAccessState();
      render();
    } else {
      const currentRoute = routeAliases[window.location.hash.replace("#", "")] || window.location.hash.replace("#", "");
      resetClientWorkspaceState();
      if (isProtectedRoute(currentRoute)) {
        window.history.replaceState(null, "", `${window.location.pathname}#login`);
        setView();
      }
      updateAuthUi();
      render();
    }
  });
}

function getUserId() {
  return state.session?.user?.id || null;
}

async function getSessionAccessToken() {
  if (state.session?.access_token) {
    return state.session.access_token;
  }

  if (!supabaseClient) {
    return null;
  }

  const { data } = await supabaseClient.auth.getSession();
  state.session = data.session;
  updateAuthUi();
  return data.session?.access_token || null;
}

async function fetchAdminApi(path, options = {}) {
  const token = await getSessionAccessToken();
  if (!token) {
    return { ok: false, error: "Please sign in with the administrator email before using the operations workspace." };
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };

  try {
    const response = await fetchWithTimeout(path, {
      ...options,
      headers,
      body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
    }, options.timeoutMs || 20000, "The admin request took too long. Please refresh the operations workspace and try again.");
    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_error) {
        data = { error: "The admin service returned an unexpected response." };
      }
    }
    return response.ok ? { ok: true, status: response.status, data } : { ok: false, status: response.status, error: getFriendlyWorkspaceError(data.error, "The admin request could not be completed.") };
  } catch (error) {
    return { ok: false, status: 0, error: getFriendlyWorkspaceError(error, "The admin request could not be completed.") };
  }
}

async function fetchClientApi(path, options = {}) {
  const token = await getSessionAccessToken();
  if (!token) {
    return { ok: false, error: "Please sign in before opening this workspace item." };
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };

  try {
    const response = await fetchWithTimeout(path, {
      ...options,
      headers,
      body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
    }, options.timeoutMs || 20000, "The secure workspace request took too long. Please refresh and try again.");
    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_error) {
        data = { error: "The secure workspace returned an unexpected response." };
      }
    }
    return response.ok ? { ok: true, status: response.status, data } : { ok: false, status: response.status, error: getFriendlyWorkspaceError(data.error, "The secure workspace request could not be completed.") };
  } catch (error) {
    return { ok: false, status: 0, error: getFriendlyWorkspaceError(error, "The secure workspace request could not be completed.") };
  }
}

function encodeStorageObjectPath(path) {
  return String(path || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function uploadFileToStorageBucket(bucketName, storagePath, file, timeoutMs) {
  const token = await withClientTimeout(
    getSessionAccessToken(),
    10000,
    "Your secure session could not be confirmed quickly enough. Please refresh the workspace and try again."
  );
  if (!token) {
    return { error: new Error("Your secure session needs to be refreshed. Please sign out, then sign in again.") };
  }
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    return { error: new Error("Secure file upload is not configured.") };
  }

  try {
    const response = await fetchWithTimeout(
      `${config.supabaseUrl}/storage/v1/object/${encodeURIComponent(bucketName)}/${encodeStorageObjectPath(storagePath)}`,
      {
        method: "POST",
        headers: {
          apikey: config.supabaseAnonKey,
          Authorization: `Bearer ${token}`,
          "Content-Type": getUploadContentType(file),
          "x-upsert": "false",
        },
        body: file,
      },
      timeoutMs,
      `${file.name} took too long to upload. Please try again with a smaller file or contact ${config.supportEmail}.`
    );
    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_error) {
        data = { message: text };
      }
    }
    if (!response.ok) {
      return { error: new Error(data.error || data.message || "File could not be uploaded.") };
    }
    return { data };
  } catch (error) {
    return { error };
  }
}

async function fetchMaybeAuthedApi(path, options = {}) {
  const token = await getSessionAccessToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  try {
    const response = await fetchWithTimeout(path, {
      method: options.method || "POST",
      ...options,
      headers,
      body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
    }, options.timeoutMs || 20000, "The request took too long. Please refresh and try again.");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: getFriendlyWorkspaceError(data.error, "Request could not be completed.") };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: getFriendlyWorkspaceError(error, "Request could not be completed.") };
  }
}

let checkoutReconcileSessionId = "";
let authStartupComplete = false;

function getCheckoutSessionId() {
  const sessionId = new URLSearchParams(window.location.search).get("session_id") || "";
  if (sessionId) {
    setPendingCheckoutSessionId(sessionId);
    return sessionId;
  }
  return getPendingCheckoutSessionId();
}

function setCheckoutStatus({ title, body, status, level = "", panelHtml = "" }) {
  const titleNode = document.querySelector("#checkoutStatusTitle");
  const bodyNode = document.querySelector("#checkoutStatusBody");
  const statusNode = document.querySelector("#checkoutStatusMessage");
  const panelNode = document.querySelector("#checkoutStatusPanel");
  if (titleNode && title) titleNode.textContent = title;
  if (bodyNode && body) bodyNode.textContent = body;
  if (statusNode && status) setInlineStatus("#checkoutStatusMessage", status, level);
  if (panelNode && panelHtml) panelNode.innerHTML = panelHtml;
}

function getCheckoutEmailText(emailResult) {
  if (!emailResult?.attempted) return "Payment is recorded in your workspace.";
  if (emailResult.sent) return "A payment confirmation email has been sent.";
  if (emailResult.skipped) return "Payment is recorded. Your workspace and billing history are the source of truth.";
  if (emailResult.error) return "Payment is recorded. We could not send the confirmation email automatically.";
  return "Payment is recorded. Confirmation email status is being finalized.";
}

async function handleCheckoutSuccessView() {
  const sessionId = getCheckoutSessionId();
  if (!sessionId) {
    setCheckoutStatus({
      title: "Checkout is complete.",
      body: "Open your client workspace to continue. If your credit balance does not update, contact support and include the email used at checkout.",
      status: "No checkout reference was found on this page. Your workspace can still be reviewed from billing.",
      level: "warning",
    });
    return;
  }

  if (!state.session?.user) {
    setPendingPostAuthRoute("checkout-success");
    setCheckoutStatus({
      title: authStartupComplete ? "Sign in to finish connecting your payment." : "Restoring your secure session.",
      body: authStartupComplete
        ? "Use the same email address used at checkout so the payment can be attached to your client workspace."
        : "Please stay on this confirmation page while we check your secure client session.",
      status: authStartupComplete ? "Please sign in, then return to this confirmation page." : "Checking your secure session.",
      level: authStartupComplete ? "warning" : "",
    });
    return;
  }

  if (checkoutReconcileSessionId === sessionId) return;
  checkoutReconcileSessionId = sessionId;
  setCheckoutStatus({
    title: "Checkout complete. Confirming your workspace now.",
    body: "Please stay on this page while we confirm the payment, update the credit balance, and refresh your billing history.",
    status: "Confirming payment and updating your Advisory Credit balance.",
  });

  const priorCredits = Number(state.creditsLeft || 0);
  let result;
  try {
    result = await withClientTimeout(
      fetchClientApi("/api/create-checkout-session", {
        method: "POST",
        body: {
          action: "reconcile_checkout",
          sessionId,
        },
      }),
      15000,
      "Payment confirmation is taking longer than expected. Please open billing and try again."
    );
  } catch (error) {
    result = {
      ok: false,
      status: 0,
      error: error.message || "Payment confirmation is taking longer than expected. Please open billing and try again.",
    };
  }

  if (!result.ok) {
    checkoutReconcileSessionId = "";
    await withClientTimeout(loadClientWorkspaceData(), 8000, "Workspace refresh is taking longer than expected.").catch(() => null);
    render();
    const creditsNow = Number(state.creditsLeft || 0);
    if (creditsNow > priorCredits) {
      clearPendingCheckoutType();
      clearPendingCheckoutSessionId();
      setCheckoutStatus({
        title: "Payment confirmed.",
        body: `Your workspace billing has been updated. Your current Advisory Credit balance is ${creditsNow}.`,
        status: "Use the button below when you are ready to return to the workspace.",
        level: "success",
        panelHtml: `
          <h3>Payment confirmation</h3>
          <ul class="check-list">
            <li>Payment has been matched to this client workspace.</li>
            <li>Billing history has been refreshed.</li>
            <li>Current Advisory Credit balance: ${escapeHtml(creditsNow)}</li>
          </ul>
        `,
      });
      return;
    }
    const isPendingPayment = result.status === 409;
    setCheckoutStatus({
      title: isPendingPayment ? "We are matching your payment to this workspace." : "Workspace billing needs another check.",
      body: isPendingPayment
        ? "This can take a moment. Use View Billing again shortly. If the balance still does not update, contact support with the checkout email."
        : "Your workspace may already be updated. Please view billing or reopen the client workspace.",
      status: result.error || "Checkout status could not be refreshed.",
      level: "warning",
    });
    return;
  }

  const data = result.data || {};
  state.creditsLeft = Number(data.balance ?? state.creditsLeft);
  state.creditThreshold = Number(data.lowCreditThreshold ?? state.creditThreshold);
  addPaymentHistory(productLabel(data.productType), Number(data.amountCents || 0) ? formatUsdFromCents(data.amountCents, data.currency) : "Paid", "Paid");
  if (Number(data.credits || 0) > 0) {
    addCreditHistory(productLabel(data.productType), `+${data.credits}`, state.creditsLeft);
  }
  clearPendingCheckoutType();
  clearPendingCheckoutSessionId();
  saveState();
  await withClientTimeout(loadClientWorkspaceData(), 10000, "Workspace refresh is taking longer than expected.").catch(() => null);
  render();

  const creditLine = Number(data.credits || 0) > 0
    ? `${data.credits} Advisory Credit${Number(data.credits) === 1 ? "" : "s"} were connected to this workspace.`
    : "Your payment was connected to this workspace.";
  setCheckoutStatus({
    title: "Payment confirmed.",
    body: `${creditLine} Your current credit balance is ${state.creditsLeft}.`,
    status: `${getCheckoutEmailText(data.email)} Use the button below when you are ready to return to the workspace.`,
    level: "success",
    panelHtml: `
      <h3>Payment confirmation</h3>
      <ul class="check-list">
        <li>Payment has been matched to this client workspace.</li>
        <li>Billing history has been refreshed.</li>
        <li>Current Advisory Credit balance: ${escapeHtml(state.creditsLeft)}</li>
        <li>${escapeHtml(getCheckoutEmailText(data.email))}</li>
      </ul>
    `,
  });
}

async function notifyAdvisorEvent(payload) {
  if (!supabaseClient || !getUserId()) {
    return { ok: false, skipped: true, error: "Client workspace is not signed in." };
  }

  try {
    return await withClientTimeout(
      fetchClientApi("/api/notify", {
        method: "POST",
        body: payload,
      }),
      10000,
      "The workspace item was saved, but the advisor notification took too long to confirm."
    );
  } catch (error) {
    return {
      ok: false,
      skipped: true,
      error: error.message || "The workspace item was saved, but the advisor notification could not be confirmed.",
    };
  }
}

function notifyAdvisorEventInBackground(payload) {
  notifyAdvisorEvent(payload).then((result) => {
    if (!result?.ok) {
      addAuditEvent("Advisor notification pending", payload?.title || "Workspace notification could not be confirmed.");
      saveState();
    }
  });
}

async function updateServerCreditLedger(payload) {
  return fetchAdminApi("/api/ledger", {
    method: "POST",
    body: payload,
  });
}

function triggerSecureDownload(signedUrl, fileName = "workspace-file") {
  if (!signedUrl) {
    showToast("Download link could not be created.");
    return;
  }
  const link = document.createElement("a");
  link.href = signedUrl;
  link.download = fileName || "workspace-file";
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => link.remove(), 1000);
  showToast("Download started.");
}

function setFieldValue(selector, value) {
  const field = document.querySelector(selector);
  if (field && value !== undefined && value !== null) {
    field.value = value;
  }
}

function applyProfileToState(profile) {
  if (!profile) return;

  const organization = profile.client_organizations || {};
  const userMetadata = getUserMetadata();
  const fullName = userMetadata.full_name || userMetadata.name || "";
  const [firstName = "", ...lastNameParts] = fullName.split(" ").filter(Boolean);
  const lastName = lastNameParts.join(" ");

  state.client.email = profile.work_email || getUserEmail() || state.client.email;
  state.client.company = organization.name || state.client.company || "Your organization";
  state.profileOrganizationId = profile.organization_id || state.profileOrganizationId || "";

  setFieldValue("#profileFirstName", profile.first_name || firstName);
  setFieldValue("#profileLastName", profile.last_name || lastName);
  setFieldValue("#profileEmail", state.client.email);
  setFieldValue("#quoteEmail", state.client.email);
  setFieldValue("#profilePhone", profile.phone);
  setFieldValue("#profileTitle", profile.job_title);
  setFieldValue("#profileFunction", profile.department);
  setFieldValue("#profileCompany", state.client.company);
  setFieldValue("#profileIndustry", organization.industry || organization.company_type);
  setFieldValue("#profileCountry", organization.country);
  setFieldValue("#profileTimezone", organization.timezone);
  setFieldValue("#profileNeed", profile.primary_business_need);
  setFieldValue("#profileWorkingStyle", profile.preferred_working_style);
  saveState();
}

async function loadSignedInProfile() {
  if (!supabaseClient || !getUserId()) return null;

  const { data, error } = await supabaseClient
    .from("profiles")
    .select(
      "id,organization_id,first_name,last_name,work_email,phone,job_title,department,role,preferred_working_style,primary_business_need,client_organizations(name,industry,country,timezone,company_type,billing_email)"
    )
    .eq("id", getUserId())
    .maybeSingle();

  if (error || !data) {
    state.client.email = getUserEmail() || state.client.email;
    saveState();
    return null;
  }

  applyProfileToState(data);
  return data;
}

function groupDeliverableVersions(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    const deliverableId = row.deliverable_id || row.id;
    if (!deliverableId) return;
    const existing =
      grouped.get(deliverableId) ||
      {
        id: deliverableId,
        requestId: row.request_id || "",
        ...getProjectFieldsFromRow(row),
        title: row.title || "Client deliverable",
        type: row.deliverable_type || "Business Analysis deliverable",
        status: row.status || "Ready",
        summary: row.summary || "",
        verificationStatus: normalizeVerificationStatus(row.verification_status || row.review_status || row.client_verification_status),
        currentVersion: Number(row.current_version_number || row.version_number || 1),
        updatedAt: row.uploaded_at || row.updated_at || row.created_at,
        versions: [],
      };

    existing.versions.push({
      id: row.version_id || row.id,
      fileId: row.file_id || row.version_file_id || row.file_record_id || "",
      versionNumber: Number(row.version_number || existing.currentVersion || 1),
      fileName: row.original_file_name || row.file_name || "Deliverable file",
      fileSize: row.file_size_bytes || row.file_size || 0,
      uploadedAt: row.uploaded_at || row.created_at,
      releaseNote: row.release_note || "",
      summary: row.summary || existing.summary || "",
      verificationStatus: normalizeVerificationStatus(row.verification_status || row.review_status || row.client_verification_status),
      isCurrent: Number(row.version_number || 0) === Number(row.current_version_number || existing.currentVersion || 0),
    });

    existing.currentVersion = Math.max(existing.currentVersion || 1, ...existing.versions.map((version) => Number(version.versionNumber || 1)));
    existing.updatedAt = existing.versions
      .map((version) => version.uploadedAt)
      .filter(Boolean)
      .sort()
      .reverse()[0] || existing.updatedAt;
    grouped.set(deliverableId, existing);
  });

  return Array.from(grouped.values()).map((deliverable) => ({
    ...deliverable,
    versions: deliverable.versions.sort((a, b) => {
      if (b.versionNumber !== a.versionNumber) return b.versionNumber - a.versionNumber;
      return new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0);
    }),
  }));
}

async function getProfileOrganizationId() {
  if (state.profileOrganizationId) return state.profileOrganizationId;
  if (!supabaseClient || !getUserId()) return null;

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("organization_id")
    .eq("id", getUserId())
    .maybeSingle();

  if (error) return null;
  state.profileOrganizationId = data?.organization_id || "";
  return state.profileOrganizationId || null;
}

function normalizeClientProject(row) {
  return {
    id: row.id || "",
    organizationId: row.organization_id || "",
    name: row.name || "General Advisory Work",
    projectCode: row.project_code || "",
    projectLabel: row.project_code ? `${row.project_code} | ${row.name}` : row.name || "General Advisory Work",
    status: row.status || "active",
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || row.created_at || "",
  };
}

function normalizeProjectName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function getProjectFieldsFromRow(row) {
  const project = row.client_projects || row.project || {};
  const projectId = row.project_id || row.projectId || project.id || row.requests?.project_id || row.deliverable_versions?.project_id || "";
  const projectName = project.name || row.project_name || row.projectName || "";
  const projectCode = project.project_code || row.project_code || row.projectCode || "";
  const projectStatus = project.status || row.project_status || row.projectStatus || "";
  return {
    projectId,
    projectName,
    projectCode,
    projectStatus,
    projectLabel: projectName || (projectId ? "Client project" : "General advisory work"),
  };
}

async function ensureClientProject(organizationId, projectName) {
  const name = normalizeProjectName(projectName);
  if (!organizationId) {
    return { ok: false, error: "Please complete your client profile before creating a project." };
  }
  if (!name) {
    return { ok: false, error: "Please enter a project name before submitting this request." };
  }

  const existing = state.clientProjects.find((project) => project.organizationId === organizationId && project.name.toLowerCase() === name.toLowerCase());
  if (existing?.id) {
    return { ok: true, project: existing };
  }

  if (!supabaseClient) {
    const localProject = normalizeClientProject({
      id: `project-${Date.now()}`,
      organization_id: organizationId,
      name,
      project_code: getShortEntityId("PRJ", `${Date.now()}${Math.random()}${organizationId}`),
      status: "active",
      created_at: getIsoNow(),
    });
    state.clientProjects.unshift(localProject);
    return { ok: true, project: localProject };
  }

  const { data, error } = await supabaseClient
    .from("client_projects")
    .insert({
      organization_id: organizationId,
      name,
      project_code: getShortEntityId("PRJ", `${Date.now()}${Math.random()}${organizationId}`),
      status: "active",
      is_default: false,
      created_by: getUserId(),
    })
    .select("id,organization_id,name,project_code,status,is_default,created_at,updated_at")
    .single();

  if (error) {
    const { data: existingRows, error: readError } = await supabaseClient
      .from("client_projects")
      .select("id,organization_id,name,project_code,status,is_default,created_at,updated_at")
      .eq("organization_id", organizationId)
      .ilike("name", name)
      .limit(1);
    if (!readError && existingRows?.[0]) {
      return { ok: true, project: normalizeClientProject(existingRows[0]) };
    }
    return { ok: false, error: error.message || "Project could not be created." };
  }

  const project = normalizeClientProject(data);
  state.clientProjects = [project, ...state.clientProjects.filter((item) => item.id !== project.id)];
  return { ok: true, project };
}

async function resolveRequestProject(organizationId) {
  const selectedValue = document.querySelector("#requestProjectSelect")?.value || "";
  const newName = normalizeProjectName(document.querySelector("#requestProjectName")?.value || "");
  if (selectedValue === "__new__" || !selectedValue) {
    return ensureClientProject(organizationId, newName);
  }
  const project = getProjectById(selectedValue);
  if (!project) {
    return { ok: false, error: "Please choose a valid project or create a new project name." };
  }
  return { ok: true, project };
}

function inferProjectIdForContext(context, fallbackProjectId = "") {
  if (context?.projectId) return context.projectId;
  const request = state.requests.find((item) => String(item.requestId || item.id) === String(context?.requestId || context?.id));
  if (request?.projectId) return request.projectId;
  const deliverable = state.deliverables.find((item) => String(item.id) === String(context?.deliverableId || context?.id));
  if (deliverable?.projectId) return deliverable.projectId;
  if (fallbackProjectId || state.selectedProjectId) return fallbackProjectId || state.selectedProjectId;
  const activeProjects = getActiveClientProjects();
  return activeProjects.length === 1 ? activeProjects[0].id : "";
}

function matchesClientProject(item) {
  if (!state.selectedProjectId) return true;
  return String(item.projectId || item.project_id || "") === String(state.selectedProjectId);
}

function normalizeClientMessage(row) {
  const project = getProjectFieldsFromRow(row);
  return {
    id: row.id || `message-${Date.now()}`,
    ...project,
    contextType: row.deliverable_id ? "deliverable" : row.request_id ? "request" : row.context_type || "workspace",
    contextId: row.deliverable_id || row.request_id || row.context_id || "",
    contextLabel: row.subject || row.context_label || "Workspace message",
    body: row.body || row.message || "",
    status: normalizeVerificationStatus(row.status || "Received"),
    createdAt: row.created_at || row.createdAt || getIsoNow(),
  };
}

function normalizeClientUpload(row) {
  const project = getProjectFieldsFromRow(row);
  const uploadedBy = row.uploaded_by || row.uploadedBy || "";
  return {
    id: row.id || `upload-${Date.now()}`,
    fileId: row.id || "",
    fileKind: "client_upload",
    ...project,
    uploadedBy,
    canDelete: uploadedBy === getUserId(),
    organizationId: row.organization_id || state.profileOrganizationId || "",
    contextType: row.deliverable_id ? "deliverable" : row.request_id ? "request" : row.context_type || "workspace",
    contextId: row.deliverable_id || row.request_id || row.context_id || "",
    contextLabel: row.context_label || row.upload_type || "Workspace upload",
    purpose: row.upload_type || row.purpose || "Supporting file",
    fileName: row.original_file_name || row.file_name || "Client file",
    fileSize: row.file_size_bytes || row.file_size || 0,
    note: row.note || row.notes || "",
    status: normalizeVerificationStatus(row.status || "Received"),
    createdAt: row.created_at || row.createdAt || getIsoNow(),
  };
}

function normalizeRequestFile(row) {
  const requestLabel = row.requests?.request_code || row.request_code || row.request_id || "Request source file";
  const project = getProjectFieldsFromRow(row);
  const uploadedBy = row.uploaded_by || row.uploadedBy || "";
  return {
    id: row.id || `request-file-${Date.now()}`,
    fileId: row.id || "",
    fileKind: "request_file",
    ...project,
    uploadedBy,
    canDelete: uploadedBy === getUserId(),
    requestId: row.request_id || "",
    organizationId: row.organization_id || "",
    contextType: "request",
    contextId: row.request_id || "",
    contextLabel: requestLabel,
    purpose: "Original request source file",
    fileName: row.file_name || row.original_file_name || "Source file",
    fileSize: row.file_size_bytes || 0,
    note: row.mime_type || "Request attachment",
    status: "Received",
    createdAt: row.created_at || getIsoNow(),
  };
}

async function loadClientWorkspaceData() {
  if (!supabaseClient || !getUserId()) return;

  const organizationId = await getProfileOrganizationId();
  if (!organizationId) return;

  try {
    state.workspaceLoadIssue = "";
    const [projectResult, creditResult, ledgerResult, paymentResult, requestResult, deliverableResult, requestFileResult] = await Promise.all([
      supabaseClient
        .from("client_projects")
        .select("id,organization_id,name,project_code,status,is_default,created_at,updated_at")
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false })
        .limit(50),
      supabaseClient
        .from("credit_balance_summary")
        .select("balance,low_credit_threshold,status,reserved_balance,updated_at")
        .eq("organization_id", organizationId)
        .maybeSingle(),
      supabaseClient
        .from("credit_ledger")
        .select("entry_type,entry_reason,credits,balance_after,created_at,project_id,client_projects(id,name,project_code,status)")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseClient
        .from("payment_history")
        .select("product_type,amount_cents,currency,credits,status,paid_at,created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseClient
        .from("requests")
        .select("id,project_id,request_code,request_type,status,due_at,created_at,credits_estimated,client_projects(id,name,project_code,status)")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabaseClient
        .from("client_deliverable_versions")
        .select("deliverable_id,request_id,project_id,project_name,project_code,title,deliverable_type,status,current_version_number,version_id,file_id,version_number,original_file_name,file_size_bytes,summary,release_note,uploaded_at,updated_at")
        .eq("organization_id", organizationId)
        .order("uploaded_at", { ascending: false })
        .limit(100),
      supabaseClient
        .from("request_files")
        .select("id,request_id,project_id,organization_id,uploaded_by,file_name,file_size_bytes,mime_type,created_at,requests(request_code,request_type,project_id),client_projects(id,name,project_code,status)")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const firstDataError = [projectResult, creditResult, ledgerResult, paymentResult, requestResult, deliverableResult, requestFileResult].find((result) => result?.error);
    if (firstDataError?.error) {
      state.workspaceLoadIssue = firstDataError.error.message || "Some workspace information could not be loaded.";
    }

    if (!projectResult.error && Array.isArray(projectResult.data)) {
      state.clientProjects = projectResult.data.map(normalizeClientProject);
      if (state.selectedProjectId && !state.clientProjects.some((project) => project.id === state.selectedProjectId)) {
        state.selectedProjectId = "";
      }
    }

    if (creditResult.data) {
      state.creditsLeft = Number(creditResult.data.balance ?? state.creditsLeft);
      state.reservedCredits = Number(creditResult.data.reserved_balance ?? 0);
      state.creditThreshold = Number(creditResult.data.low_credit_threshold ?? state.creditThreshold);
    } else if (!creditResult.error) {
      state.creditsLeft = 0;
      state.reservedCredits = 0;
      state.creditThreshold = config.lowCreditThreshold;
    }

    if (!ledgerResult.error && Array.isArray(ledgerResult.data)) {
      state.creditHistory = ledgerResult.data.map((item) => ({
        date: formatDisplayDate(item.created_at),
        deliverable: [
          item.project_id ? getProjectLabel(item.client_projects) : "Client account",
          item.entry_reason || item.entry_type || "Credit event",
        ].filter(Boolean).join(" | "),
        credits: item.credits > 0 ? `+${item.credits}` : String(item.credits || 0),
        balance: item.balance_after ?? "",
      }));
    }

    if (!paymentResult.error && Array.isArray(paymentResult.data)) {
      state.paymentHistory = paymentResult.data
        .filter((item) => isPaidPaymentStatus(item.status))
        .map((item) => ({
          date: formatDisplayDate(item.paid_at || item.created_at),
          item: productLabel(item.product_type),
          amount: formatUsdFromCents(item.amount_cents, item.currency),
          status: item.status || "Recorded",
        }));
    }

    if (!requestResult.error && Array.isArray(requestResult.data)) {
      state.requests = requestResult.data.map((request) => ({
        id: request.request_code || `REQ ${String(request.id).slice(0, 8)}`,
        requestId: request.id,
        ...getProjectFieldsFromRow(request),
        type: request.request_type,
        status: request.status || "New",
        due: formatDisplayDate(request.due_at),
        createdAt: request.created_at,
        client: state.client.company,
      }));
    }

    if (!deliverableResult.error && Array.isArray(deliverableResult.data)) {
      state.deliverables = groupDeliverableVersions(deliverableResult.data);
    }

    if (!requestFileResult.error && Array.isArray(requestFileResult.data)) {
      state.requestFiles = requestFileResult.data.map(normalizeRequestFile);
    }

    const [messageResult, uploadResult] = await Promise.all([
      supabaseClient
        .from("client_deliverable_messages")
        .select("id,project_id,deliverable_id,request_id,subject,body,status,created_at,client_projects(id,name,project_code,status)")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseClient
        .from("client_uploads")
        .select("id,organization_id,project_id,deliverable_id,request_id,uploaded_by,upload_type,original_file_name,file_size_bytes,note,status,created_at,client_projects(id,name,project_code,status)")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const firstActivityError = [messageResult, uploadResult].find((result) => result?.error);
    if (!state.workspaceLoadIssue && firstActivityError?.error) {
      state.workspaceLoadIssue = firstActivityError.error.message || "Some workspace activity could not be loaded.";
    }

    if (!messageResult.error && Array.isArray(messageResult.data)) {
      state.clientMessages = messageResult.data.map(normalizeClientMessage);
    }

    if (!uploadResult.error && Array.isArray(uploadResult.data)) {
      state.clientUploads = uploadResult.data.map(normalizeClientUpload);
    }

    saveState();
  } catch (error) {
    state.workspaceLoadIssue = error.message || "Workspace information could not be loaded.";
  }
}

async function writeToSupabase(table, payload) {
  if (!supabaseClient) {
    return { ok: false, reason: `We could not reach the secure workspace. Please try again or contact ${config.supportEmail}.` };
  }

  try {
    const { error } = await supabaseClient.from(table).insert(payload);
    if (error) {
      return { ok: false, reason: error.message };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

async function saveClientProfileToSupabase() {
  if (!supabaseClient || !getUserId()) {
    return { ok: false, reason: "Please sign in before saving the secure client profile." };
  }

  if (!isEmailVerified()) {
    return { ok: false, reason: "Please verify your email before saving the client profile." };
  }

  const profileEmail = getNormalizedEmail(document.querySelector("#profileEmail").value || getUserEmail());
  const signedInEmail = getNormalizedEmail(getUserEmail());
  if (profileEmail && signedInEmail && profileEmail !== signedInEmail) {
    return { ok: false, reason: "Use the same email as your signed in client account. This keeps payments, files, and deliverables connected securely." };
  }

  const requiredProfileFields = [
    ["#profileFirstName", "first name"],
    ["#profileLastName", "last name"],
    ["#profileTitle", "job title"],
    ["#profileCompany", "company or agency name"],
    ["#profileIndustry", "industry"],
    ["#profileCountry", "country"],
    ["#profileTimezone", "time zone"],
  ];
  const missingFields = requiredProfileFields
    .filter(([selector]) => !String(document.querySelector(selector)?.value || "").trim())
    .map(([, label]) => label);
  if (missingFields.length) {
    return { ok: false, reason: `Please complete these profile fields before saving: ${missingFields.join(", ")}.` };
  }
  const companyName = document.querySelector("#profileCompany").value.trim();

  const { data: organizationId, error } = await supabaseClient.rpc("save_client_workspace_profile", {
    p_org_name: companyName,
    p_industry: document.querySelector("#profileIndustry").value,
    p_country: document.querySelector("#profileCountry").value,
    p_timezone: document.querySelector("#profileTimezone").value,
    p_company_type: document.querySelector("#profileIndustry").value,
    p_billing_email: profileEmail || state.client.email || getUserEmail(),
    p_first_name: document.querySelector("#profileFirstName").value,
    p_last_name: document.querySelector("#profileLastName").value,
    p_work_email: profileEmail || getUserEmail(),
    p_phone: document.querySelector("#profilePhone").value,
    p_job_title: document.querySelector("#profileTitle").value,
    p_department: document.querySelector("#profileFunction").value,
    p_preferred_working_style: document.querySelector("#profileWorkingStyle").value,
    p_primary_business_need: document.querySelector("#profileNeed").value,
  });

  if (error) {
    return { ok: false, reason: error.message };
  }

  await loadSignedInProfile();
  return { ok: true, organizationId };
}

async function uploadRequestFiles(requestId, organizationId, projectId = "") {
  const fileInput = document.querySelector("#fileUpload");
  const files = Array.from(fileInput.files || []);
  const userId = getUserId();

  let uploaded = 0;

  try {
    if (!files.length || !supabaseClient || !userId) {
      return { ok: true, uploaded: 0 };
    }
    if (!requestId) {
      return { ok: false, reason: "Your request was created, but the secure upload reference was not returned. Please refresh the workspace and try again.", uploaded: 0 };
    }
    const validationError = validateWorkspaceFiles(files);
    if (validationError) {
      return { ok: false, reason: validationError, uploaded: 0 };
    }

    for (const [index, file] of files.entries()) {
      const storagePath = createClientStoragePath(userId, requestId, file.name, index);
      const uploadResponse = await uploadFileToStorageBucket("client-files", storagePath, file, getSingleFileUploadTimeoutMs());
      const uploadError = uploadResponse?.error;

      if (uploadError) {
        return { ok: false, reason: getPartialUploadError(file.name, uploaded, files.length, uploadError.message), uploaded };
      }

      try {
        const fileRecordResponse = await withClientTimeout(
          supabaseClient.from("request_files").insert({
            request_id: requestId,
            organization_id: organizationId,
            project_id: projectId || null,
            storage_path: storagePath,
            file_name: file.name,
            file_size_bytes: file.size,
            mime_type: getUploadContentType(file),
            uploaded_by: userId,
          }),
          15000,
          `${file.name} uploaded, but the workspace record took too long to save. Please contact ${config.supportEmail}.`
        );
        const fileRecordError = fileRecordResponse?.error;

        if (fileRecordError) {
          await removeStorageObjectQuietly("client-files", storagePath);
          return { ok: false, reason: getPartialUploadError(file.name, uploaded, files.length, fileRecordError.message), uploaded };
        }
      } catch (error) {
        await removeStorageObjectQuietly("client-files", storagePath);
        return { ok: false, reason: getPartialUploadError(file.name, uploaded, files.length, error.message), uploaded };
      }

      uploaded += 1;
    }

    return { ok: true, uploaded };
  } catch (error) {
    return {
      ok: false,
      reason: getPartialUploadError("the current file", uploaded, files.length, error?.message || "The secure upload could not be completed."),
      uploaded,
    };
  }
}

function getAdminUploadFiles() {
  return Array.from(document.querySelector("#adminDeliverableFiles")?.files || []);
}

function getSafeFileName(name) {
  const cleaned = String(name || "deliverable-file")
    .replace(/^\.+/, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
  const fallback = cleaned || "file";
  const reserved = new Set(["con", "prn", "aux", "nul", "com1", "com2", "com3", "lpt1", "lpt2", "lpt3"]);
  const stem = fallback.split(".")[0].toLowerCase();
  return reserved.has(stem) ? `file_${fallback}` : fallback;
}

const allowedUploadExtensions = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "png", "jpg", "jpeg"]);

function getFileExtension(fileName) {
  return String(fileName || "").split(".").pop().toLowerCase();
}

function validateWorkspaceFiles(files) {
  const maxBytes = config.maxFileSizeMb * 1024 * 1024;
  const list = Array.from(files || []);
  if (list.length > config.maxFilesPerUpload) {
    return `Please upload no more than ${config.maxFilesPerUpload} files at a time. You can attach more files later from Messages and Files.`;
  }
  const invalid = Array.from(files || []).find((file) => {
    const extension = getFileExtension(file.name);
    return !allowedUploadExtensions.has(extension) || file.size > maxBytes || file.size <= 0;
  });
  if (!invalid) return "";
  if (invalid.size <= 0) {
    return `${invalid.name} appears to be empty. Please attach a file that contains content.`;
  }
  if (invalid.size > maxBytes) {
    return `${invalid.name} is larger than ${config.maxFileSizeMb} MB. Please reduce the file size or split the material.`;
  }
  return `${invalid.name} is not an accepted file type. Accepted files are PDF, Word, Excel, PowerPoint, PNG, and JPG.`;
}

function getUploadContentType(file) {
  const extension = getFileExtension(file?.name);
  const mappedType = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
  }[extension];
  return mappedType || file?.type || "application/octet-stream";
}

function createClientStoragePath(userId, folder, fileName, index = 0) {
  const uniqueId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  return `${userId}/${folder}/${uniqueId}-${index}-${getSafeFileName(fileName)}`;
}

function getPartialUploadError(fileName, uploaded, total, reason) {
  const countText = `${uploaded} of ${total} file${total === 1 ? "" : "s"}`;
  const recovery = uploaded > 0
    ? "The uploaded files remain attached. Please select and upload only the remaining files from Messages and Files."
    : "No files were attached. Please try again with fewer or smaller files.";
  return `Upload stopped at ${fileName}. ${countText} were uploaded before the issue. ${getFriendlyWorkspaceError(reason, "Please review the file and try again.")} ${recovery}`;
}

async function removeStorageObjectQuietly(bucketName, storagePath) {
  if (!supabaseClient || !storagePath) return;
  await withClientTimeout(
    supabaseClient.storage.from(bucketName).remove([storagePath]),
    10000,
    "File cleanup took too long."
  ).then(() => null, () => null);
}

function getSingleFileUploadTimeoutMs() {
  return 120000;
}

function getUploadOperationTimeoutMs(files, perFileMs = getSingleFileUploadTimeoutMs(), maximumMs = 900000) {
  const count = Math.max(1, Array.from(files || []).length);
  return Math.min(maximumMs, 30000 + count * perFileMs);
}

function getWorkspaceItems() {
  const selectedProjectId = state.selectedProjectId && state.selectedProjectId !== ADMIN_ALL_PROJECTS_VALUE ? state.selectedProjectId : "";
  const activeProjects = selectedProjectId
    ? getActiveClientProjects().filter((project) => String(project.id) === String(selectedProjectId))
    : getActiveClientProjects();
  const projectItems = activeProjects.map((project) => ({
    type: "project",
    id: project.id,
    projectId: project.id,
    label: `${getProjectLabel(project)} | Project workspace`,
  }));
  const deliverableItems = getVisibleDeliverables().map((deliverable) => ({
    type: "deliverable",
    id: deliverable.id,
    projectId: deliverable.projectId || "",
    label: `${deliverable.projectLabel || getClientProjectLabel(deliverable.projectId)} | ${deliverable.title} | Version ${deliverable.currentVersion}`,
  }));
  const requestItems = getVisibleRequests().map((request) => ({
    type: "request",
    id: request.requestId || request.id,
    projectId: request.projectId || "",
    label: `${request.projectLabel || getClientProjectLabel(request.projectId)} | ${getRequestDisplayRef(request)} | ${request.type}`,
  }));
  return [...projectItems, ...deliverableItems, ...requestItems];
}

function parseWorkspaceContext(value) {
  const [type = "workspace", ...idParts] = String(value || "").split(":");
  const id = idParts.join(":");
  const item = getWorkspaceItems().find((entry) => entry.type === type && String(entry.id) === id);
  return {
    type,
    id,
    label: item?.label || "Workspace",
    projectId: item?.projectId || "",
    deliverableId: type === "deliverable" ? id : null,
    requestId: type === "request" ? id : null,
  };
}

function addLocalMessage(entry) {
  state.clientMessages.unshift(entry);
  state.clientMessages = state.clientMessages.slice(0, 20);
}

function addLocalUpload(entry) {
  state.clientUploads.unshift(entry);
  state.clientUploads = state.clientUploads.slice(0, 20);
}

async function saveClientMessage() {
  const context = parseWorkspaceContext(document.querySelector("#clientMessageContext")?.value);
  const body = document.querySelector("#clientMessageBody")?.value.trim();
  if (!body) {
    return { ok: false, error: "Add a message before sending." };
  }

  const entry = {
    id: `message-${Date.now()}`,
    contextType: context.type,
    contextId: context.id,
    contextLabel: context.label,
    body,
    status: "Received",
    createdAt: getIsoNow(),
  };

  let organizationId = "";
  try {
    organizationId = await withClientTimeout(
      getProfileOrganizationId(),
      10000,
      "Profile verification took too long. Refresh the workspace and try again."
    );
  } catch (error) {
    return { ok: false, error: error.message || "Profile verification could not be completed." };
  }
  if (supabaseClient && !organizationId) {
    return { ok: false, error: "Please complete your client profile before sending a workspace message." };
  }
  const projectId = inferProjectIdForContext(context);
  if (supabaseClient && !projectId) {
    return { ok: false, error: "Choose the project workspace this message belongs to before sending." };
  }

  const result =
    organizationId && supabaseClient
      ? await writeToSupabase("client_deliverable_messages", {
          organization_id: organizationId,
          project_id: projectId || null,
          submitted_by: getUserId(),
          deliverable_id: context.deliverableId,
          request_id: context.requestId,
          subject: context.label,
          body,
          status: "received",
        })
      : { ok: true };

  if (!result.ok) {
    return { ok: false, error: result.reason || "Message could not be saved to the client workspace." };
  }

  addLocalMessage(entry);
  entry.projectId = projectId;
  entry.projectLabel = getClientProjectLabel(projectId);
  addAuditEvent("Client message received", `${context.label}: ${body.slice(0, 80)}`);
  saveState();
  notifyAdvisorEventInBackground({
    eventType: "client_message",
    title: "Client message received",
    summary: `${context.label}: ${body}`,
    relatedEntityType: context.deliverableId ? "deliverable" : context.requestId ? "request" : "workspace",
    relatedEntityId: context.deliverableId || context.requestId || null,
    relatedLabel: context.label,
    projectId,
  });
  return { ok: true, storedOnline: Boolean(result.ok), notificationPending: true };
}

async function saveClientUpload() {
  const context = parseWorkspaceContext(document.querySelector("#clientUploadContext")?.value);
  const purpose = document.querySelector("#clientUploadPurpose")?.value || "Supporting file";
  const note = document.querySelector("#clientUploadNotes")?.value.trim() || "";
  const files = Array.from(document.querySelector("#clientUploadFiles")?.files || []);
  if (!files.length) {
    return { ok: false, error: "Select at least one file before uploading." };
  }
  const validationError = validateWorkspaceFiles(files);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  let organizationId = "";
  try {
    organizationId = await withClientTimeout(
      getProfileOrganizationId(),
      10000,
      "Profile verification took too long. Refresh the workspace and try again."
    );
  } catch (error) {
    return { ok: false, error: error.message || "Profile verification could not be completed." };
  }
  const userId = getUserId();
  let storedOnline = false;
  let uploaded = 0;
  if (supabaseClient && !organizationId) {
    return { ok: false, error: "Please complete your client profile before uploading files." };
  }
  const projectId = inferProjectIdForContext(context);
  if (supabaseClient && !projectId) {
    return { ok: false, error: "Choose the project workspace these files belong to before uploading." };
  }

  for (const [index, file] of files.entries()) {
    setInlineStatus("#clientUploadStatus", `Uploading file ${index + 1} of ${files.length}: ${file.name}`);
    const entry = {
      id: `upload-${Date.now()}-${uploaded}`,
      fileId: "",
      fileKind: "client_upload",
      projectId,
      projectLabel: getClientProjectLabel(projectId),
      contextType: context.type,
      contextId: context.id,
      contextLabel: context.label,
      purpose,
      fileName: file.name,
      fileSize: file.size,
      note,
      status: "Received",
      createdAt: getIsoNow(),
    };

    if (organizationId && userId && supabaseClient) {
      const storagePath = createClientStoragePath(userId, `workspace-uploads/${context.type}-${context.id || "workspace"}`, file.name, index);
      const uploadResponse = await uploadFileToStorageBucket("client-files", storagePath, file, getSingleFileUploadTimeoutMs());
      const uploadError = uploadResponse?.error;

      if (uploadError) {
        if (uploaded > 0) {
          addAuditEvent("Partial client upload", `${uploaded} of ${files.length} files were attached before ${file.name} failed.`);
          saveState();
          render();
        }
        return { ok: false, error: getPartialUploadError(file.name, uploaded, files.length, uploadError.message || "File could not be uploaded."), uploaded };
      }

      try {
        const recordResponse = await withClientTimeout(
          supabaseClient
            .from("client_uploads")
            .insert({
              organization_id: organizationId,
              project_id: projectId || null,
              uploaded_by: userId,
              deliverable_id: context.deliverableId,
              request_id: context.requestId,
              upload_type: purpose,
              original_file_name: file.name,
              file_size_bytes: file.size,
              storage_bucket: "client-files",
              storage_path: storagePath,
              note,
              status: "received",
            })
            .select("id")
            .single(),
          15000,
          `${file.name} uploaded, but the workspace record took too long to save. Please contact ${config.supportEmail}.`
        );
        const uploadRecord = recordResponse?.data;
        const recordError = recordResponse?.error;
        if (recordError) {
          await removeStorageObjectQuietly("client-files", storagePath);
          if (uploaded > 0) {
            addAuditEvent("Partial client upload", `${uploaded} of ${files.length} files were attached before ${file.name} could not be recorded.`);
            saveState();
            render();
          }
          return { ok: false, error: getPartialUploadError(file.name, uploaded, files.length, recordError.message || "File record could not be saved to the workspace."), uploaded };
        }
        entry.fileId = uploadRecord?.id || "";
      } catch (error) {
        await removeStorageObjectQuietly("client-files", storagePath);
        if (uploaded > 0) {
          addAuditEvent("Partial client upload", `${uploaded} of ${files.length} files were attached before ${file.name} could not be recorded.`);
          saveState();
          render();
        }
        return { ok: false, error: getPartialUploadError(file.name, uploaded, files.length, error.message || "File record could not be saved to the workspace."), uploaded };
      }
      storedOnline = true;
    }

    addLocalUpload(entry);
    uploaded += 1;
  }

  addAuditEvent("Client files received", `${uploaded} file${uploaded === 1 ? "" : "s"} attached to ${context.label}.`);
  saveState();
  notifyAdvisorEventInBackground({
    eventType: "client_file_upload",
    title: "Client files uploaded",
    summary: `${uploaded} file${uploaded === 1 ? "" : "s"} attached to ${context.label}. Purpose: ${purpose}. ${note ? `Notes: ${note}` : ""}`,
    relatedEntityType: context.deliverableId ? "deliverable" : context.requestId ? "request" : "workspace",
    relatedEntityId: context.deliverableId || context.requestId || null,
    relatedLabel: context.label,
    projectId,
  });
  return { ok: true, uploaded, storedOnline, notificationPending: true };
}

async function getNextDeliverableVersionNumber(deliverableId) {
  if (!supabaseClient || !deliverableId) return 1;
  const { data, error } = await supabaseClient
    .from("deliverable_versions")
    .select("version_number")
    .eq("deliverable_id", deliverableId)
    .order("version_number", { ascending: false })
    .limit(1);

  if (error || !data?.length) return 1;
  return Number(data[0].version_number || 0) + 1;
}

async function uploadAdminDeliverable() {
  if (!supabaseClient || !(await ensureAdminAccess())) {
    return { ok: false, error: "Please sign in with the administrator email before uploading deliverables." };
  }

  const organizationId = state.selectedAdminClientId || document.querySelector("#adminUploadClientSelect")?.value || "";
  const requestId = document.querySelector("#adminUploadRequestSelect")?.value || null;
  const existingDeliverableId = document.querySelector("#adminExistingDeliverableSelect")?.value || "";
  const linkedRequest = requestId
    ? state.adminQueue.find((item) => item.queueType === "request" && item.organizationId === organizationId && (item.requestId === requestId || item.id === requestId))
    : null;
  const existingDeliverable = existingDeliverableId
    ? state.adminDeliverables.find((deliverable) => deliverable.id === existingDeliverableId && deliverable.organizationId === organizationId)
    : null;
  const projectId = linkedRequest?.projectId || existingDeliverable?.projectId || getAdminUploadProjectId();
  const title = document.querySelector("#adminDeliverableTitle")?.value.trim() || "";
  const deliverableType = document.querySelector("#adminDeliverableType")?.value || "Business Analysis deliverable";
  const summary = document.querySelector("#adminDeliverableSummary")?.value.trim() || "";
  const releaseNote = document.querySelector("#adminDeliverableReleaseNote")?.value.trim() || "";
  const creditsUsed = Math.max(0, Number(document.querySelector("#adminReleaseCreditsUsed")?.value || 0));
  const notifyClient = Boolean(document.querySelector("#adminNotifyClient")?.checked);
  const files = getAdminUploadFiles();

  if (!organizationId) {
    return { ok: false, error: "Select a client before uploading a deliverable." };
  }

  if (!state.adminClients.some((client) => client.id === organizationId)) {
    return { ok: false, error: "The selected client workspace is not available for upload." };
  }
  if (!title) {
    return { ok: false, error: "Add a deliverable title before releasing files." };
  }
  if (!summary) {
    return { ok: false, error: "Add a release summary before releasing files." };
  }
  if (!releaseNote) {
    return { ok: false, error: "Add a version note before releasing files." };
  }
  if (!projectId || !state.adminProjects.some((project) => project.id === projectId && project.organizationId === organizationId)) {
    return { ok: false, error: "Select the project workspace before releasing a deliverable." };
  }

  const selectedClient = getAdminClientByOrganization(organizationId);
  const availableCredits = getAdminCreditBalanceForOrganization(organizationId);
  if (creditsUsed > 0 && creditsUsed > availableCredits) {
    return {
      ok: false,
      error: `This client has ${availableCredits} Advisory Credit${availableCredits === 1 ? "" : "s"} available. Add credits or set credits to 0 only when this release is covered by a fixed scope.`,
    };
  }

  if (
    requestId &&
    !state.adminQueue.some((item) => item.queueType === "request" && item.organizationId === organizationId && (item.requestId === requestId || item.id === requestId) && (!item.projectId || item.projectId === projectId))
  ) {
    return { ok: false, error: "The selected request does not belong to this client." };
  }

  if (
    existingDeliverableId &&
    !state.adminDeliverables.some((deliverable) => deliverable.id === existingDeliverableId && deliverable.organizationId === organizationId)
  ) {
    return { ok: false, error: "The selected deliverable does not belong to this client." };
  }
  if (existingDeliverableId && existingDeliverable?.projectId && existingDeliverable.projectId !== projectId) {
    return { ok: false, error: "The selected deliverable belongs to a different project. Choose the matching project or create a new deliverable." };
  }

  if (!files.length) {
    return { ok: false, error: "Select at least one deliverable file to upload." };
  }
  const validationError = validateWorkspaceFiles(files);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  setAdminReleaseStatus("Creating the controlled client release record.");
  const prepareResult = await withClientTimeout(
    fetchAdminApi("/api/deliverable-ready-notification", {
      method: "POST",
      body: {
        action: "prepare",
        organizationId,
        projectId,
        requestId: requestId || null,
        existingDeliverableId: existingDeliverableId || null,
        title,
        deliverableType,
        summary,
        releaseNote,
      },
    }),
    20000,
    "The deliverable release record took too long to create. Please try again."
  );

  if (!prepareResult.ok) {
    return { ok: false, error: prepareResult.error || "The deliverable release record could not be created." };
  }

  const prepared = prepareResult.data || {};
  const deliverableId = prepared.deliverableId;
  const versionId = prepared.versionId;
  const versionNumber = prepared.versionNumber;
  const storagePrefix = prepared.storagePrefix || `clients/${organizationId}/deliverables/${deliverableId}/v${versionNumber}/`;
  const storagePaths = [];
  const fileRecords = [];
  let uploaded = 0;

  const abortPreparedRelease = async () => {
    await fetchAdminApi("/api/deliverable-ready-notification", {
      method: "POST",
      body: {
        action: "abort",
        organizationId,
        deliverableId,
        versionId,
        createdDeliverable: prepared.createdDeliverable === true,
        storagePaths,
      },
    }).then(() => null, () => null);
  };

  try {
  for (const file of files) {
    setAdminReleaseStatus(`Uploading deliverable file ${uploaded + 1} of ${files.length}: ${file.name}`);
    const safeName = getSafeFileName(file.name);
    const storagePath = `${storagePrefix}${Date.now()}-${uploaded + 1}-${safeName}`;
    const uploadResponse = await uploadFileToStorageBucket("private-deliverables", storagePath, file, getSingleFileUploadTimeoutMs());
    const uploadError = uploadResponse?.error;

    if (uploadError) {
      await abortPreparedRelease();
      return { ok: false, error: getPartialUploadError(file.name, uploaded, files.length, uploadError.message), uploaded };
    }

    storagePaths.push(storagePath);
    fileRecords.push({
      storageBucket: "private-deliverables",
      storagePath,
      fileName: file.name,
      contentType: getUploadContentType(file),
      fileSizeBytes: file.size,
    });
    uploaded += 1;
  }

  setAdminReleaseStatus(creditsUsed > 0 ? "Publishing the deliverable and recording Advisory Credits." : "Publishing the deliverable to the client workspace.");
  const finalizeResult = await withClientTimeout(
    fetchAdminApi("/api/deliverable-ready-notification", {
      method: "POST",
      body: {
        action: "finalize",
        organizationId,
        projectId,
        requestId: requestId || null,
        deliverableId,
        versionId,
        versionNumber,
        title,
        releaseNote,
        creditsUsed,
        notifyClient,
        recipientEmail: getClientEmail(selectedClient) || null,
        fileRecords,
      },
    }),
    30000,
    "The deliverable was uploaded, but publishing took too long. Please refresh the admin file before trying again."
  );

  if (!finalizeResult.ok) {
    await abortPreparedRelease();
    return { ok: false, error: finalizeResult.error || "Deliverable files were uploaded, but the release could not be finalized.", uploaded };
  }

  if (creditsUsed > 0) {
    state.creditsLeft = Number(finalizeResult.data?.balance ?? state.creditsLeft);
    updateSelectedAdminClientCreditAccount(state.creditsLeft, finalizeResult.data?.lowCreditThreshold ?? state.creditThreshold);
  }

  return {
    ok: true,
    uploaded,
    creditsUsed,
    balance: creditsUsed > 0 ? Number(finalizeResult.data?.balance ?? state.creditsLeft) : availableCredits,
    deliverableId,
    versionId,
    notificationRequested: notifyClient,
    notificationQueued: notifyClient && finalizeResult.data?.notificationQueued === true,
    notificationSent: notifyClient && finalizeResult.data?.notificationSent === true,
    notificationError: finalizeResult.data?.notificationError,
  };
  } catch (error) {
    await abortPreparedRelease();
    return {
      ok: false,
      error: error.message || "Deliverable files could not be released. The prepared release was cleaned up.",
      uploaded,
    };
  }
}

function setView() {
  const rawKey = window.location.hash.replace("#", "") || "home";
  const protectedViews = ["dashboard", "profile", "request", "billing"];
  const canonicalKey = routeAliases[rawKey] || rawKey;
  if (state.passwordRecovery && canonicalKey !== "login" && !isPasswordRecoveryUrl()) {
    state.passwordRecovery = false;
    updateAuthUi();
  }
  let key = state.passwordRecovery ? "login" : views[canonicalKey] ? canonicalKey : rawKey.startsWith("error=") ? "login" : "home";

  if (key === "admin" && !state.session?.user) {
    setPendingPostAuthRoute("admin");
    key = "login";
    setAuthStatus("Please sign in with the administrator email to open the admin workspace.");
  }

  if ((key === "admin" || protectedViews.includes(key)) && state.session?.user && !state.passwordRecovery && !isEmailVerified()) {
    key = "login";
    window.history.replaceState(null, "", `${window.location.pathname}#login`);
    setAuthStatus("Please verify your email before opening the secure workspace.");
  }

  if (key === "admin" && state.session?.user && !state.adminStatusChecked) {
    key = "login";
    setAuthStatus("Verifying administrator access.");
    refreshAdminStatus(true).then(() => {
      updateAuthUi();
      setView();
    });
  }

  if (key === "admin" && state.session?.user && !isAdminUser()) {
    key = "dashboard";
    showToast("Admin access is restricted to the administrator email.");
  }

  if (key === "login" && state.session?.user && !state.passwordRecovery && isEmailVerified()) {
    key = isAdminUser() ? "admin" : "dashboard";
    window.history.replaceState(null, "", `${window.location.pathname}#${key}`);
  }

  if (protectedViews.includes(key) && !state.session?.user) {
    setPendingPostAuthRoute(key);
    key = "login";
    window.history.replaceState(null, "", `${window.location.pathname}#login`);
    setAuthStatus("Please sign in before opening the client workspace.");
  }

  Object.entries(views).forEach(([viewKey, element]) => {
    element.classList.toggle("active", viewKey === key);
  });
  if (rawKey.startsWith("error=")) {
    setAuthStatus("Sign in could not be completed. Please choose a sign in option and try again.");
  }
  render();
  openClientWorkspaceSection(rawKey);
  if (key === "admin") {
    loadAdminQueue();
  }
  if (key === "checkout-success") {
    handleCheckoutSuccessView();
  }
  closeNavigationMenus();
  if (!routeAliases[rawKey]) {
    scrollPageToStart();
  }
}

function getVisibleRequests() {
  return state.requests.filter(matchesClientProject);
}

function getVisibleDeliverables() {
  return state.deliverables.filter(matchesClientProject);
}

function getVisibleMessages() {
  return state.clientMessages.filter(matchesClientProject);
}

function getVisibleUploads() {
  return state.clientUploads.filter(matchesClientProject);
}

function getVisibleRequestFiles() {
  return state.requestFiles.filter(matchesClientProject);
}

function renderRequests() {
  const requests = getVisibleRequests();
  const rows = requests.length
    ? requests
        .map(
          (request) => `
        <tr>
          <td>${escapeHtml(request.id)}</td>
          <td>${escapeHtml(request.projectLabel || getClientProjectLabel(request.projectId))}</td>
          <td>${escapeHtml(request.type)}</td>
          <td>${escapeHtml(normalizeVerificationStatus(request.status))}</td>
          <td>${escapeHtml(request.due)}</td>
        </tr>
      `
        )
        .join("")
    : `<tr><td colspan="5" class="empty-cell">No requests yet for this project view. Start a request when you are ready to send source material or ask for Business Analysis support.</td></tr>`;

  document.querySelector("#requestTable tbody").innerHTML = rows;

  const adminSource = state.adminQueue.length ? getSelectedAdminQueueItems() : state.requests.map((request) => ({
    client: request.client,
    due: request.due,
    type: request.type,
    action: request.status === "New" ? "Scope request" : "Review",
    status: request.status,
  }));

  const adminRows = adminSource
    .map(
      (item) => {
        const canUpload = item.queueType === "request" && item.organizationId && item.requestId;
        const canDownload = ["client-upload", "request-file"].includes(item.queueType) && item.fileId;
        const queueKey = buildAdminQueueKey(item);
        const statusLevel = getAdminStatusLevel(item.status);
        const projectLabel = item.projectLabel || "General advisory work";
        const detail = getAdminWorkDetail(item);
        const nextAction = getAdminNextAction(item);
        const resolution = getAdminQueueResolution(item);
        return `
        <tr>
          <td>
            <strong class="queue-next-action">${escapeHtml(nextAction)}</strong>
            <small>${escapeHtml(item.dueLabel || item.due || "No due date set")}</small>
          </td>
          <td>
            <strong>${escapeHtml(item.client)}</strong>
            <small>${escapeHtml(projectLabel)}</small>
          </td>
          <td>
            <strong>${escapeHtml(getAdminWorkTitle(item))}</strong>
            <span>${escapeHtml(detail)}</span>
          </td>
          <td><span class="status-pill ${escapeHtml(statusLevel)}">${escapeHtml(normalizeVerificationStatus(item.status))}</span></td>
          <td>
            <div class="table-actions">
              <button class="secondary small" type="button" data-admin-action="open-message-client" data-queue-key="${escapeHtml(queueKey)}">Message</button>
              ${
                canUpload
                  ? `<button class="small" type="button" data-admin-action="prepare-upload" data-request-id="${escapeHtml(item.requestId)}" data-organization-id="${escapeHtml(item.organizationId)}" data-project-id="${escapeHtml(item.projectId || "")}">Upload</button>`
                  : ""
              }
              ${
                canDownload
                  ? `<button class="secondary small" type="button" data-download-source-file="${escapeHtml(item.fileId)}" data-source-kind="${escapeHtml(item.fileKind || "request_file")}" data-organization-id="${escapeHtml(item.organizationId || "")}" data-project-id="${escapeHtml(item.projectId || "")}">Download</button>`
                  : ""
              }
              <button class="secondary small" type="button" data-admin-action="mark-queue-item" data-queue-key="${escapeHtml(queueKey)}" data-queue-status-action="${escapeHtml(resolution.action)}">${escapeHtml(resolution.label)}</button>
              ${!canUpload && !canDownload ? `<span class="status-pill muted">No file action</span>` : ""}
            </div>
          </td>
        </tr>
      `;
      }
    )
    .join("");

  document.querySelector("#adminTable tbody").innerHTML =
    adminRows || `<tr><td colspan="5" class="empty-cell">No admin queue items for the selected client.</td></tr>`;
}

function renderDeliverableStatus() {
  const groups = {
    pending: [],
    inReview: [],
    paused: [],
    completed: [],
  };

  getVisibleRequests().forEach((request) => {
    groups[getStatusGroup(request.status)].push(request);
  });

  Object.entries(groups).forEach(([group, requests]) => {
    const count = document.querySelector(`#${group}Count`);
    const list = document.querySelector(`#${group}Deliverables`);
    if (count) count.textContent = requests.length;
    if (!list) return;
    list.innerHTML = requests.length
      ? requests.slice(0, 4).map((request) => `<li><strong>${escapeHtml(request.id)}</strong><span>${escapeHtml(request.type)}</span></li>`).join("")
      : `<li class="empty-status">No ${escapeHtml(getStatusLabel(group))} deliverables.</li>`;
  });
}

function renderClientDeliverables() {
  const list = document.querySelector("#clientDeliverablesList");
  if (!list) return;

  const deliverables = getVisibleDeliverables();
  if (!deliverables.length) {
    list.innerHTML = `<div class="empty-cell">No completed deliverables have been released for this project view yet.</div>`;
    return;
  }

  list.innerHTML = deliverables
    .map((deliverable) => {
      const currentFiles = deliverable.versions.filter((version) => Number(version.versionNumber) === Number(deliverable.currentVersion));
      const previousFiles = deliverable.versions.filter((version) => Number(version.versionNumber) !== Number(deliverable.currentVersion));
      const verificationStatus = normalizeVerificationStatus(deliverable.verificationStatus);
      const verificationLevel = getVerificationLevel(verificationStatus);
      const newBadge = isNewDeliverable(deliverable) ? `<span class="status-pill new">New</span>` : "";
      const currentFileHtml = currentFiles
        .map(
          (version) => `
            <div class="deliverable-file-row">
              <div>
                <strong>${escapeHtml(version.fileName)}</strong>
                <span>Version ${escapeHtml(version.versionNumber)} released ${escapeHtml(formatDisplayDate(version.uploadedAt))} | ${escapeHtml(formatFileSize(version.fileSize))}</span>
              </div>
              <button class="secondary small" type="button" data-download-file="${escapeHtml(version.fileId)}" data-organization-id="${escapeHtml(state.profileOrganizationId || "")}" data-project-id="${escapeHtml(deliverable.projectId || "")}">Download</button>
            </div>
          `
        )
        .join("");
      const previousFileHtml = previousFiles.length
        ? previousFiles
            .map(
              (version) => `
                <div class="deliverable-file-row compact">
                  <div>
                    <strong>Version ${escapeHtml(version.versionNumber)}</strong>
                    <span>${escapeHtml(version.fileName)} | ${escapeHtml(formatDisplayDate(version.uploadedAt))}</span>
                    ${version.releaseNote ? `<small>${escapeHtml(version.releaseNote)}</small>` : ""}
                  </div>
                  <button class="secondary small" type="button" data-download-file="${escapeHtml(version.fileId)}" data-organization-id="${escapeHtml(state.profileOrganizationId || "")}" data-project-id="${escapeHtml(deliverable.projectId || "")}">Download</button>
                </div>
              `
            )
            .join("")
        : `<p class="muted">No previous versions have been released.</p>`;

      return `
        <article class="deliverable-card">
          <div class="deliverable-card-head">
            <div>
              <span>${escapeHtml(deliverable.type)}</span>
              <h4>${escapeHtml(deliverable.title)}</h4>
              <small>${escapeHtml(deliverable.projectLabel || getClientProjectLabel(deliverable.projectId))}</small>
            </div>
            <div class="deliverable-badges">
              ${newBadge}
              <span class="status-pill ${escapeHtml(verificationLevel)}">${escapeHtml(verificationStatus)}</span>
              <strong>Current version ${escapeHtml(deliverable.currentVersion)}</strong>
            </div>
          </div>
          ${deliverable.summary ? `<p>${escapeHtml(deliverable.summary)}</p>` : ""}
          <div class="deliverable-files">${currentFileHtml}</div>
          <div class="deliverable-actions">
            <button class="small" type="button" data-client-action="approve-deliverable" data-deliverable-id="${escapeHtml(deliverable.id)}">Mark Reviewed And Accepted</button>
            <button class="secondary small" type="button" data-client-action="message" data-context="deliverable:${escapeHtml(deliverable.id)}">Message About This</button>
            <button class="secondary small" type="button" data-client-action="upload" data-context="deliverable:${escapeHtml(deliverable.id)}">Upload Revision Files</button>
          </div>
          <details class="version-history">
            <summary>Version history</summary>
            ${previousFileHtml}
          </details>
        </article>
      `;
    })
    .join("");
}

function renderDeliverySummary() {
  const deliverables = getVisibleDeliverables();
  const latest = [...deliverables].sort((a, b) => new Date(getDeliverableReleasedAt(b) || 0) - new Date(getDeliverableReleasedAt(a) || 0))[0];
  const newCount = deliverables.filter(isNewDeliverable).length;
  const reviewCount = deliverables.filter((deliverable) => getVerificationLevel(deliverable.verificationStatus) !== "approved").length;
  const newCountEl = document.querySelector("#newDeliverableCount");
  const latestTitle = document.querySelector("#latestDeliverableTitle");
  const latestMeta = document.querySelector("#latestDeliverableMeta");
  const verificationSummary = document.querySelector("#verificationSummary");

  if (newCountEl) newCountEl.textContent = newCount;
  if (latestTitle) latestTitle.textContent = latest?.title || "No files released yet";
  if (latestMeta) {
    latestMeta.textContent = latest
      ? `Version ${latest.currentVersion || 1} released ${formatDisplayDate(getDeliverableReleasedAt(latest))}`
      : "Released files will appear here.";
  }
  if (verificationSummary) {
    verificationSummary.textContent = reviewCount ? `${reviewCount} item${reviewCount === 1 ? "" : "s"} awaiting review` : "Nothing awaiting your review";
  }
}

function renderClientActionOptions() {
  const options = getWorkspaceItems();
  const optionHtml =
    `<option value="workspace:">${options.length ? "Choose a project or work item" : "Workspace message"}</option>` +
    options.map((item) => `<option value="${escapeHtml(`${item.type}:${item.id}`)}">${escapeHtml(item.label)}</option>`).join("");

  ["#clientMessageContext", "#clientUploadContext"].forEach((selector) => {
    const select = document.querySelector(selector);
    if (!select) return;
    const currentValue = select.value;
    select.innerHTML = optionHtml;
    if (currentValue && Array.from(select.options).some((option) => option.value === currentValue)) {
      select.value = currentValue;
    }
  });
}

function renderClientCommunicationLog() {
  const log = document.querySelector("#clientCommunicationLog");
  if (!log) return;
  const entries = [
    ...getVisibleMessages().map((item) => ({ ...item, kind: "Message" })),
    ...getVisibleUploads().map((item) => ({ ...item, kind: "Upload" })),
  ].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  if (!entries.length) {
    log.innerHTML = `<div class="empty-cell">No client messages or uploads have been added yet.</div>`;
    return;
  }

  log.innerHTML = entries
    .slice(0, 8)
    .map((entry) => {
      const detail = entry.kind === "Upload" ? `${entry.purpose}: ${entry.fileName}` : entry.body;
      return `
        <article>
          <div>
            <strong>${escapeHtml(entry.kind)} | ${escapeHtml(entry.projectLabel || getClientProjectLabel(entry.projectId))} | ${escapeHtml(entry.contextLabel || "Workspace")}</strong>
            <span>${escapeHtml(detail)}</span>
            ${entry.note ? `<small>${escapeHtml(entry.note)}</small>` : ""}
          </div>
          <small>${escapeHtml(entry.status)} | ${escapeHtml(formatDateTime(entry.createdAt))}</small>
        </article>
      `;
    })
    .join("");
}

function renderCreditHistory() {
  const creditRows = state.creditHistory.length
    ? state.creditHistory
        .map(
          (item) => `
        <tr>
          <td>${escapeHtml(item.date)}</td>
          <td>${escapeHtml(item.deliverable)}</td>
          <td>${escapeHtml(item.credits)}</td>
          <td>${escapeHtml(item.balance)}</td>
        </tr>
      `
        )
        .join("")
    : `<tr><td colspan="4" class="empty-cell">No Advisory Credit usage has been recorded for this workspace yet.</td></tr>`;

  const paymentRows = state.paymentHistory.length
    ? state.paymentHistory
        .map(
          (item) => `
        <tr>
          <td>${escapeHtml(item.date)}</td>
          <td>${escapeHtml(item.item)}</td>
          <td>${escapeHtml(item.amount)}</td>
          <td>${escapeHtml(item.status)}</td>
        </tr>
      `
        )
        .join("")
    : `<tr><td colspan="4" class="empty-cell">No payments have been recorded for this workspace yet.</td></tr>`;

  const auditRows = state.auditEvents.length
    ? state.auditEvents
        .map(
          (item) => `
        <tr>
          <td>${escapeHtml(item.date)}</td>
          <td>${escapeHtml(item.event)}</td>
          <td>${escapeHtml(item.client)}</td>
          <td>${escapeHtml(item.details)}</td>
        </tr>
      `
        )
        .join("")
    : `<tr><td colspan="4" class="empty-cell">No audit entries have been recorded yet.</td></tr>`;

  const selectedClient = getSelectedAdminClient();
  const selectedProject = getSelectedAdminProject();
  const adminCreditRows = state.adminCreditLedger.length
    ? state.adminCreditLedger
        .filter((item) => isSelectedAdminRecord(item, selectedClient))
        .filter((item) => {
          if (!selectedProject?.id) return isSelectedAdminProjectRecord(item, selectedProject);
          const recordProjectId = item.projectId || item.project_id || "";
          return !recordProjectId || isSelectedAdminProjectRecord(item, selectedProject);
        })
        .map(
          (item) => `
        <tr>
          <td>${escapeHtml(item.date)}</td>
          <td>${escapeHtml(item.deliverable)}</td>
          <td>${escapeHtml(item.credits)}</td>
          <td>${escapeHtml(item.balance)}</td>
        </tr>
      `
        )
        .join("")
    : "";

  const adminPaymentRows = state.adminPaymentHistory.length
    ? state.adminPaymentHistory
        .filter((item) => isSelectedAdminRecord(item, selectedClient))
        .map(
          (item) => `
        <tr>
          <td>${escapeHtml(item.date)}</td>
          <td>${escapeHtml(item.item)}</td>
          <td>${escapeHtml(item.amount)}</td>
          <td>${escapeHtml(item.status)}</td>
        </tr>
      `
        )
        .join("")
    : "";

  const adminAuditRows = state.adminAuditEvents.length
    ? state.adminAuditEvents
        .filter((item) => isSelectedAdminScopedRecord(item, selectedClient, selectedProject))
        .map(
          (item) => `
        <tr>
          <td>${escapeHtml(item.date)}</td>
          <td>${escapeHtml(item.event)}</td>
          <td>${escapeHtml(item.client)}</td>
          <td>${escapeHtml(item.details)}</td>
        </tr>
      `
        )
        .join("")
    : "";

  const creditTable = document.querySelector("#creditHistoryTable tbody");
  const paymentTable = document.querySelector("#paymentHistoryTable tbody");
  const adminCreditLedgerTable = document.querySelector("#adminCreditLedgerTable tbody");
  const adminPaymentTable = document.querySelector("#adminPaymentHistoryTable tbody");
  const auditTable = document.querySelector("#auditTable tbody");
  if (creditTable) creditTable.innerHTML = creditRows;
  if (paymentTable) paymentTable.innerHTML = paymentRows;
  if (adminCreditLedgerTable) adminCreditLedgerTable.innerHTML = adminCreditRows || `<tr><td colspan="4" class="empty-cell">No credit ledger entries for the selected client.</td></tr>`;
  if (adminPaymentTable) adminPaymentTable.innerHTML = adminPaymentRows || `<tr><td colspan="4" class="empty-cell">No payments for the selected client.</td></tr>`;
  if (auditTable) auditTable.innerHTML = adminAuditRows || `<tr><td colspan="4" class="empty-cell">No admin audit entries for the selected client.</td></tr>`;
}

function renderCreditControls() {
  if (state.adminClients.length && state.selectedAdminClientId) {
    syncSelectedAdminClientToState();
  }
  const availableCredits = getAvailableCredits();
  const totalCredits = Math.max(0, Number(state.creditsLeft || 0));
  const reservedCredits = Math.max(0, Number(state.reservedCredits || 0));
  const reservedText = reservedCredits > 0 ? ` ${reservedCredits} reserved for active work.` : "";
  const usageText = `${availableCredits} Advisory Credit${availableCredits === 1 ? "" : "s"} available.${reservedText} Low credit threshold: ${state.creditThreshold}.`;
  const usageBase = Math.max(config.starterCredits, totalCredits, availableCredits, Number(state.creditThreshold || 0), 1);
  const usagePercent = Math.min(100, Math.round((availableCredits / usageBase) * 100));
  const creditAlertState = getCreditAlertState();
  const summary = document.querySelector("#creditUsageSummary");
  const bar = document.querySelector("#creditUsageBar");
  const alert = document.querySelector("#creditAlert");
  const adminBalance = document.querySelector("#adminCreditBalance");
  const adminThreshold = document.querySelector("#adminLowCreditThreshold");
  const deliverableSelect = document.querySelector("#adminDeliverableSelect");
  const clientSelect = document.querySelector("#adminClientSelect");
  const adminAlertCount = document.querySelector("#adminAlertCount");
  const adminAlertSummary = document.querySelector("#adminAlertSummary");
  const adminCreditAlertPanel = document.querySelector("#adminCreditAlertPanel");
  const adminCreditAlertText = document.querySelector("#adminCreditAlertText");
  const deliveryCreditStatus = document.querySelector("#adminDeliveryCreditStatus");
  const uploadClientSelect = document.querySelector("#adminUploadClientSelect");
  const uploadRequestSelect = document.querySelector("#adminUploadRequestSelect");
  const adminProjectFilter = document.querySelector("#adminProjectFilter");
  const adminUploadProjectSelect = document.querySelector("#adminUploadProjectSelect");
  const existingDeliverableSelect = document.querySelector("#adminExistingDeliverableSelect");
  const selectedClient = getSelectedAdminClient();
  syncSelectedAdminProjectToClient();
  const selectedProject = getSelectedAdminProject();
  const adminProjects = getAdminProjectsForClient(selectedClient);
  const hasAdminClient = hasSelectedAdminClient();
  const selectedQueueItems = hasAdminClient ? getSelectedAdminQueueItems() : [];
  const selectedDeliverables = state.adminDeliverables.filter((deliverable) => isSelectedAdminScopedRecord(deliverable, selectedClient, selectedProject));
  const pendingCount = selectedQueueItems.filter((item) => isPendingStatus(item.status)).length;
  const pausedCount =
    selectedQueueItems.filter((item) => isPausedStatus(item.status)).length +
    selectedDeliverables.filter((deliverable) => isPausedStatus(deliverable.status)).length;
  const shippedCount =
    selectedQueueItems.filter((item) => isShippedStatus(item.status)).length +
    selectedDeliverables.filter((deliverable) => isShippedStatus(deliverable.status)).length;
  const dueCount = selectedQueueItems.filter((item) => item.dueAt && isPendingStatus(item.status) && isDueSoon(item.dueAt)).length;

  if (summary) summary.textContent = usageText;
  if (bar) bar.style.width = `${usagePercent}%`;
  if (alert) {
    alert.innerHTML = getCreditPromptHtml();
    alert.classList.toggle("warning", creditAlertState.level !== "healthy");
  }
  const accountBalance = document.querySelector("#accountCreditBalance");
  const accountPrompt = document.querySelector("#accountCreditPrompt");
  if (accountBalance) accountBalance.textContent = getCreditBalanceLabel();
  if (accountPrompt) {
    accountPrompt.innerHTML = getCreditPromptHtml();
    accountPrompt.classList.toggle("warning", creditAlertState.level !== "healthy");
  }
  if (adminBalance) adminBalance.value = state.creditsLeft;
  if (adminThreshold) adminThreshold.value = state.creditThreshold;
  if (clientSelect) {
    const clients = state.adminClients.length
      ? state.adminClients
      : state.adminQueue
          .filter((item) => item.organizationId)
          .reduce((list, item) => {
            if (!list.some((client) => client.id === item.organizationId)) {
              list.push({ id: item.organizationId, selectionId: item.organizationId, name: item.client || "Client workspace", balance: 0 });
            }
            return list;
          }, []);
    clientSelect.innerHTML =
      `<option value="">Select a client</option>` +
      clients
        .map((client) => {
          const value = client.selectionId || client.id || "";
          const selected = value === state.selectedAdminClientId || client.id === state.selectedAdminClientId ? " selected" : "";
          const balance = client.balance ?? 0;
          return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(client.name)} (${escapeHtml(balance)} credits)</option>`;
        })
        .join("");
  }
  if (deliverableSelect) {
    const deliverables = hasAdminClient ? state.adminQueue.filter(
      (item) => item.queueType === "request" && isSelectedAdminScopedRecord(item, selectedClient, selectedProject) && (item.requestId || item.id)
    ) : [];
    const source = deliverables.length ? deliverables : [];
    deliverableSelect.innerHTML = source
      .map((request) => {
        const value = request.requestId || request.id;
        const label = `${getRequestDisplayRef(request)} | ${request.type || "Client request"}`;
        return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
      })
      .join("") || `<option value="">Select a client request</option>`;
  }
  if (adminProjectFilter) {
    const allSelected = !state.selectedAdminProjectId || state.selectedAdminProjectId === ADMIN_ALL_PROJECTS_VALUE || !selectedProject;
    adminProjectFilter.innerHTML =
      adminProjects.length
        ? `<option value="${ADMIN_ALL_PROJECTS_VALUE}"${allSelected ? " selected" : ""}>All active projects</option>` +
          adminProjects
            .map((project) => {
              const selected = project.id === state.selectedAdminProjectId ? " selected" : "";
              return `<option value="${escapeHtml(project.id)}"${selected}>${escapeHtml(getProjectLabel(project))}</option>`;
            })
            .join("")
        : `<option value="">No project yet</option>`;
  }
  const uploadClientId = state.selectedAdminClientId || uploadClientSelect?.value || "";
  if (uploadClientSelect) {
    const clients = state.adminClients.filter((client) => client.id);
    uploadClientSelect.innerHTML =
      `<option value="">Select a client</option>` +
      clients
        .map((client) => {
          const selected = client.id === (uploadClientId || state.selectedAdminClientId) ? " selected" : "";
          return `<option value="${escapeHtml(client.id)}"${selected}>${escapeHtml(client.name)}</option>`;
        })
        .join("");
  }
  if (adminUploadProjectSelect) {
    const selectedOrg = state.selectedAdminClientId || uploadClientSelect?.value || "";
    const projects = selectedOrg ? state.adminProjects.filter((project) => project.organizationId === selectedOrg && isActiveProject(project)) : [];
    const current =
      state.adminUploadProjectId === null || state.adminUploadProjectId === undefined
        ? state.selectedAdminProjectId
        : state.adminUploadProjectId;
    adminUploadProjectSelect.innerHTML =
      `<option value="">Select a project</option>` +
      projects
        .map((project) => {
          const selected = project.id === current ? " selected" : "";
          return `<option value="${escapeHtml(project.id)}"${selected}>${escapeHtml(getProjectLabel(project))}</option>`;
        })
        .join("");
  }
  if (uploadRequestSelect) {
    const selectedOrg = state.selectedAdminClientId || uploadClientSelect?.value || "";
    const selectedUploadProjectId = getAdminUploadProjectId();
    const requests = selectedOrg
      ? state.adminQueue.filter((item) =>
          item.queueType === "request" &&
          item.organizationId === selectedOrg &&
          (!selectedUploadProjectId || item.projectId === selectedUploadProjectId)
        )
      : [];
    uploadRequestSelect.innerHTML =
      `<option value="">No linked request</option>` +
      requests
        .map((request) => `<option value="${escapeHtml(request.requestId || request.id)}">${escapeHtml(getRequestDisplayRef(request))} | ${escapeHtml(request.type)}</option>`)
        .join("");
  }
  if (existingDeliverableSelect) {
    const selectedOrg = state.selectedAdminClientId || uploadClientSelect?.value || "";
    const selectedUploadProjectId = getAdminUploadProjectId();
    const deliverables = selectedOrg
      ? state.adminDeliverables.filter((deliverable) => deliverable.organizationId === selectedOrg && (!selectedUploadProjectId || deliverable.projectId === selectedUploadProjectId))
      : [];
    existingDeliverableSelect.innerHTML =
      `<option value="">Create new deliverable</option>` +
      deliverables
        .map((deliverable) => `<option value="${escapeHtml(deliverable.id)}">${escapeHtml(deliverable.title)} | Version ${escapeHtml(deliverable.currentVersion || 1)}</option>`)
        .join("");
  }
  const selectedName = document.querySelector("#adminSelectedClientName");
  const selectedEmail = document.querySelector("#adminSelectedClientEmail");
  const selectedCredits = document.querySelector("#adminSelectedClientCredits");
  const selectedStatus = document.querySelector("#adminSelectedClientStatus");
  const dueDeliverables = document.querySelector("#adminDueDeliverables");
  const pendingRequests = document.querySelector("#adminPendingCount");
  const shippedDeliverables = document.querySelector("#adminShippedCount");
  const pausedDeliverables = document.querySelector("#adminPausedCount");
  const messageClient = document.querySelector("#adminMessageClient");
  const queueMessageClient = document.querySelector("#adminQueueMessageClient");
  if (selectedName) selectedName.textContent = hasAdminClient ? selectedClient.name || "Client workspace" : "Select a client";
  if (selectedEmail) selectedEmail.textContent = hasAdminClient ? getClientEmail(selectedClient) || "No billing email recorded." : "Choose a client before taking action.";
  if (selectedCredits) selectedCredits.textContent = hasAdminClient ? getCreditBalanceLabel() : "0";
  if (selectedStatus) selectedStatus.textContent = hasAdminClient ? creditAlertState.summary : "No client selected";
  if (dueDeliverables) dueDeliverables.textContent = dueCount;
  if (pendingRequests) pendingRequests.textContent = pendingCount;
  if (shippedDeliverables) shippedDeliverables.textContent = shippedCount;
  if (pausedDeliverables) pausedDeliverables.textContent = pausedCount;
  [messageClient, queueMessageClient].forEach((button) => {
    if (!button) return;
    const clientEmail = getClientEmail(selectedClient);
    if (hasAdminClient && clientEmail) {
      button.disabled = false;
      button.classList.remove("disabled");
      button.removeAttribute("aria-disabled");
    } else {
      button.disabled = true;
      button.classList.add("disabled");
      button.setAttribute("aria-disabled", "true");
    }
  });
  if (adminCreditAlertPanel) {
    adminCreditAlertPanel.classList.toggle("warning", creditAlertState.level === "low");
    adminCreditAlertPanel.classList.toggle("danger", creditAlertState.level === "depleted");
    const globalAlertCount = Number(adminAlertCount?.textContent || 0);
    adminCreditAlertPanel.classList.toggle("hidden", hasAdminClient ? creditAlertState.level === "healthy" : globalAlertCount <= 0);
  }
  if (adminCreditAlertText) {
    adminCreditAlertText.textContent = hasAdminClient
      ? creditAlertState.message
      : adminAlertSummary?.textContent || "No client credit alerts require action.";
  }
  if (deliveryCreditStatus) {
    deliveryCreditStatus.textContent =
      availableCredits <= 0
        ? "The selected client has no Advisory Credits available. Status can be updated, but new credit work should remain paused."
        : `${availableCredits} client-level Advisory Credits available. Status updates do not consume credits.${reservedText}`;
    deliveryCreditStatus.classList.toggle("warning", availableCredits <= state.creditThreshold);
  }
  updateAdminReleaseReadiness();
}

function updateAdminReleaseReadiness() {
  const status = document.querySelector("#adminDeliverableUploadStatus");
  const button = document.querySelector("#adminReleaseFilesButton");
  if (!status || !button) return;

  const organizationId = state.selectedAdminClientId || document.querySelector("#adminUploadClientSelect")?.value || "";
  const projectId = getAdminUploadProjectId();
  const title = document.querySelector("#adminDeliverableTitle")?.value.trim();
  const summary = document.querySelector("#adminDeliverableSummary")?.value.trim();
  const releaseNote = document.querySelector("#adminDeliverableReleaseNote")?.value.trim();
  const creditsUsed = Math.max(0, Number(document.querySelector("#adminReleaseCreditsUsed")?.value || 0));
  const availableCredits = getAdminCreditBalanceForOrganization(organizationId);
  const files = getAdminUploadFiles();
  const validationError = validateWorkspaceFiles(files);

  let message = "Select a client and upload files when the deliverable is ready.";
  let ready = true;

  if (!organizationId) {
    message = "Step 1: select a client before releasing files.";
    ready = false;
  } else if (!projectId) {
    message = "Step 2: select the project workspace for this deliverable.";
    ready = false;
  } else if (!title) {
    message = "Step 3: add a clear deliverable title.";
    ready = false;
  } else if (!summary) {
    message = "Step 4: add a short release summary.";
    ready = false;
  } else if (!releaseNote) {
    message = "Step 5: add a version note.";
    ready = false;
  } else if (!files.length) {
    message = "Step 6: choose one or more deliverable files.";
    ready = false;
  } else if (validationError) {
    message = validationError;
    ready = false;
  } else if (creditsUsed > availableCredits) {
    message = `This client has ${availableCredits} Advisory Credit${availableCredits === 1 ? "" : "s"} available. Add credits or set credits to 0 only if this work is covered by a fixed scope.`;
    ready = false;
  } else {
    const creditText = creditsUsed > 0 ? ` ${creditsUsed} Advisory Credit${creditsUsed === 1 ? "" : "s"} will be recorded now.` : " No Advisory Credits will be recorded until you decide to deduct or adjust them.";
    message = `${files.length} file${files.length === 1 ? "" : "s"} ready to release to the selected client.${creditText}`;
  }

  status.textContent = message;
  status.classList.toggle("warning", !ready);
  status.classList.toggle("success", ready);
  button.dataset.ready = ready ? "true" : "false";
  button.classList.toggle("not-ready", !ready);
}

function validateAdminReleaseForm() {
  const organizationId = state.selectedAdminClientId || document.querySelector("#adminUploadClientSelect")?.value || "";
  const projectId = getAdminUploadProjectId();
  const title = document.querySelector("#adminDeliverableTitle")?.value.trim();
  const summary = document.querySelector("#adminDeliverableSummary")?.value.trim();
  const releaseNote = document.querySelector("#adminDeliverableReleaseNote")?.value.trim();
  const files = getAdminUploadFiles();

  return validateFieldSet({
    containerSelector: ".admin-primary-release",
    statusSelector: "#adminDeliverableUploadStatus",
    message: "Complete the highlighted release fields before uploading files.",
    fields: [
      { selector: "#adminUploadClientSelect", isValid: () => Boolean(organizationId), message: "Select a client." },
      { selector: "#adminUploadProjectSelect", isValid: () => Boolean(projectId), message: "Select a project." },
      { selector: "#adminDeliverableTitle", isValid: () => Boolean(title), message: "Add a deliverable title." },
      { selector: "#adminDeliverableSummary", isValid: () => Boolean(summary), message: "Add a short release summary." },
      { selector: "#adminDeliverableReleaseNote", isValid: () => Boolean(releaseNote), message: "Add a version note." },
      { selector: "#adminDeliverableFiles", isValid: () => Boolean(files.length), message: "Choose at least one file." },
    ],
  });
}

function setAdminReleaseStatus(message, level = "") {
  const status = document.querySelector("#adminDeliverableUploadStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.remove("warning", "success");
  if (level) {
    status.classList.add(level);
  }
}

function render() {
  document.querySelector("#clientName").textContent = state.client.company || "Your organization";
  document.querySelector("#creditsLeft").textContent = getAvailableCredits();
  const billingCreditBalance = document.querySelector("#billingCreditBalance");
  if (billingCreditBalance) billingCreditBalance.textContent = getCreditBalanceLabel();
  document.querySelector("#activeCount").textContent = getVisibleRequests().filter((request) => !isShippedStatus(request.status)).length;
  renderClientProjectControls();
  renderClientWorkspaceSummary();
  renderRequests();
  renderDeliverableStatus();
  renderClientFileRoom();
  renderClientDeliverables();
  renderDeliverySummary();
  renderClientActionOptions();
  renderClientCommunicationLog();
  renderCreditHistory();
  renderCreditControls();
  renderAdminSnapshot();
  renderAdminClientPortfolio();
  renderAdminClientDossier();
}

function setAdminStatus(message) {
  const status = document.querySelector("#adminQueueStatus");
  if (status) status.textContent = message;
}

function getClientFileEntries() {
  const requestFiles = getVisibleRequestFiles().map((file) => ({
    ...file,
    source: "Request source",
  }));
  const uploads = getVisibleUploads().map((file) => ({
    ...file,
    source: file.purpose || "Workspace upload",
  }));
  return [...requestFiles, ...uploads].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function getReleasedFileCount() {
  return getVisibleDeliverables().reduce((total, deliverable) => total + (deliverable.versions?.length || 0), 0);
}

function getLatestClientActivityLabel() {
  const candidates = [
    ...getVisibleRequests().map((item) => item.createdAt || item.due),
    ...getVisibleDeliverables().flatMap((deliverable) => deliverable.versions?.map((version) => version.uploadedAt) || []),
    ...getVisibleMessages().map((item) => item.createdAt),
    ...getVisibleUploads().map((item) => item.createdAt),
    ...getVisibleRequestFiles().map((item) => item.createdAt),
  ]
    .map((value) => new Date(value || 0))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b - a);
  return candidates.length ? formatDisplayDate(candidates[0].toISOString()) : "None yet";
}

function getClientNextStep() {
  const hasProfile = supabaseClient
    ? Boolean(state.profileOrganizationId)
    : Boolean(state.client.email && state.client.company);
  const visibleRequests = getVisibleRequests();
  const visibleDeliverables = getVisibleDeliverables();
  const availableCredits = getAvailableCredits();
  const reviewCount = visibleDeliverables.filter((deliverable) => getVerificationLevel(deliverable.verificationStatus) !== "approved").length;
  if (!hasProfile) {
    return {
      title: "Complete your client profile",
      body: "Add company, role, timezone, and working context so your payments, requests, files, and deliverables stay connected.",
      href: "#profile",
      cta: "Complete Profile",
    };
  }
  if (availableCredits <= 0 && !visibleRequests.length) {
    if (hasRescueSprintAccess()) {
      return {
        title: "Submit your Rescue Sprint intake",
        body: "Your Rescue Sprint purchase is recorded. Send the business goal, desired output, deadline, and source files so the advisory team can begin scoping.",
        href: "#request",
        cta: "Start Intake",
      };
    }
    return {
      title: "Choose a service package",
      body: "Start with a Rescue Sprint or monthly advisory credits, then submit source material through this workspace.",
      href: "#billing",
      cta: "Open Billing",
    };
  }
  if (!visibleRequests.length) {
    return {
      title: "Start your first request",
      body: "Send the business goal, desired output, deadline, and supporting files so the advisory team can scope the work.",
      href: "#request",
      cta: "Start Request",
    };
  }
  if (reviewCount) {
    const deliverableNoun = `released deliverable${reviewCount === 1 ? "" : "s"}`;
    const deliverableVerb = reviewCount === 1 ? "needs" : "need";
    return {
      title: "Review released work",
      body: `${reviewCount} ${deliverableNoun} ${deliverableVerb} your review, approval, or revision notes.`,
      href: "#dashboard",
      cta: "Review Work",
    };
  }
  if (availableCredits <= state.creditThreshold) {
    return {
      title: "Add advisory credits",
      body: "Your balance is low. Add credits before approving new work so delivery does not pause.",
      href: "#billing",
      cta: "Add Credits",
    };
  }
  return {
    title: "Workspace is current",
    body: "Your requests, files, messages, payments, and deliverables are connected in this workspace.",
    href: "#request",
    cta: "Start Another Request",
  };
}

function renderClientProjectControls() {
  const projects = getActiveClientProjects();
  const filter = document.querySelector("#clientProjectFilter");
  const requestSelect = document.querySelector("#requestProjectSelect");
  const requestProjectNameWrap = document.querySelector("#requestProjectNameWrap");
  const title = document.querySelector("#clientProjectFocusTitle");
  const body = document.querySelector("#clientProjectFocusBody");
  const selectedProject = getProjectById(state.selectedProjectId);

  if (filter) {
    const current = state.selectedProjectId;
    filter.innerHTML =
      `<option value="">All active projects</option>` +
      projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(getProjectLabel(project))}</option>`).join("");
    if (current && projects.some((project) => project.id === current)) {
      filter.value = current;
    } else {
      filter.value = "";
      state.selectedProjectId = "";
    }
  }

  if (requestSelect) {
    const current = requestSelect.value;
    requestSelect.innerHTML =
      `<option value="">Select a project</option>` +
      projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(getProjectLabel(project))}</option>`).join("") +
      `<option value="__new__">Create a new project</option>`;
    requestSelect.value = current && (current === "__new__" || projects.some((project) => project.id === current))
      ? current
      : projects.length === 1
        ? projects[0].id
        : "";
  }

  if (requestProjectNameWrap) {
    requestProjectNameWrap.classList.toggle("hidden", requestSelect?.value !== "__new__" && Boolean(requestSelect?.value));
  }

  if (title) title.textContent = selectedProject ? getProjectLabel(selectedProject) : "All active projects";
  if (body) {
    const projectNoun = `active project${projects.length === 1 ? "" : "s"}`;
    const projectVerb = projects.length === 1 ? "is" : "are";
    body.textContent = selectedProject
      ? "Showing requests, files, messages, and deliverables for the selected project."
      : projects.length
        ? `${projects.length} ${projectNoun} ${projectVerb} connected to this workspace.`
        : "Create a project when submitting your first request.";
  }
}

function renderClientWorkspaceSummary() {
  const nextStep = getClientNextStep();
  const title = document.querySelector("#clientNextStepTitle");
  const body = document.querySelector("#clientNextStepBody");
  const cta = document.querySelector("#clientNextStepCta");
  const fileCount = document.querySelector("#clientSourceFileCount");
  const releasedCount = document.querySelector("#clientReleasedFileCount");
  const latestActivity = document.querySelector("#clientLatestActivity");
  if (title) title.textContent = nextStep.title;
  if (body) body.textContent = nextStep.body;
  if (cta) {
    cta.href = nextStep.href;
    cta.textContent = nextStep.cta;
  }
  if (fileCount) fileCount.textContent = getClientFileEntries().length;
  if (releasedCount) releasedCount.textContent = getReleasedFileCount();
  if (latestActivity) latestActivity.textContent = state.workspaceLoadIssue ? "Needs refresh" : getLatestClientActivityLabel();
  if (state.workspaceLoadIssue && title && body && nextStep.title === "Workspace is current") {
    title.textContent = "Refresh workspace information";
    body.textContent = "Some account details could not be loaded. Refresh the page or contact support if this continues.";
    if (cta) {
      cta.href = "#dashboard";
      cta.textContent = "Refresh Workspace";
    }
  }
}

function renderClientFileRoom() {
  const list = document.querySelector("#clientFilesList");
  if (!list) return;
  const files = getClientFileEntries();
  if (!files.length) {
    list.innerHTML = `<div class="empty-cell">No source files or revision uploads are attached yet.</div>`;
    return;
  }
  list.innerHTML = files
    .slice(0, 12)
    .map(
      (file) => `
        <article class="workspace-file-row">
          <div>
            <strong>${escapeHtml(file.fileName)}</strong>
            <span>${escapeHtml(file.source)} | ${escapeHtml(file.projectLabel || getClientProjectLabel(file.projectId))} | ${escapeHtml(file.contextLabel || "Workspace")} | ${escapeHtml(formatFileSize(file.fileSize))}</span>
            ${file.note ? `<small>${escapeHtml(file.note)}</small>` : ""}
          </div>
          <div class="file-row-actions">
            <small>${escapeHtml(formatDateTime(file.createdAt))}</small>
            ${
              file.fileId
                ? `<button class="secondary small" type="button" data-download-source-file="${escapeHtml(file.fileId)}" data-source-kind="${escapeHtml(file.fileKind || "request_file")}" data-organization-id="${escapeHtml(file.organizationId || "")}" data-project-id="${escapeHtml(file.projectId || "")}">Download</button>`
                : ""
            }
            ${
              file.fileId && (file.canDelete || isAdminUser())
                ? `<button class="secondary small danger-button" type="button" data-delete-source-file="${escapeHtml(file.fileId)}" data-source-kind="${escapeHtml(file.fileKind || "request_file")}" data-organization-id="${escapeHtml(file.organizationId || "")}" data-project-id="${escapeHtml(file.projectId || "")}">Remove</button>`
                : ""
            }
          </div>
        </article>
      `
    )
    .join("");
}

function getAdminOpenItemsForClient(client) {
  return state.adminQueue.filter((item) => isSelectedAdminRecord(item, client) && isAdminQueueOpenItem(item));
}

function getAdminFilesForClient(client) {
  const selectedClient = getSelectedAdminClient();
  const project = client?.id && client.id === selectedClient.id ? getSelectedAdminProject() : null;
  return [
    ...state.adminRequestFiles.map((file) => ({ ...file, source: "Request source" })),
    ...state.adminClientUploads
      .map((item) => ({
        id: item.requestId || item.id,
        fileId: item.fileId || item.id,
        fileKind: "client_upload",
        organizationId: item.organizationId,
        projectId: item.projectId,
        projectName: item.projectName,
        projectCode: item.projectCode,
        projectLabel: item.projectLabel,
        clientEmail: item.clientEmail,
        client: item.client,
        fileName: item.type,
        fileSize: item.fileSize || 0,
        source: "Client upload",
        contextLabel: item.dueLabel || "Workspace upload",
        status: item.status,
        createdAt: item.dueAt,
      })),
  ].filter((file) => isSelectedAdminRecord(file, client) && isSelectedAdminProjectRecord(file, project));
}

function getAdminMessagesForClient(client) {
  const selectedClient = getSelectedAdminClient();
  const project = client?.id && client.id === selectedClient.id ? getSelectedAdminProject() : null;
  return state.adminQueue.filter((item) => ["client-message", "notification"].includes(item.queueType) && isSelectedAdminRecord(item, client) && isSelectedAdminProjectRecord(item, project));
}

function getAdminLastActivityForClient(client) {
  const selectedClient = getSelectedAdminClient();
  const project = client?.id && client.id === selectedClient.id ? getSelectedAdminProject() : null;
  const values = [
    ...state.adminQueue.filter((item) => isSelectedAdminRecord(item, client) && isSelectedAdminProjectRecord(item, project)).map((item) => item.dueAt),
    ...state.adminDeliverables.filter((item) => isSelectedAdminRecord(item, client) && isSelectedAdminProjectRecord(item, project)).map((item) => item.updatedAt || item.createdAt),
    ...state.adminCreditLedger.filter((item) => isSelectedAdminRecord(item, client)).map((item) => item.rawDate || item.date),
    ...state.adminPaymentHistory.filter((item) => isSelectedAdminRecord(item, client)).map((item) => item.rawDate || item.date),
  ]
    .map((value) => new Date(value || 0))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b - a);
  return values.length ? formatDisplayDate(values[0].toISOString()) : "No activity";
}

function getAdminClientHealth(client) {
  if (!client?.id) return "Inquiry";
  const alert = getCreditAlertState(getAdminCreditBalanceForOrganization(client.id), Number(client.lowCreditThreshold || config.lowCreditThreshold));
  if (alert.level === "depleted") return "Blocked";
  if (alert.level === "low") return "Needs top up";
  if (getAdminOpenItemsForClient(client).length) return "Active";
  return "Current";
}

function renderAdminSnapshot() {
  const clients = state.adminClients.filter((client) => client.id);
  const fileInbox = state.adminQueue.filter((item) => ["client-upload", "request-file"].includes(item.queueType) && isAdminQueueOpenItem(item)).length;
  const released = state.adminDeliverables.length;
  const lowCreditClients = clients.filter((client) => getCreditAlertState(getAdminCreditBalanceForOrganization(client.id), Number(client.lowCreditThreshold || config.lowCreditThreshold)).level !== "healthy").length;
  const openWork = state.adminQueue.filter(isAdminQueueOpenItem).length;
  const customInquiries = state.adminQueue.filter((item) => item.queueType === "quote" && isAdminQueueOpenItem(item)).length;
  const activeClientCount = document.querySelector("#adminActiveClientCount");
  const openWorkCount = document.querySelector("#adminNewCount");
  const quoteCount = document.querySelector("#adminQuoteCount");
  const fileInboxCount = document.querySelector("#adminFileInboxCount");
  const readyCount = document.querySelector("#adminReadyCount");
  const alertCount = document.querySelector("#adminAlertCount");
  const alertSummary = document.querySelector("#adminAlertSummary");
  if (activeClientCount) activeClientCount.textContent = clients.length;
  if (openWorkCount) openWorkCount.textContent = openWork || state.adminNewCount || 0;
  if (quoteCount) quoteCount.textContent = customInquiries;
  if (fileInboxCount) fileInboxCount.textContent = fileInbox;
  if (readyCount) readyCount.textContent = released;
  if (alertCount) alertCount.textContent = lowCreditClients;
  if (alertSummary) alertSummary.textContent = lowCreditClients ? `${lowCreditClients} client${lowCreditClients === 1 ? "" : "s"} need review` : "No credit alerts";
}

function renderAdminClientPortfolio() {
  const table = document.querySelector("#adminClientPortfolioTable tbody");
  if (!table) return;
  const clients = state.adminClients;
  if (!clients.length) {
    table.innerHTML = `<tr><td colspan="5" class="empty-cell">No client workspaces are available yet.</td></tr>`;
    return;
  }
  table.innerHTML = clients
    .map((client) => {
      const openItems = getAdminOpenItemsForClient(client).length;
      const activeProjects = (client.projects || []).filter((project) => !["archived", "closed"].includes(normalizeStatusValue(project.status))).length;
      const selected = state.selectedAdminClientId && (state.selectedAdminClientId === client.selectionId || state.selectedAdminClientId === client.id);
      return `
        <tr class="${selected ? "selected-row" : ""}" aria-selected="${selected ? "true" : "false"}">
          <td>
            <strong>${escapeHtml(client.name || "Client workspace")}</strong>
            <span>${escapeHtml(getClientEmail(client) || "No email recorded")}</span>
            <small>${escapeHtml(activeProjects ? `${activeProjects} active project${activeProjects === 1 ? "" : "s"}` : "No active project yet")}</small>
            <button class="small secondary" type="button" data-admin-action="select-client" data-client-selection="${escapeHtml(client.selectionId || client.id)}">${selected ? "Viewing dossier" : "View dossier"}</button>
          </td>
          <td>${escapeHtml(getAdminClientHealth(client))}</td>
          <td>${escapeHtml(getCreditBalanceLabelForAdmin(client))}</td>
          <td>${escapeHtml(openItems)}</td>
          <td>${escapeHtml(getAdminLastActivityForClient(client))}</td>
        </tr>
      `;
    })
    .join("");
}

function renderAdminClientDossier() {
  const client = getSelectedAdminClient();
  const profile = document.querySelector("#adminDossierProfile");
  const requests = document.querySelector("#adminDossierRequests");
  const files = document.querySelector("#adminDossierFiles");
  const deliverables = document.querySelector("#adminDossierDeliverables");
  const messages = document.querySelector("#adminDossierMessages");
  if (!state.selectedAdminClientId) {
    const empty = `<p class="muted">Select a client to open their complete file.</p>`;
    if (profile) profile.innerHTML = empty;
    if (requests) requests.innerHTML = empty;
    if (files) files.innerHTML = empty;
    if (deliverables) deliverables.innerHTML = empty;
    if (messages) messages.innerHTML = empty;
    return;
  }

  if (profile) {
    const activeProject = getSelectedAdminProject();
    const projectScopeLabel = activeProject ? getProjectLabel(activeProject) : "All active projects";
    const projectRequests = client.id ? state.adminQueue.filter((item) => item.queueType === "request" && isSelectedAdminScopedRecord(item, client, activeProject) && isAdminQueueOpenItem(item)) : [];
    const projectFiles = client.id ? getAdminFilesForClient(client) : [];
    const projectDeliverables = client.id ? state.adminDeliverables.filter((deliverable) => isSelectedAdminScopedRecord(deliverable, client, activeProject)) : [];
    const projectMessages = client.id ? getAdminMessagesForClient(client) : [];
    const activeProjectCount = (client.projects || []).filter((project) => !["archived", "closed"].includes(normalizeStatusValue(project.status))).length;
    const profileRows = [
      ["Client reference", getClientDisplayId(client)],
      ["Email", getClientEmail(client) || "Not recorded"],
      ["Primary contact", [client.firstName, client.lastName].filter(Boolean).join(" ") || "Not recorded"],
      ["Project reference", activeProject ? getProjectDisplayRef(activeProject) : `${activeProjectCount} active projects`],
      ["Active project", activeProject ? getProjectLabel(activeProject) : "All active projects"],
      ["Primary need", client.primaryBusinessNeed || "Not recorded"],
    ];
    const contextRows = [
      ["Job title", client.jobTitle || "Not recorded"],
      ["Phone", client.phone || "Not recorded"],
      ["Workspace status", client.id ? "Client workspace active" : "Inquiry without workspace"],
      ["Industry", client.industry || "Not recorded"],
      ["Country", client.country || "Not recorded"],
      ["Time zone", client.timezone || "Not recorded"],
      ["Working style", client.workingStyle || "Not recorded"],
    ];
    const projectSummary = `
      <div class="admin-scope-note">
        <strong>Current dossier scope</strong>
        <span>${escapeHtml(projectScopeLabel)}. Credits and payments remain client level.</span>
      </div>
      <div class="dossier-project-strip">
        <button type="button" class="dossier-metric projects" data-admin-action="jump-admin-section" data-target-id="adminProjectFilter"><strong>${escapeHtml(activeProjectCount)}</strong><span>Active projects</span></button>
        <button type="button" class="dossier-metric requests" data-admin-action="jump-admin-section" data-target-id="adminDossierRequestsBlock"><strong>${escapeHtml(projectRequests.length)}</strong><span>Open requests</span></button>
        <button type="button" class="dossier-metric files" data-admin-action="jump-admin-section" data-target-id="adminDossierFilesBlock"><strong>${escapeHtml(projectFiles.length)}</strong><span>Source files</span></button>
        <button type="button" class="dossier-metric deliverables" data-admin-action="jump-admin-section" data-target-id="adminDossierDeliverablesBlock"><strong>${escapeHtml(projectDeliverables.length)}</strong><span>Released deliverables</span></button>
        <button type="button" class="dossier-metric messages" data-admin-action="jump-admin-section" data-target-id="adminDossierMessagesBlock"><strong>${escapeHtml(projectMessages.length)}</strong><span>Messages and notices</span></button>
      </div>
    `;
    profile.innerHTML =
      projectSummary +
      profileRows.map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join("") +
      `<details class="dossier-context-details">
        <summary>More client context</summary>
        ${contextRows.map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join("")}
      </details>`;
  }

  if (requests) {
    const activeProject = getSelectedAdminProject();
    const requestRows = client.id ? state.adminQueue.filter((item) => item.queueType === "request" && isSelectedAdminScopedRecord(item, client, activeProject) && isAdminQueueOpenItem(item)) : [];
    requests.innerHTML = requestRows.length
      ? requestRows
          .slice(0, 10)
          .map(
            (request) => `
              <article class="admin-dossier-row">
                <div>
                  <strong>${escapeHtml(getRequestDisplayRef(request))} | ${escapeHtml(request.type || "Client request")}</strong>
                  <span>${escapeHtml(getClientProjectLabel(request))} | ${escapeHtml(normalizeVerificationStatus(request.status))} | ${escapeHtml(request.dueLabel || "No due date set")}</span>
                  <small>${escapeHtml(request.businessGoal || request.attachmentDescription || "Review intake details and source files before delivery.")}</small>
                </div>
                <div class="table-actions">
                  <button class="secondary small" type="button" data-admin-action="open-message-client" data-queue-key="${escapeHtml(buildAdminQueueKey(request))}">Message</button>
                  <button class="small" type="button" data-admin-action="prepare-upload" data-request-id="${escapeHtml(request.requestId)}" data-organization-id="${escapeHtml(request.organizationId)}" data-project-id="${escapeHtml(request.projectId || "")}">Release Work</button>
                </div>
              </article>
            `
          )
          .join("")
      : `<p class="muted">${client.id ? "No open requests for the active project." : "Create or link a client workspace before request handling."}</p>`;
  }

  if (files) {
    const fileRows = client.id ? getAdminFilesForClient(client) : [];
    files.innerHTML = fileRows.length
      ? fileRows
        .slice(0, 20)
        .map(
          (file) => `
              <p><strong>${escapeHtml(file.fileName || file.type || "Client file")}</strong><br />
              <span>${escapeHtml(getClientProjectLabel(file))} | ${escapeHtml(file.source || "File")} | ${escapeHtml(file.contextLabel || file.status || "Received")} | ${escapeHtml(formatFileSize(file.fileSize))} | ${escapeHtml(formatDateTime(file.createdAt || file.dueAt))}</span>
              ${
                file.fileId
                  ? `<br /><button class="secondary small" type="button" data-download-source-file="${escapeHtml(file.fileId)}" data-source-kind="${escapeHtml(file.fileKind || "request_file")}" data-organization-id="${escapeHtml(file.organizationId || "")}" data-project-id="${escapeHtml(file.projectId || "")}">Download</button>
                    <button class="secondary small danger-button" type="button" data-delete-source-file="${escapeHtml(file.fileId)}" data-source-kind="${escapeHtml(file.fileKind || "request_file")}" data-organization-id="${escapeHtml(file.organizationId || "")}" data-project-id="${escapeHtml(file.projectId || "")}">Remove</button>`
                  : ""
              }</p>
            `
        )
          .join("")
      : `<p class="muted">${client.id ? "No client files are attached yet." : "Create or link a client workspace before file handling."}</p>`;
  }

  if (deliverables) {
    const activeProject = getSelectedAdminProject();
    const rows = client.id ? state.adminDeliverables.filter((deliverable) => isSelectedAdminScopedRecord(deliverable, client, activeProject)) : [];
    deliverables.innerHTML = rows.length
      ? rows
          .slice(0, 8)
          .map((deliverable) => {
            const files = state.adminDeliverableFiles.filter((file) => {
              if (file.deliverableId !== deliverable.id) return false;
              if (deliverable.projectId && file.projectId && file.projectId !== deliverable.projectId) return false;
              return !activeProject || !file.projectId || file.projectId === activeProject.id;
            });
            const fileHtml = files.length
              ? files
                  .slice(0, 5)
                  .map(
                    (file) => `<br /><button class="secondary small" type="button" data-download-file="${escapeHtml(file.fileId)}" data-organization-id="${escapeHtml(file.organizationId || deliverable.organizationId || "")}" data-project-id="${escapeHtml(file.projectId || deliverable.projectId || "")}">${escapeHtml(file.fileName)} | Version ${escapeHtml(file.versionNumber || deliverable.currentVersion || 1)}</button>`
                  )
                  .join("")
              : `<br /><span class="muted">No file rows found for this deliverable.</span>`;
            return `<p><strong>${escapeHtml(deliverable.title)}</strong><br /><span>${escapeHtml(getClientProjectLabel(deliverable))} | ${escapeHtml(deliverable.type)} | Version ${escapeHtml(deliverable.currentVersion || 1)} | ${escapeHtml(deliverable.status)}</span>${fileHtml}</p>`;
          })
          .join("")
      : `<p class="muted">${client.id ? "No deliverables have been released yet." : "No deliverables can be released until a client workspace exists."}</p>`;
  }

  if (messages) {
    const rows = getAdminMessagesForClient(client);
    messages.innerHTML = rows.length
      ? rows
          .slice(0, 8)
          .map((message) => {
            const body = message.body ? `<br /><span>${escapeHtml(message.body)}</span>` : "";
            return `<p><strong>${escapeHtml(message.type)}</strong><br /><span>${escapeHtml(getClientProjectLabel(message))} | ${escapeHtml(message.action)} | ${escapeHtml(formatDateTime(message.dueAt))}</span>${body}</p>`;
          })
          .join("")
      : `<p class="muted">No client messages need review.</p>`;
  }
}

function resolveAdminMessageContext(queueItem = null) {
  const selectedClient = getSelectedAdminClient();
  const client = queueItem?.organizationId
    ? state.adminClients.find((item) => item.id === queueItem.organizationId) || selectedClient
    : queueItem?.clientEmail
      ? {
          id: "",
          name: queueItem.client || queueItem.clientEmail,
          email: queueItem.clientEmail,
          billingEmail: queueItem.clientEmail,
        }
    : selectedClient;
  const project = queueItem
    ? queueItem.projectId
      ? state.adminProjects.find((item) => item.id === queueItem.projectId) || null
      : null
    : getSelectedAdminProject();
  let relatedEntityType = ["request", "deliverable", "workspace"].includes(queueItem?.relatedEntityType) ? queueItem.relatedEntityType : "workspace";
  let relatedEntityId = relatedEntityType === "workspace" ? null : queueItem?.relatedEntityId || null;
  if (!queueItem?.relatedEntityType) {
    if (queueItem?.queueType === "request" || queueItem?.queueType === "request-file") {
      relatedEntityType = "request";
      relatedEntityId = queueItem?.requestId || null;
    } else if (queueItem?.queueType === "client-upload" && queueItem?.requestId) {
      relatedEntityType = "request";
      relatedEntityId = queueItem.requestId;
    } else if ((queueItem?.queueType === "client-message" || queueItem?.queueType === "client-upload") && queueItem?.deliverableId) {
      relatedEntityType = "deliverable";
      relatedEntityId = queueItem.deliverableId;
    }
  }

  return {
    client,
    project,
    queueItem,
    organizationId: client?.id || queueItem?.organizationId || "",
    projectId: project?.id || queueItem?.projectId || "",
    email: getClientEmail(client) || queueItem?.clientEmail || "",
    relatedEntityType,
    relatedEntityId,
  };
}

function openAdminMessageComposer(queueItem = null) {
  const composer = document.querySelector("#adminMessageComposer");
  const contextText = document.querySelector("#adminMessageComposerContext");
  const subject = document.querySelector("#adminMessageSubject");
  const body = document.querySelector("#adminMessageBody");
  if (!composer) return;

  const context = resolveAdminMessageContext(queueItem);
  state.adminMessageContext = context;
  const clientName = context.client?.name || queueItem?.client || "Selected client";
  const projectName = context.project ? getProjectLabel(context.project) : queueItem?.projectLabel || "General advisory work";
  if (contextText) {
    contextText.textContent = context.email
      ? `${clientName} | ${projectName} | ${context.email}`
      : "Select a client with an email address before sending a message.";
  }
  if (subject) subject.value = queueItem ? `BA Advisory Desk update: ${getAdminWorkTitle(queueItem)}` : "BA Advisory Desk workspace update";
  if (body) body.value = "";
  setInlineStatus(
    "#adminMessageStatus",
    context.organizationId
      ? "The email subject will include a support reference, and the message will be saved in the client workspace."
      : "The email subject will include a support reference. Once this inquiry becomes a client, the workspace will hold the full message history."
  );
  composer.classList.remove("hidden");
  window.requestAnimationFrame(() => body?.focus());
}

function closeAdminMessageComposer() {
  document.querySelector("#adminMessageComposer")?.classList.add("hidden");
  state.adminMessageContext = null;
  clearFieldErrors("#adminMessageComposer");
}

async function sendAdminClientMessage() {
  const context = state.adminMessageContext || resolveAdminMessageContext();
  const subjectField = document.querySelector("#adminMessageSubject");
  const bodyField = document.querySelector("#adminMessageBody");
  const subject = subjectField?.value.trim() || "";
  const message = bodyField?.value.trim() || "";

  if (!context.email) {
    const error = "Select a client or inquiry with an email address before sending a message.";
    setInlineStatus("#adminMessageStatus", error, "warning");
    showPersistentNotice(error);
    return { ok: false, error };
  }

  const valid = validateFieldSet({
    containerSelector: "#adminMessageComposer",
    statusSelector: "#adminMessageStatus",
    message: "Complete the message subject and body before sending.",
    fields: [
      { selector: "#adminMessageSubject", isValid: () => Boolean(subject), message: "Add a subject." },
      { selector: "#adminMessageBody", isValid: () => Boolean(message), message: "Write the message." },
    ],
  });
  if (!valid) return { ok: false };

  setInlineStatus("#adminMessageStatus", "Sending the tracked workspace message.");
  const result = await fetchAdminApi("/api/notify", {
    method: "POST",
    body: {
      type: "admin_client_message",
      organizationId: context.organizationId,
      projectId: context.projectId || null,
      email: context.email,
      subject,
      message,
      relatedEntityType: context.relatedEntityType || "workspace",
      relatedEntityId: context.relatedEntityId || null,
    },
  });

  if (!result.ok) {
    setInlineStatus("#adminMessageStatus", result.error || "Message could not be sent.", "warning");
    return result;
  }

  const messageSent = result.data?.sent !== false;
  const messageStatusText = result.data?.emailReference
    ? messageSent
      ? `Message sent and tracked with support reference ${result.data.emailReference}.`
      : `Message saved with support reference ${result.data.emailReference}. Email delivery needs review.`
    : messageSent
      ? "Message sent and tracked in the client workspace."
      : "Message saved in the client workspace. Email delivery needs review.";
  setInlineStatus("#adminMessageStatus", messageStatusText, messageSent ? "success" : "warning");
  if (!messageSent) showPersistentNotice(messageStatusText);
  await loadAdminQueue();
  closeAdminMessageComposer();
  if (messageSent) showToast("Tracked client message sent.");
  return result;
}

async function markAdminQueueItem(queueItem, action = "addressed") {
  if (!queueItem) {
    showToast("Queue item could not be found.");
    return { ok: false };
  }
  if (!(await ensureAdminAccess())) {
    showToast("Please sign in with the administrator email before updating the queue.");
    return { ok: false };
  }

  const id =
    queueItem.queueType === "request"
      ? queueItem.requestId || queueItem.id
      : queueItem.queueType === "request-file" || queueItem.queueType === "client-upload"
        ? queueItem.fileId || queueItem.id
        : queueItem.id;
  const result = await fetchAdminApi("/api/admin-queue", {
    method: "POST",
    body: {
      queueType: queueItem.queueType,
      id,
      organizationId: queueItem.organizationId || null,
      projectId: queueItem.projectId || null,
      action,
    },
  });

  if (!result.ok) {
    showPersistentNotice(result.error || "Queue item could not be updated.");
    return result;
  }

  queueItem.status = result.data?.status || action;
  addAuditEvent("Admin queue updated", `${getAdminWorkTitle(queueItem)} marked ${queueItem.status}.`);
  await loadAdminQueue();
  saveState();
  render();
  showToast("Queue item updated.");
  return result;
}

function normalizeAdminProject(project) {
  const organization = project.client_organizations || {};
  return {
    id: project.id || "",
    organizationId: project.organization_id || "",
    name: project.name || "General Advisory Work",
    projectCode: project.project_code || "",
    projectLabel: project.project_code ? `${project.project_code} | ${project.name}` : project.name || "General Advisory Work",
    status: project.status || "active",
    isDefault: Boolean(project.is_default),
    client: organization.name || "Client workspace",
    clientEmail: organization.billing_email || "",
    createdAt: project.created_at || null,
    updatedAt: project.updated_at || project.created_at || null,
  };
}

function normalizeAdminQueueItem(item) {
  const organization = item.organization || item.organizations || item.account || {};
  const project = getProjectFieldsFromRow(item);
  const client =
    item.client ||
    item.client_name ||
    item.company ||
    item.organization_name ||
    organization.name ||
    item.work_email ||
    "Client workspace";
  const requestId = item.requestId || item.request_id || item.id || item.related_request_id || null;
  const requestCode = item.requestCode || item.request_code || item.code || requestId || "Request";
  const type = item.type || item.request_type || item.title || item.company_type || item.queue_type || "Client request";
  const action = item.action || item.next_action || item.nextAction || "Review intake";
  const status = item.status || item.current_status || "New";

  return {
    queueType: item.queueType || item.queue_type || "request",
    id: requestCode,
    requestId,
    organizationId: item.organizationId || item.organization_id || organization.id || null,
    ...project,
    clientEmail: item.clientEmail || item.client_email || item.billing_email || organization.billing_email || "",
    client,
    type,
    action,
    status,
    dueAt: item.dueAt || item.due_at || null,
    dueLabel: item.dueLabel || item.due || formatDisplayDate(item.dueAt || item.due_at),
  };
}

function normalizeAdminRequest(request) {
  const status = request.status || "New";
  const project = getProjectFieldsFromRow(request);
  return {
    queueType: "request",
    id: request.request_code || request.id || "Request",
    requestId: request.id || null,
    relatedEntityType: "request",
    relatedEntityId: request.id || null,
    organizationId: request.organization_id || null,
    ...project,
    clientEmail: request.client_organizations?.billing_email || "",
    client:
      request.organization_name ||
      request.client_organizations?.name ||
      request.organization?.name ||
      request.client_organizations?.billing_email ||
      "Client workspace",
    type: request.request_type || request.request_code || "Client request",
    action: normalizeStatusValue(status) === "new" ? "Scope request" : "Review intake",
    status,
    businessGoal: request.business_goal || "",
    targetAudience: request.target_audience || "",
    attachmentDescription: request.attachment_description || "",
    creditsEstimated: request.credits_estimated ?? null,
    creditsApproved: request.credits_approved ?? null,
    dueAt: request.due_at || null,
    dueLabel: formatDisplayDate(request.due_at),
  };
}

function normalizeCustomQuoteRequest(quote) {
  return {
    queueType: "quote",
    id: quote.id || "Custom quote",
    requestId: quote.id || null,
    organizationId: quote.organization_id || null,
    clientEmail: quote.work_email || "",
    client: quote.organization_name || quote.work_email || "Custom inquiry",
    type: `Custom quote${quote.company_type ? `: ${quote.company_type}` : ""}`,
    summarySnippet: quote.request_summary || "",
    budget: quote.estimated_budget || "",
    action: "Schedule discovery",
    status: quote.status || "New",
    dueAt: quote.created_at || null,
    dueLabel: "Discovery follow up",
  };
}

function normalizePaymentOrder(order) {
  const organization = order.client_organizations || {};
  const isRescueSprint = order.product_type === "rescue_sprint";
  return {
    queueType: "payment",
    id: order.id || "Payment",
    requestId: order.id || null,
    organizationId: order.organization_id || null,
    clientEmail: organization.billing_email || "",
    client: organization.name || organization.billing_email || (isRescueSprint ? "One time client" : "Client workspace"),
    type: isRescueSprint ? "BA Rescue Sprint buyer" : productLabel(order.product_type),
    action: isRescueSprint ? "Open intake follow up" : "Review payment",
    status: order.status || "Pending",
    dueAt: order.created_at || null,
    dueLabel: isRescueSprint ? "Intake follow up" : formatDisplayDate(order.created_at),
  };
}

function normalizeNotification(notification) {
  const project = getProjectFieldsFromRow(notification);
  const relatedEntityType = notification.related_entity_type || "workspace";
  const organization = notification.client_organizations || {};
  return {
    queueType: "notification",
    id: notification.id || "Notification",
    requestId: notification.related_entity_id || notification.id || null,
    relatedEntityType,
    relatedEntityId: notification.related_entity_id || null,
    organizationId: notification.organization_id || null,
    ...project,
    clientEmail: organization.billing_email || notification.recipient_email || "",
    client: organization.name || organization.billing_email || notification.recipient_email || "Client workspace",
    type: notification.subject || notification.template_key || "Notification",
    summarySnippet: notification.failure_reason || notification.body || "",
    action: normalizeStatusValue(notification.status) === "queued" ? "Check email delivery" : "Check notification",
    status: notification.status || "Queued",
    dueAt: notification.created_at || null,
    dueLabel: notification.sent_at ? `Sent ${formatDisplayDate(notification.sent_at)}` : "Queued",
  };
}

function normalizeAdminClientMessage(message) {
  const organization = message.client_organizations || {};
  const project = getProjectFieldsFromRow(message);
  const relatedEntityType = message.request_id ? "request" : message.deliverable_id ? "deliverable" : "workspace";
  const relatedEntityId = message.request_id || message.deliverable_id || null;
  return {
    queueType: "client-message",
    id: message.id || "Client message",
    requestId: message.request_id || message.deliverable_id || message.id || null,
    deliverableId: message.deliverable_id || null,
    relatedEntityType,
    relatedEntityId,
    organizationId: message.organization_id || null,
    ...project,
    clientEmail: organization.billing_email || "",
    client: organization.name || organization.billing_email || "Client workspace",
    type: message.subject || "Client workspace message",
    body: message.body || "",
    summarySnippet: message.body || "",
    action: "Review and respond",
    status: message.status || "Received",
    dueAt: message.created_at || null,
    dueLabel: "Client message",
  };
}

function normalizeAdminClientUpload(upload) {
  const organization = upload.client_organizations || {};
  const project = getProjectFieldsFromRow(upload);
  const relatedEntityType = upload.request_id ? "request" : upload.deliverable_id ? "deliverable" : "workspace";
  const relatedEntityId = upload.request_id || upload.deliverable_id || null;
  return {
    queueType: "client-upload",
    id: upload.id || "Client upload",
    fileId: upload.id || "",
    fileKind: "client_upload",
    requestId: upload.request_id || upload.deliverable_id || upload.id || null,
    deliverableId: upload.deliverable_id || null,
    relatedEntityType,
    relatedEntityId,
    organizationId: upload.organization_id || null,
    ...project,
    clientEmail: organization.billing_email || "",
    client: organization.name || organization.billing_email || "Client workspace",
    type: upload.original_file_name || upload.upload_type || "Client upload",
    fileName: upload.original_file_name || upload.upload_type || "Client upload",
    fileSize: upload.file_size_bytes || 0,
    source: "Client upload",
    note: upload.note || "",
    action: "Review uploaded file",
    status: upload.status || "Received",
    dueAt: upload.created_at || null,
    dueLabel: upload.upload_type || "Client upload",
  };
}

function normalizeAdminRequestFile(file) {
  const organization = file.client_organizations || {};
  const request = file.requests || {};
  const project = getProjectFieldsFromRow(file);
  return {
    queueType: "request-file",
    id: file.id || "Request file",
    fileId: file.id || "",
    fileKind: "request_file",
    requestId: file.request_id || null,
    relatedEntityType: "request",
    relatedEntityId: file.request_id || null,
    organizationId: file.organization_id || null,
    ...project,
    clientEmail: organization.billing_email || "",
    client: organization.name || organization.billing_email || "Client workspace",
    fileName: file.file_name || "Request source file",
    type: file.file_name || "Request source file",
    source: "Request source",
    contextLabel: request.request_code || request.request_type || "Request source file",
    summarySnippet: request.request_type || "",
    status: "Received",
    dueAt: file.created_at || null,
    dueLabel: "Request source file",
    createdAt: file.created_at || null,
  };
}

function applyAdminQueueData(data) {
  const projectRows = data.projects || data.clientProjects || [];
  const requests = data.requests || [];
  const quoteItems = data.quotes || data.customQuoteRequests || [];
  const paymentOrders = data.paymentOrders || [];
  const queuePaymentOrders = data.queuePaymentOrders || data.visiblePaymentOrders || paymentOrders;
  const notifications = data.notifications || [];
  const clientMessages = data.clientMessages || [];
  const clientUploads = data.clientUploads || [];
  const requestFiles = data.requestFiles || [];
  const queueRequestFiles = data.queueRequestFiles || data.visibleRequestFiles || requestFiles;
  const deliverableFiles = data.deliverableFiles || [];
  const clientProfiles = data.clientProfiles || [];
  const profileByOrganization = new Map(
    clientProfiles
      .filter((profile) => profile.organization_id)
      .map((profile) => [profile.organization_id, profile])
  );
  state.adminProjects = projectRows.map(normalizeAdminProject);
  const fallbackItems = data.items || data.queue || data.adminQueue || [];
  const normalizedItems = [
    ...quoteItems.map(normalizeCustomQuoteRequest),
    ...requests.map(normalizeAdminRequest),
    ...clientMessages.map(normalizeAdminClientMessage),
    ...clientUploads.map(normalizeAdminClientUpload),
    ...queueRequestFiles.map(normalizeAdminRequestFile),
    ...queuePaymentOrders.map(normalizePaymentOrder),
    ...notifications.map(normalizeNotification),
    ...fallbackItems.map(normalizeAdminQueueItem),
  ];
  state.adminQueue = normalizedItems;
  state.adminClientUploads = clientUploads.map(normalizeAdminClientUpload);
  state.adminRequestFiles = requestFiles.map(normalizeAdminRequestFile);
  state.adminNewCount = Number(data.requestCount ?? data.request_count ?? requests.length ?? 0);
  state.quoteCount = Number(data.quoteCount ?? data.quote_count ?? quoteItems.length ?? 0);

  const creditAccountList = data.creditAccounts || [];
  const singleCreditAccount = data.creditAccount || data.credit_account || null;
  const creditAccounts = creditAccountList.length ? creditAccountList : singleCreditAccount ? [singleCreditAccount] : [];
  const adminClientMap = new Map();
  creditAccounts.forEach((account) => {
    const id = account.organization_id || "";
    const organization = account.client_organizations || {};
    const profile = profileByOrganization.get(id) || {};
    adminClientMap.set(id || `credit-${adminClientMap.size}`, {
      id,
      selectionId: id || `credit-${adminClientMap.size}`,
      name:
        account.organization_name ||
        account.client_name ||
        account.company ||
        organization.name ||
        profile.work_email ||
        "Client workspace",
      email: organization.billing_email || account.billing_email || profile.work_email || "",
      industry: organization.industry || "",
      country: organization.country || "",
      timezone: organization.timezone || "",
      firstName: profile.first_name || "",
      lastName: profile.last_name || "",
      phone: profile.phone || "",
      jobTitle: profile.job_title || "",
      department: profile.department || "",
      workingStyle: profile.preferred_working_style || "",
      primaryBusinessNeed: profile.primary_business_need || "",
      balance: Number(account.balance ?? account.credit_balance ?? 0),
      reservedBalance: Number(account.reserved_balance ?? account.reservedBalance ?? 0),
      lowCreditThreshold: Number(account.low_credit_threshold ?? account.lowCreditThreshold ?? state.creditThreshold),
      status: account.status || organization.status || "active",
      projects: state.adminProjects.filter((project) => project.organizationId === id && isActiveProject(project)),
    });
  });
  normalizedItems.forEach((item) => {
    const key = item.organizationId || item.clientEmail || item.client || `queue-${adminClientMap.size}`;
    if (adminClientMap.has(key)) return;
    adminClientMap.set(key, {
      id: item.organizationId || "",
      selectionId: item.organizationId || String(key),
      name: item.client || "Client workspace",
      email: item.clientEmail || "",
      balance: 0,
      lowCreditThreshold: state.creditThreshold,
      status: item.organizationId ? "No credit account found" : "intake follow up",
      projects: state.adminProjects.filter((project) => project.organizationId === item.organizationId && isActiveProject(project)),
    });
  });
  state.adminRequestFiles.forEach((file) => {
    const key = file.organizationId || file.clientEmail || file.client || `file-${adminClientMap.size}`;
    if (adminClientMap.has(key)) return;
    adminClientMap.set(key, {
      id: file.organizationId || "",
      selectionId: file.organizationId || String(key),
      name: file.client || "Client workspace",
      email: file.clientEmail || "",
      balance: 0,
      lowCreditThreshold: state.creditThreshold,
      status: file.organizationId ? "No credit account found" : "active",
      projects: state.adminProjects.filter((project) => project.organizationId === file.organizationId && isActiveProject(project)),
    });
  });
  (data.deliverables || []).forEach((deliverable) => {
    const key = deliverable.organization_id || `deliverable-${adminClientMap.size}`;
    if (!deliverable.organization_id || adminClientMap.has(key)) return;
    adminClientMap.set(key, {
      id: deliverable.organization_id,
      selectionId: deliverable.organization_id,
      name: "Client workspace",
      email: "",
      balance: 0,
      lowCreditThreshold: state.creditThreshold,
      status: "No credit account found",
      projects: state.adminProjects.filter((project) => project.organizationId === deliverable.organization_id && isActiveProject(project)),
    });
  });
  clientProfiles.forEach((profile) => {
    const id = profile.organization_id || "";
    if (!id || adminClientMap.has(id)) return;
    const organization = profile.client_organizations || {};
    adminClientMap.set(id, {
      id,
      selectionId: id,
      name: organization.name || profile.work_email || "Client workspace",
      email: organization.billing_email || profile.work_email || "",
      industry: organization.industry || "",
      country: organization.country || "",
      timezone: organization.timezone || "",
      firstName: profile.first_name || "",
      lastName: profile.last_name || "",
      phone: profile.phone || "",
      jobTitle: profile.job_title || "",
      department: profile.department || "",
      workingStyle: profile.preferred_working_style || "",
      primaryBusinessNeed: profile.primary_business_need || "",
      balance: 0,
      lowCreditThreshold: state.creditThreshold,
      status: organization.status || "active",
      projects: state.adminProjects.filter((project) => project.organizationId === id && isActiveProject(project)),
    });
  });
  state.adminClients = Array.from(adminClientMap.values()).map((client) => ({
    ...client,
    projects: client.projects?.length ? client.projects : state.adminProjects.filter((project) => project.organizationId === client.id && isActiveProject(project)),
  }));
  if (state.selectedAdminClientId) {
    const stillValid = state.adminClients.some(
      (client) => client.selectionId === state.selectedAdminClientId || client.id === state.selectedAdminClientId
    );
    if (!stillValid) {
      state.selectedAdminClientId = "";
      state.selectedAdminProjectId = "";
    }
  }
  syncSelectedAdminProjectToClient();

  if (creditAccounts.length && state.selectedAdminClientId) {
    const creditAccount =
      creditAccounts.find((account) => account.organization_id === state.selectedAdminClientId) ||
      creditAccounts.find((account) => account.id === state.selectedAdminClientId);
    if (creditAccount) {
      state.creditsLeft = Number(creditAccount.balance ?? state.creditsLeft);
      state.reservedCredits = Number(creditAccount.reserved_balance ?? creditAccount.reservedBalance ?? 0);
      state.creditThreshold = Number(creditAccount.low_credit_threshold ?? creditAccount.lowCreditThreshold ?? state.creditThreshold);
    }
  }

  const paymentHistory = data.paymentHistory || data.payments || paymentOrders || [];
  state.adminPaymentHistory = paymentHistory.slice(0, 30).map((payment) => ({
    organizationId: payment.organization_id || payment.organizationId || null,
    rawDate: payment.paid_at || payment.created_at || payment.date || null,
    date: formatDisplayDate(payment.paid_at || payment.created_at || payment.date),
    item: payment.item || productLabel(payment.product_type) || payment.description || "Payment",
    amount: payment.amount || payment.amount_display || payment.total || formatUsdFromCents(payment.amount_cents, payment.currency),
    status: payment.status || "Recorded",
  }));

  const creditLedger = data.creditLedger || data.creditHistory || data.ledger || [];
  state.adminCreditLedger = creditLedger.slice(0, 30).map((entry) => ({
    organizationId: entry.organization_id || entry.organizationId || null,
    ...getProjectFieldsFromRow(entry),
    rawDate: entry.created_at || entry.date || null,
    date: formatDisplayDate(entry.created_at || entry.date),
    deliverable: entry.deliverable || entry.action || entry.reason || entry.entry_reason || entry.entry_type || "Credit activity",
    credits: entry.credits ?? entry.delta ?? entry.credit_delta ?? "Recorded",
    balance: entry.balance ?? entry.balance_after ?? state.creditsLeft,
  }));

  const auditEvents = data.auditEvents || [];
  state.adminAuditEvents = auditEvents.slice(0, 30).map((entry) => ({
    organizationId: entry.organization_id || null,
    ...getProjectFieldsFromRow(entry),
    date: formatDisplayDate(entry.created_at),
    event: entry.event || entry.event_type || "Audit event",
    client: entry.client_organizations?.name || entry.client_organizations?.billing_email || "Client workspace",
    details: getAuditDetailText(entry.details || entry.event_detail),
  }));

  if (data.client) {
    state.client.company = data.client.company || data.client.name || state.client.company;
    state.client.email = data.client.email || state.client.email;
  }

  const deliverableRows = data.deliverables || [];
  state.adminDeliverables = deliverableRows.map((deliverable) => ({
    id: deliverable.id || deliverable.deliverable_id,
    organizationId: deliverable.organization_id,
    requestId: deliverable.request_id,
    ...getProjectFieldsFromRow(deliverable),
    title: deliverable.title || "Client deliverable",
    type: deliverable.deliverable_type || "Business Analysis deliverable",
    status: deliverable.status || "Ready",
    currentVersion: deliverable.current_version_number || deliverable.version_number || 1,
    createdAt: deliverable.created_at || null,
    updatedAt: deliverable.updated_at || null,
  }));
  state.adminDeliverableFiles = deliverableFiles.map((file) => ({
    fileId: file.id || "",
    deliverableId: file.deliverable_id || "",
    organizationId: file.organization_id || "",
    ...getProjectFieldsFromRow(file),
    versionId: file.deliverable_version_id || "",
    versionNumber: file.deliverable_versions?.version_number || "",
    status: file.deliverable_versions?.status || "",
    releaseNote: file.deliverable_versions?.release_note || "",
    fileName: file.file_name || "Deliverable file",
    fileSize: file.file_size_bytes || 0,
    createdAt: file.created_at || file.deliverable_versions?.released_at || null,
  }));
}

async function loadAdminQueue() {
  if (!supabaseClient || !(await ensureAdminAccess())) return;

  setAdminStatus("Loading admin queue.");
  const result = await fetchAdminApi("/api/admin-queue?limit=250");

  if (!result.ok) {
    setAdminStatus(result.error || "Admin queue could not be loaded.");
    showToast("Admin queue could not be loaded. Please try again.");
    return;
  }

  applyAdminQueueData(result.data || {});
  setAdminStatus(state.adminQueue.length ? "Admin queue is current." : "No admin items need review.");
  render();
}

const countries = [
  "Canada",
  "United States",
  "United Kingdom",
  "Australia",
  "India",
  "United Arab Emirates",
  "Singapore",
  "Germany",
  "France",
  "Netherlands",
  "Ireland",
  "New Zealand",
  "South Africa",
  "Japan",
  "Other",
];

function populateCountries() {
  document.querySelectorAll("[data-country-select]").forEach((select) => {
    select.innerHTML = `<option value="">Select country</option>${countries.map((country) => `<option>${country}</option>`).join("")}`;
    select.value = "";
  });
}

function setupOAuthButtons() {
  const enabledProviders = config.authProviders || {};
  const enabledProviderCount = ["google", "apple"].filter((provider) => enabledProviders[provider] !== false).length;
  document.querySelectorAll("[data-provider]").forEach((button) => {
    button.type = "button";
    const label = button.querySelector(".sso-label");
    if (label) {
      label.textContent = `Continue with ${getProviderName(button.dataset.provider)}`;
    }
    button.classList.toggle("hidden", enabledProviders[button.dataset.provider] === false);
  });
  document.querySelector(".sso-actions")?.classList.toggle("hidden", enabledProviderCount === 0);
  document.querySelector(".auth-divider")?.classList.toggle("hidden", enabledProviderCount === 0);
}

function rememberClientLoginFields() {
  const email = document.querySelector("#loginEmail")?.value || state.client.email || getUserEmail();
  const company = document.querySelector("#loginCompany")?.value || state.client.company || "Your organization";
  state.client = { email, company };
  saveState();
}

async function signInWithOAuthProvider(provider) {
  if ((config.authProviders || {})[provider] === false) {
    showToast("This sign in option is not available yet. Please use another sign in option.");
    return;
  }

  if (state.session?.user) {
    window.location.hash = (await ensureAdminAccess()) ? "admin" : "dashboard";
    return;
  }

  rememberClientLoginFields();

  if (!supabaseClient) {
    showToast(`Secure sign in is temporarily unavailable. Please contact ${config.supportEmail}.`);
    return;
  }

  setPendingPostAuthRoute(getPendingPostAuthRoute() || "dashboard");

  const options = {
    redirectTo: getAuthRedirectUrl(),
  };

  if (provider === "google") {
    options.queryParams = {
      prompt: "select_account",
    };
  }

  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider,
    options,
  });

  if (error) {
    showToast(`${getProviderName(provider)} sign in could not be started: ${error.message}`);
    setAuthStatus(`${getProviderName(provider)} sign in could not be started.`);
  }
}

async function createPasswordAccount() {
  const email = getNormalizedEmail(document.querySelector("#passwordSignupEmail")?.value);
  const company = document.querySelector("#passwordSignupCompany")?.value.trim();
  const password = document.querySelector("#passwordSignupPassword")?.value || "";
  const confirm = document.querySelector("#passwordSignupConfirm")?.value || "";
  const validationError = validatePasswordPair(password, confirm);

  if (!email || !company) {
    return { ok: false, error: "Please enter your work email and company name." };
  }
  if (validationError) {
    return { ok: false, error: validationError };
  }
  if (!supabaseClient) {
    return { ok: false, error: `Secure account creation is temporarily unavailable. Please contact ${config.supportEmail}.` };
  }

  state.client.email = email;
  state.client.company = company;
  setFieldValue("#profileEmail", email);
  setFieldValue("#profileCompany", company);
  setPendingPostAuthRoute("profile");
  saveState();

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getAuthRedirectUrl(),
      data: { company },
    },
  });

  if (error) {
    return { ok: false, error: getFriendlyAuthError(error, "Account could not be created.") };
  }

  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return {
      ok: false,
      error: "An account may already exist for this email. Please sign in or reset your password.",
    };
  }

  if (data?.session) {
    state.session = data.session;
    await loadSignedInProfile();
    updateAuthUi();
    if (!isEmailVerified()) {
      window.location.hash = "login";
      return { ok: true, message: "Account created. Please verify your email before opening the client workspace." };
    }
    window.location.hash = "profile";
    return { ok: true, message: "Account created. Please complete your client profile." };
  }

  return {
    ok: true,
    message: "Please check your email to verify your account. If an account already exists for this email, sign in or reset your password.",
  };
}

async function signInWithPassword() {
  const email = getNormalizedEmail(document.querySelector("#passwordLoginEmail")?.value);
  const password = document.querySelector("#passwordLoginPassword")?.value || "";

  if (!email || !password) {
    return { ok: false, error: "Please enter your email and password." };
  }
  if (!supabaseClient) {
    return { ok: false, error: `Secure sign in is temporarily unavailable. Please contact ${config.supportEmail}.` };
  }

  state.client.email = email;
  if (!getPendingPostAuthRoute()) {
    setPendingPostAuthRoute(window.location.hash.replace("#", "") === "checkout-success" ? "checkout-success" : "dashboard");
  }
  saveState();

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    return { ok: false, error: getFriendlyAuthError(error, "Sign in could not be completed.") };
  }

  state.session = data.session;
  await loadSignedInProfile();
  await loadClientWorkspaceData();
  const isAdmin = await refreshAdminStatus(true);
  updateAuthUi();
  if (!isEmailVerified()) {
    window.location.hash = "login";
    return { ok: false, error: "Please verify your email before opening the client workspace." };
  }
  const organizationId = await getProfileOrganizationId();
  if (!isAdmin) {
    await routeAfterAuth(organizationId ? "dashboard" : "profile");
  } else {
    window.location.hash = "admin";
  }
  return { ok: true, message: isAdmin ? "Signed in. Admin access is available." : "Signed in. Your workspace is ready." };
}

async function sendPasswordResetInstructions() {
  const email = getNormalizedEmail(document.querySelector("#passwordResetEmail")?.value || document.querySelector("#passwordLoginEmail")?.value);
  if (!email) {
    return { ok: false, error: "Please enter your work email." };
  }
  if (!supabaseClient) {
    return { ok: false, error: `Password reset is temporarily unavailable. Please contact ${config.supportEmail}.` };
  }

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: getAuthRedirectUrl(),
  });

  if (error) {
    return { ok: false, error: getFriendlyAuthError(error, "Password reset instructions could not be sent.") };
  }

  return { ok: true, message: "If a client account exists for that email, reset instructions will arrive shortly." };
}

async function resendVerificationInstructions() {
  const email = getNormalizedEmail(document.querySelector("#passwordSignupEmail")?.value || document.querySelector("#passwordLoginEmail")?.value);
  if (!email) {
    return { ok: false, error: "Please enter your work email first." };
  }
  if (!supabaseClient) {
    return { ok: false, error: `Verification email is temporarily unavailable. Please contact ${config.supportEmail}.` };
  }

  const { error } = await supabaseClient.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo: getAuthRedirectUrl(),
    },
  });

  if (error) {
    return { ok: false, error: getFriendlyAuthError(error, "Verification email could not be sent.") };
  }

  return { ok: true, message: "If this email is waiting for verification, a new verification email will arrive shortly." };
}

async function updateSignedInPassword(password, confirm) {
  const validationError = validatePasswordPair(password, confirm);
  if (validationError) {
    return { ok: false, error: validationError };
  }
  if (!state.session?.user) {
    return { ok: false, error: "Please sign in before updating your password." };
  }
  if (getAuthProvider() !== "email") {
    return { ok: false, error: "Password updates are available for email and password accounts. Password changes for external sign in accounts are handled in those accounts." };
  }
  if (!supabaseClient) {
    return { ok: false, error: `Password update is temporarily unavailable. Please contact ${config.supportEmail}.` };
  }

  const { error } = await supabaseClient.auth.updateUser({ password });
  if (error) {
    return { ok: false, error: getFriendlyAuthError(error, "Password could not be updated.") };
  }

  state.passwordRecovery = false;
  clearSensitiveAuthFields();
  updateAuthUi();
  return { ok: true, message: "Password updated." };
}

async function markDeliverableAccepted(deliverableId) {
  if (!deliverableId) return { ok: false, error: "Select a deliverable first." };
  const deliverable = state.deliverables.find((item) => item.id === deliverableId);
  if (!deliverable) return { ok: false, error: "Deliverable could not be found in this workspace." };

  const note = "Client reviewed and accepted this deliverable.";
  if (supabaseClient && getUserId()) {
    const { error: messageError } = await supabaseClient.from("client_deliverable_messages").insert({
      organization_id: state.profileOrganizationId || (await getProfileOrganizationId()),
      project_id: deliverable.projectId || deliverable.project_id || "",
      deliverable_id: deliverableId,
      submitted_by: getUserId(),
      subject: "Deliverable accepted",
      body: note,
      status: "accepted",
    });
    if (messageError) {
      return { ok: false, error: messageError.message || "Acceptance could not be recorded." };
    }
  }

  deliverable.verificationStatus = "Accepted";
  addAuditEvent("Deliverable accepted", `${deliverable.title} accepted by client.`);
  saveState();
  notifyAdvisorEventInBackground({
    eventType: "deliverable_accepted",
    title: "Deliverable accepted",
    summary: `${deliverable.title} was marked reviewed and accepted by the client.`,
    relatedEntityType: "deliverable",
    relatedEntityId: deliverableId,
    relatedLabel: deliverable.title,
  });
  render();
  return { ok: true };
}

function toggleOther(selectId, wrapperId) {
  const select = document.querySelector(selectId);
  const wrapper = document.querySelector(wrapperId);
  if (!select || !wrapper) return;
  wrapper.classList.toggle("hidden", select.value !== "Other");
}

const checkoutProductMap = {
  rescueSprint: "rescue_sprint",
  starterMonthly: "starter_monthly",
  creditTopUp: "credit_top_up",
};

async function fetchPublicApi(path, options = {}) {
  try {
    const response = await fetch(path, {
      method: options.method || "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options.body || {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: data.error || "Request could not be completed." };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function requireClientWorkspaceForCheckout() {
  if (!state.session?.user) {
    window.location.hash = "login";
    showPersistentNotice("Please use Client Login before purchasing. This keeps your payment, profile, files, requests, messages, and deliverables connected to one secure workspace.");
    return null;
  }

  if (!isEmailVerified()) {
    window.location.hash = "login";
    showPersistentNotice("Please verify your email before checkout. This protects your payment, files, and workspace access.");
    return null;
  }

  const organizationId = await getProfileOrganizationId();
  if (!organizationId) {
    window.location.hash = "profile";
    showPersistentNotice("Please complete your workspace profile before checkout. This lets us attach your purchase to the right client account and delivery history.");
    return null;
  }

  return organizationId;
}

async function openConfiguredCheckout(linkKey, fallbackMessage, options = {}) {
  const productType = checkoutProductMap[linkKey];
  const organizationId = options.requireWorkspace ? await requireClientWorkspaceForCheckout() : null;

  if (options.requireWorkspace && !organizationId) {
    return false;
  }

  if (productType) {
    try {
      const accessToken = await getSessionAccessToken();
      const response = await fetchWithTimeout("/api/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          productType,
          email: state.client.email,
          organizationId,
        }),
      }, 20000, "Checkout took too long to open. Please try again.");
      const data = await response.json();
      if (response.ok && data.url) {
        clearPendingCheckoutType();
        window.location.href = data.url;
        return true;
      }
      if (!response.ok) {
        const message = data.error || `${fallbackMessage} Please try again or contact ${config.supportEmail}.`;
        showPersistentNotice(message);
        return false;
      }
    } catch (error) {
      // Static local previews do not have API routes. The user sees the friendly fallback below.
    }
  }

  const paymentLink = config.stripePaymentLinks[linkKey];
  const priceId = config.stripePrices[linkKey];

  if (paymentLink) {
    if (options.requireWorkspace) {
      showPersistentNotice(`${fallbackMessage} Please try again in a moment or contact ${config.supportEmail}. Your selected service is saved to this workspace.`);
      return false;
    }
    clearPendingCheckoutType();
    window.location.href = paymentLink;
    return true;
  }

  showToast(`${fallbackMessage} If checkout does not open, contact ${config.supportEmail}. Reference: ${priceId || "pending"}.`);
  return false;
}

async function resumePendingCheckout() {
  const pendingType = getPendingCheckoutType();
  if (!pendingType) return false;
  const organizationId = await getProfileOrganizationId();
  if (!state.session?.user || !organizationId || !isEmailVerified()) return false;
  showPersistentNotice("Your client workspace is ready. Secure checkout is opening now.");
  await beginCheckout(pendingType, { fromResume: true });
  return true;
}

async function beginCheckout(type, options = {}) {
  if (!options.fromResume) {
    setPendingCheckoutType(type);
  }

  if (type === "manage-billing") {
    clearPendingCheckoutType();
    const organizationId = await requireClientWorkspaceForCheckout();
    if (!organizationId) return;
    const status = document.querySelector("#billingManageStatus");
    if (status) status.textContent = "Opening secure subscription management.";
    try {
      const accessToken = await getSessionAccessToken();
      const response = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          action: "customer_portal",
          organizationId,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      const message = data.error || "Subscription management is not available yet for this workspace. Contact support if you need to cancel or change billing.";
      if (status) status.textContent = message;
      showPersistentNotice(message);
    } catch (_error) {
      const message = `Subscription management could not be opened. Please contact ${config.supportEmail} for billing changes.`;
      if (status) status.textContent = message;
      showPersistentNotice(message);
    }
    return;
  }

  if (type === "buy-sprint") {
    addAuditEvent("Checkout started", "BA Rescue Sprint checkout opened.");
    saveState();
    await openConfiguredCheckout("rescueSprint", "Secure checkout is being prepared for BA Rescue Sprint.", {
      requireWorkspace: true,
    });
  }

  if (type === "buy-starter") {
    addAuditEvent("Checkout started", "Starter subscription checkout opened.");
    saveState();
    await openConfiguredCheckout("starterMonthly", "Secure checkout is being prepared for Starter at $2,500 per month.", {
      requireWorkspace: true,
    });
  }

  if (type === "buy-topup") {
    addAuditEvent("Checkout started", "3 Advisory Credit top up checkout opened.");
    saveState();
    const openedCheckout = await openConfiguredCheckout("creditTopUp", "Secure checkout is being prepared for the 3 credit top up.", {
      requireWorkspace: true,
    });
    if (openedCheckout) return;
  }
}

document.addEventListener("click", (event) => {
  const signOutTarget = event.target.closest("[data-sign-out]");
  if (signOutTarget) {
    signOutCurrentUser(event);
    return;
  }

  const navToggle = event.target.closest("[data-nav-toggle]");
  if (navToggle) {
    event.preventDefault();
    const menu = navToggle.closest("[data-nav-menu]");
    const willOpen = !menu?.classList.contains("open");
    closeNavigationMenus();
    if (menu && willOpen) {
      menu.classList.add("open");
      navToggle.setAttribute("aria-expanded", "true");
    }
    return;
  }

  const routeLink = event.target.closest('a[href^="#"]');
  if (routeLink && !routeLink.dataset.action && !routeLink.dataset.mailto) {
    const route = routeLink.getAttribute("href").replace("#", "") || "home";
    closeNavigationMenus();
    if ((window.location.hash.replace("#", "") || "home") === route) {
      event.preventDefault();
      setView();
    }
    return;
  }

  const target = event.target.closest("[data-action]");
  if (!target) return;
  event.preventDefault();
  beginCheckout(target.dataset.action);
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("[data-nav-menu]")) {
    closeNavigationMenus();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeNavigationMenus();
    hideToast();
  }
});

document.querySelector("#toastClose")?.addEventListener("click", hideToast);

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-mailto]");
  if (!target) return;
  event.preventDefault();
  const mailtoUrl = target.getAttribute("href") || `mailto:${config.supportEmail}`;
  window.location.href = mailtoUrl;
  setTimeout(() => {
    showToast(`Email client opened. If nothing opens, email ${config.supportEmail}.`);
  }, 250);
});

document.addEventListener("change", (event) => {
  if (event.target.id === "adminClientSelect" || event.target.id === "adminUploadClientSelect") {
    state.selectedAdminClientId = event.target.value;
    state.adminUploadProjectId = null;
    syncSelectedAdminClientToState();
    saveState();
    render();
  }
  if (event.target.id === "adminProjectFilter") {
    state.selectedAdminProjectId = event.target.value || "";
    saveState();
    render();
  }
  if (event.target.id === "adminUploadProjectSelect") {
    state.adminUploadProjectId = event.target.value || "";
    renderCreditControls();
    updateAdminReleaseReadiness();
  }
  if (event.target.id === "adminUploadRequestSelect") {
    const request = state.adminQueue.find((item) => item.queueType === "request" && (item.requestId === event.target.value || item.id === event.target.value));
    if (request?.projectId) {
      const projectSelect = document.querySelector("#adminUploadProjectSelect");
      if (projectSelect) projectSelect.value = request.projectId;
      state.adminUploadProjectId = request.projectId;
      renderCreditControls();
      updateAdminReleaseReadiness();
    }
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-admin-action]");
  if (!target) return;
  const lockedAdminActions = new Set(["save-credit-settings", "ship-deliverable", "upload-deliverable", "send-client-message", "mark-queue-item"]);
  const shouldLockAction = lockedAdminActions.has(target.dataset.adminAction);
  if (shouldLockAction && target.dataset.busy === "true") return;
  if (shouldLockAction) {
    target.dataset.busy = "true";
    target.disabled = true;
  }

  try {

  if (target.dataset.adminAction === "jump-admin-section") {
    const previousQueueFocus = state.adminQueueFocus;
    state.adminQueueFocus = target.dataset.queueFilter || "";
    if (state.adminQueueFocus || previousQueueFocus) renderRequests();
    const targetId = target.dataset.targetId;
    if (targetId) scrollToAdminSection(targetId);
    return;
  }

  if (target.dataset.adminAction === "open-message-client") {
    if (!(await ensureAdminAccess())) {
      showToast("Please sign in with the administrator email before messaging clients.");
      return;
    }
    const queueItem = target.dataset.queueKey ? getAdminQueueItemByKey(target.dataset.queueKey) : null;
    openAdminMessageComposer(queueItem);
    return;
  }

  if (target.dataset.adminAction === "close-message-client") {
    closeAdminMessageComposer();
    return;
  }

  if (target.dataset.adminAction === "send-client-message") {
    await sendAdminClientMessage();
    return;
  }

  if (target.dataset.adminAction === "mark-queue-item") {
    const queueItem = getAdminQueueItemByKey(target.dataset.queueKey || "");
    await markAdminQueueItem(queueItem, target.dataset.queueStatusAction || "addressed");
    return;
  }

  if (target.dataset.adminAction === "select-client") {
    const selectionId = target.dataset.clientSelection || "";
    if (!selectionId) {
      showToast("Client workspace could not be selected.");
      return;
    }
    state.selectedAdminClientId = selectionId;
    state.adminUploadProjectId = null;
    state.adminQueueFocus = "";
    syncSelectedAdminClientToState();
    syncSelectedAdminProjectToClient();
    saveState();
    render();
    showToast("Client file opened.");
    return;
  }

  if (target.dataset.adminAction === "focus-upload" || target.dataset.adminAction === "prepare-upload") {
    if (!(await ensureAdminAccess())) {
      showToast("Please sign in with the administrator email before uploading deliverables.");
      return;
    }
    const organizationId = target.dataset.organizationId || getSelectedAdminClient().id || "";
    const requestId = target.dataset.requestId || "";
    const projectId = target.dataset.projectId || "";
    if (!organizationId) {
      showToast("Select a client before uploading a deliverable.");
      return;
    }
    if (organizationId) {
      state.selectedAdminClientId = organizationId;
      if (projectId) state.selectedAdminProjectId = projectId;
      syncSelectedAdminClientToState();
      render();
    }
    const uploadClientSelect = document.querySelector("#adminUploadClientSelect");
    const uploadRequestSelect = document.querySelector("#adminUploadRequestSelect");
    const uploadProjectSelect = document.querySelector("#adminUploadProjectSelect");
    if (uploadClientSelect && organizationId) uploadClientSelect.value = organizationId;
    if (uploadProjectSelect && projectId) uploadProjectSelect.value = projectId;
    if (uploadRequestSelect && requestId) uploadRequestSelect.value = requestId;
    document.querySelector("#adminDeliverableTitle")?.focus();
    document.querySelector("#adminDeliverableTitle")?.closest(".panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    showToast(organizationId ? "Upload panel is ready for the selected client." : "Create or select a client workspace before uploading a deliverable.");
    return;
  }

  if (target.dataset.adminAction === "save-credit-settings") {
    if (!(await ensureAdminAccess())) {
      showToast("Please sign in with the administrator email before saving.");
      return;
    }

    const selectedClient = getSelectedAdminClient();
    if (!selectedClient.id) {
      showToast("Select a client before changing credits.");
      return;
    }

    const balance = Math.max(0, Number(document.querySelector("#adminCreditBalance").value || 0));
    const lowCreditThreshold = Math.max(0, Number(document.querySelector("#adminLowCreditThreshold").value || 0));
    const adjustment = Number(document.querySelector("#adminCreditAdjustment").value || 0);
    const reason = document.querySelector("#adminCreditAdjustmentReason").value.trim();
    const currentBalance = Number(selectedClient.balance ?? state.creditsLeft);
    const currentThreshold = Number(selectedClient.lowCreditThreshold ?? state.creditThreshold);
    const balanceEdited = balance !== currentBalance;
    if (balanceEdited && adjustment !== 0) {
      showPersistentNotice("Use either Remaining Advisory Credits or Manual credit adjustment, not both in the same save.");
      return;
    }
    const targetBalance = Math.max(0, adjustment !== 0 ? currentBalance + adjustment : balance);
    const ledgerAdjustment = targetBalance - currentBalance;
    const thresholdChanged = lowCreditThreshold !== currentThreshold;
    if (ledgerAdjustment !== 0 && !reason) {
      showToast("Add a reason before saving a credit adjustment.");
      return;
    }

    if (selectedClient.id && (ledgerAdjustment !== 0 || thresholdChanged)) {
      const result = await updateServerCreditLedger({
        organizationId: selectedClient.id,
        type: "adjust",
        credits: ledgerAdjustment,
        reason: reason || "Credit account update",
        lowCreditThreshold,
        recipientEmail: getClientEmail(selectedClient),
        idempotencyKey: `admin-credit-${selectedClient.id}-${Date.now()}`,
      });

      if (!result.ok) {
        showToast(result.error || "Credit account could not be updated.");
        return;
      }

      state.creditsLeft = Number(result.data.balance ?? targetBalance);
    } else {
      state.creditsLeft = targetBalance;
    }

    state.creditThreshold = lowCreditThreshold;
    if (ledgerAdjustment !== 0) {
      addCreditHistory(reason || "Credit account update", `${ledgerAdjustment > 0 ? "+" : ""}${ledgerAdjustment} manual adjustment`, state.creditsLeft);
      addAuditEvent("Manual credit adjustment", `${reason}. Balance is now ${state.creditsLeft}.`);
    } else {
      addCreditHistory("Credit account update", "Balance reviewed", state.creditsLeft);
      addAuditEvent("Credit settings updated", `Balance set to ${state.creditsLeft}. Low credit threshold set to ${state.creditThreshold}.`);
    }
    updateSelectedAdminClientCreditAccount(state.creditsLeft, state.creditThreshold);
    document.querySelector("#adminCreditAdjustment").value = 0;
    document.querySelector("#adminCreditAdjustmentReason").value = "";
    saveState();
    render();
    showToast("Credit account updated.");
  }

  if (target.dataset.adminAction === "ship-deliverable") {
    const requestId = document.querySelector("#adminDeliverableSelect").value;
    const status = document.querySelector("#adminDeliverableStatus").value;
    const approvedCredits = Math.max(0, Number(document.querySelector("#adminCreditsUsed").value || 0));
    const selectedClient = getSelectedAdminClient();
    const selectedProject = getSelectedAdminProject();
    const adminItem = state.adminQueue.find(
      (item) =>
        item.queueType === "request" &&
        isSelectedAdminScopedRecord(item, selectedClient, selectedProject) &&
        (item.requestId === requestId || item.id === requestId)
    );
    const request = state.requests.find((item) => item.id === requestId);
    if (!selectedClient.id) {
      showToast("Select a client before updating a request.");
      return;
    }

    if (!request && !adminItem) {
      showToast("Select a client request before saving.");
      return;
    }

    if (!(await ensureAdminAccess())) {
      showToast("Please sign in with the administrator email before saving.");
      return;
    }

    const displayStatus = status === "Delivered" || status === "Completed" || status === "Completed and shipped" ? "Complete" : status;
    if (adminItem?.requestId && adminItem?.organizationId) {
      const statusUpdate = await fetchAdminApi("/api/admin-queue", {
        method: "POST",
        body: {
          queueType: "request-status",
          id: adminItem.requestId,
          organizationId: adminItem.organizationId,
          projectId: getAdminProjectIdForApi(adminItem.projectId || selectedProject?.id || ""),
          status: toRequestStorageStatus(displayStatus),
          creditsApproved: approvedCredits > 0 ? approvedCredits : null,
          shipped: isShippedStatus(displayStatus),
        },
      });

      if (!statusUpdate.ok) {
        showToast(statusUpdate.error || "Request status could not be saved.");
        return;
      }
    }

    if (request) {
      request.status = displayStatus;
    }
    if (adminItem) {
      adminItem.status = displayStatus;
      adminItem.creditsApproved = approvedCredits > 0 ? approvedCredits : null;
    }
    updateSelectedAdminClientCreditAccount(state.creditsLeft, state.creditThreshold);
    addAuditEvent("Request status updated", `${request?.id || adminItem.id} set to ${status}. Approved credits: ${approvedCredits}.`);
    saveState();
    render();
    showToast("Request status updated.");
  }

  if (target.dataset.adminAction === "upload-deliverable") {
    if (!validateAdminReleaseForm()) {
      return;
    }
    setAdminReleaseStatus("Uploading deliverable files and preparing the client release.");

    const result = await uploadAdminDeliverable();
    if (!result.ok) {
      setAdminReleaseStatus(result.error || "Deliverable could not be uploaded.", "warning");
      showToast(result.error || "Deliverable could not be uploaded.");
      return;
    }

    const fileText = `${result.uploaded} file${result.uploaded === 1 ? "" : "s"} released`;
    const creditText = result.creditsUsed > 0 ? ` ${result.creditsUsed} Advisory Credit${result.creditsUsed === 1 ? "" : "s"} recorded.` : " No Advisory Credits were recorded for this release.";
    let releaseStatusText = "";
    let releaseStatusLevel = "success";
    if (!result.notificationRequested) {
      releaseStatusText = `Deliverable uploaded. ${fileText}.${creditText} Client notification was not selected.`;
    } else if (result.notificationSent) {
      releaseStatusText = `Deliverable uploaded. ${fileText}.${creditText} Client notification sent.`;
    } else if (result.notificationQueued) {
      releaseStatusText = `Deliverable uploaded. ${fileText}.${creditText} Client notification is queued and needs email service review.`;
      releaseStatusLevel = "warning";
    } else {
      releaseStatusText = `Deliverable uploaded. ${fileText}.${creditText} Client notification needs review.`;
      releaseStatusLevel = "warning";
    }

    const fileInput = document.querySelector("#adminDeliverableFiles");
    const fileList = document.querySelector("#adminDeliverableFileList");
    if (fileInput) fileInput.value = "";
    if (fileList) fileList.textContent = "No deliverable files selected yet.";
    await loadAdminQueue();
    saveState();
    render();
    setAdminReleaseStatus(releaseStatusText, releaseStatusLevel);
    showToast("Deliverable uploaded to the client workspace.");
  }
  } catch (error) {
    const message = error?.message || "The admin action could not be completed.";
    if (target.dataset.adminAction === "upload-deliverable") {
      setAdminReleaseStatus(message, "warning");
    }
    showToast(message);
  } finally {
    if (shouldLockAction) {
      target.dataset.busy = "false";
      target.disabled = false;
    }
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-provider]");
  if (!target) return;
  event.preventDefault();
  await signInWithOAuthProvider(target.dataset.provider);
});

document.querySelector("#passwordSignUpForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    const result = await createPasswordAccount();
    if (!result.ok) {
      showPersistentNotice(result.error || "Account could not be created.");
      setAuthStatus(result.error || "Account could not be created.");
      return;
    }
    clearSensitiveAuthFields();
    showPersistentNotice(result.message);
    setAuthStatus(result.message);
    render();
  } finally {
    clearSensitiveAuthFields();
    if (button) button.disabled = false;
  }
});

document.querySelector("#passwordSignInForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    const result = await signInWithPassword();
    if (!result.ok) {
      showPersistentNotice(result.error || "Sign in could not be completed.");
      setAuthStatus(result.error || "Sign in could not be completed.");
      return;
    }
    clearSensitiveAuthFields();
    showToast(result.message);
    render();
  } finally {
    clearSensitiveAuthFields();
    if (button) button.disabled = false;
  }
});

document.querySelector("#showResetPassword")?.addEventListener("click", () => {
  const resetForm = document.querySelector("#passwordResetForm");
  resetForm?.classList.toggle("hidden");
  const typedEmail = document.querySelector("#passwordLoginEmail")?.value;
  if (typedEmail) syncAuthEmailFields(typedEmail);
  setAuthStatus("Enter your work email and request secure reset instructions.");
});

document.querySelector("#passwordResetForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    const result = await sendPasswordResetInstructions();
    if (!result.ok) {
      showPersistentNotice(result.error || "Password reset instructions could not be sent.");
      setAuthStatus(result.error || "Password reset instructions could not be sent.");
      return;
    }
    showPersistentNotice(result.message);
    setAuthStatus(result.message);
  } finally {
    clearSensitiveAuthFields();
    if (button) button.disabled = false;
  }
});

document.querySelector("#passwordRecoveryForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    const result = await updateSignedInPassword(
      document.querySelector("#passwordRecoveryNew")?.value || "",
      document.querySelector("#passwordRecoveryConfirm")?.value || ""
    );
    if (!result.ok) {
      showPersistentNotice(result.error || "Password could not be updated.");
      setAuthStatus(result.error || "Password could not be updated.");
      return;
    }
    clearSensitiveAuthFields();
    showPersistentNotice(result.message);
    setAuthStatus(result.message);
    await loadSignedInProfile();
    await loadClientWorkspaceData();
    await routeAfterAuth();
    render();
  } finally {
    clearSensitiveAuthFields();
    if (button) button.disabled = false;
  }
});

document.querySelector("#resendVerificationEmail")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await resendVerificationInstructions();
    showPersistentNotice(result.ok ? result.message : result.error);
    setAuthStatus(result.ok ? result.message : result.error);
  } finally {
    button.disabled = false;
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-download-file]");
  if (!target) return;
  event.preventDefault();

  const fileId = target.dataset.downloadFile;
  if (!fileId) {
    showToast("This file is not ready for download yet.");
    return;
  }

  target.disabled = true;
  target.textContent = "Preparing";

  const result = await fetchClientApi("/api/deliverable-download-url", {
    method: "POST",
    body: {
      fileId,
      organizationId: target.dataset.organizationId || (isAdminUser() ? state.selectedAdminClientId : state.profileOrganizationId || undefined),
      projectId: target.dataset.projectId || (isAdminUser() ? getAdminProjectIdForApi() : state.selectedProjectId || undefined),
    },
  });

  if (!result.ok || !result.data?.signedUrl) {
    showToast(result.error || "Download link could not be created.");
    target.disabled = false;
    target.textContent = "Download";
    return;
  }

  triggerSecureDownload(result.data.signedUrl, result.data.fileName || target.textContent || "deliverable-file");
  target.disabled = false;
  target.textContent = "Download";
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-download-source-file]");
  if (!target) return;
  event.preventDefault();

  const fileId = target.dataset.downloadSourceFile;
  const fileKind = target.dataset.sourceKind || "request_file";
  if (!fileId) {
    showToast("This file is not ready for download yet.");
    return;
  }

  target.disabled = true;
  target.textContent = "Preparing";

  const result = await fetchClientApi("/api/source-file-download-url", {
    method: "POST",
    body: {
      fileId,
      fileKind,
      organizationId: target.dataset.organizationId || (isAdminUser() ? state.selectedAdminClientId : state.profileOrganizationId || undefined),
      projectId: target.dataset.projectId || (isAdminUser() ? getAdminProjectIdForApi() : state.selectedProjectId || undefined),
    },
  });

  if (!result.ok || !result.data?.signedUrl) {
    showToast(result.error || "Download link could not be created.");
    target.disabled = false;
    target.textContent = "Download";
    return;
  }

  triggerSecureDownload(result.data.signedUrl, result.data.fileName || "source-file");
  target.disabled = false;
  target.textContent = "Download";
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-delete-source-file]");
  if (!target) return;
  event.preventDefault();

  const fileId = target.dataset.deleteSourceFile;
  const fileKind = target.dataset.sourceKind || "request_file";
  if (!fileId) {
    showToast("This file is not ready for deletion yet.");
    return;
  }

  const confirmed = window.confirm("Remove this uploaded file from the workspace view? The file record will be archived for audit history.");
  if (!confirmed) return;

  setButtonBusy(target, true, "Deleting");
  const result = await fetchClientApi("/api/source-file-download-url", {
    method: "POST",
    body: {
      fileId,
      fileKind,
      action: "delete",
      organizationId: target.dataset.organizationId || (isAdminUser() ? state.selectedAdminClientId : state.profileOrganizationId || undefined),
      projectId: target.dataset.projectId || (isAdminUser() ? getAdminProjectIdForApi() : state.selectedProjectId || undefined),
    },
  });
  setButtonBusy(target, false);

  if (!result.ok || !result.data?.deleted) {
    showPersistentNotice(result.error || "File could not be deleted.");
    return;
  }

  state.requestFiles = state.requestFiles.filter((file) => !(file.fileId === fileId && file.fileKind === fileKind));
  state.clientUploads = state.clientUploads.filter((file) => !(file.fileId === fileId && file.fileKind === fileKind));
  state.adminRequestFiles = state.adminRequestFiles.filter((file) => !(file.fileId === fileId && file.fileKind === fileKind));
  state.adminClientUploads = state.adminClientUploads.filter((file) => !(file.fileId === fileId && file.fileKind === fileKind));
  state.adminQueue = state.adminQueue.filter((item) => !((item.fileId || item.id) === fileId && (item.fileKind || "request_file") === fileKind));
  saveState();
  if (isAdminUser()) {
    await loadAdminQueue();
  } else {
    await loadClientWorkspaceData();
  }
  render();
  showToast("File removed from the workspace.");
});

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-client-action]");
  if (!target) return;
  const context = target.dataset.context || "workspace:";
  const action = target.dataset.clientAction;
  if (action === "approve-deliverable") {
    event.preventDefault();
    markDeliverableAccepted(target.dataset.deliverableId).then((result) => {
      if (!result.ok) {
        showPersistentNotice(result.error || "Deliverable acceptance could not be recorded.");
        return;
      }
      showToast("Deliverable marked reviewed and accepted.");
    });
    return;
  }
  const selector = action === "upload" ? "#clientUploadContext" : "#clientMessageContext";
  const field = document.querySelector(selector);
  if (field) field.value = context;
  const messagePanel = document.querySelector("#clientWorkspaceMessages");
  if (messagePanel) messagePanel.open = true;
  const focusTarget = action === "upload" ? document.querySelector("#clientUploadFiles") : document.querySelector("#clientMessageBody");
  window.requestAnimationFrame(() => {
    focusTarget?.scrollIntoView({ block: "center", behavior: "smooth" });
    focusTarget?.focus();
  });
});

document.querySelector("#clientMessageForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter || document.querySelector("#clientMessageForm button[type='submit']");
  if (submitButton?.dataset.busy === "true") return;
  const messageFieldsValid = validateFieldSet({
    containerSelector: "#clientMessageForm",
    statusSelector: "#clientMessageStatus",
    message: "Complete the highlighted message fields before sending.",
    fields: [
      {
        selector: "#clientMessageContext",
        isValid: () => Boolean(inferProjectIdForContext(parseWorkspaceContext(document.querySelector("#clientMessageContext")?.value))),
        message: "Choose the project or work item this message belongs to.",
      },
      {
        selector: "#clientMessageBody",
        isValid: () => Boolean(document.querySelector("#clientMessageBody")?.value.trim()),
        message: "Add a message.",
      },
    ],
  });
  if (!messageFieldsValid) return;
  const status = document.querySelector("#clientMessageStatus");
  if (status) {
    status.textContent = "Sending your message.";
    status.classList.remove("warning", "success");
  }
  setButtonBusy(submitButton, true, "Sending Message");
  try {
    const result = await saveClientMessage();
    if (!result.ok) {
      if (status) {
        status.textContent = result.error || "Message could not be sent.";
        status.classList.add("warning");
      }
      showToast(result.error || "Message could not be sent.");
      return;
    }
    document.querySelector("#clientMessageBody").value = "";
    if (status) {
      status.textContent = result.storedOnline
        ? "Message sent and attached to the selected item. The advisory team will review it in the workspace."
        : "Message saved in this workspace.";
      status.classList.add("success");
    }
    render();
    showToast("Message added to the client workspace.");
  } catch (error) {
    const message = error.message || "Message could not be sent. Please try again or contact support.";
    if (status) {
      status.textContent = message;
      status.classList.add("warning");
    }
    showPersistentNotice(message);
  } finally {
    setButtonBusy(submitButton, false);
  }
});

document.querySelector("#clientUploadForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter || document.querySelector("#clientUploadForm button[type='submit']");
  if (submitButton?.dataset.busy === "true") return;
  const uploadFiles = Array.from(document.querySelector("#clientUploadFiles")?.files || []);
  const uploadValidationError = validateWorkspaceFiles(uploadFiles);
  const uploadFieldsValid = validateFieldSet({
    containerSelector: "#clientUploadForm",
    statusSelector: "#clientUploadStatus",
    message: uploadValidationError || "Complete the highlighted upload fields before uploading files.",
    fields: [
      {
        selector: "#clientUploadContext",
        isValid: () => Boolean(inferProjectIdForContext(parseWorkspaceContext(document.querySelector("#clientUploadContext")?.value))),
        message: "Choose the project or work item these files belong to.",
      },
      {
        selector: "#clientUploadFiles",
        isValid: () => uploadFiles.length > 0 && !uploadValidationError,
        message: uploadValidationError || "Select at least one file.",
      },
    ],
  });
  if (!uploadFieldsValid) return;
  const status = document.querySelector("#clientUploadStatus");
  if (status) {
    status.textContent = `Uploading ${uploadFiles.length} file${uploadFiles.length === 1 ? "" : "s"}. Larger files can take a few minutes. Please keep this page open.`;
    status.classList.remove("warning", "success");
  }
  setButtonBusy(submitButton, true, "Uploading Files");
  try {
    const result = await withClientTimeout(
      saveClientUpload(),
      getUploadOperationTimeoutMs(uploadFiles),
      `The upload is taking longer than expected. Please try again with fewer files, or contact ${config.supportEmail} if the issue continues.`
    );
    if (!result.ok) {
      const message = result.error || "Files could not be uploaded.";
      if (Number(result.uploaded || 0) > 0) {
        document.querySelector("#clientUploadFiles").value = "";
        document.querySelector("#clientUploadFileList").textContent = "Some files were uploaded. Select only the remaining files before retrying.";
        withClientTimeout(
          loadClientWorkspaceData(),
          15000,
          "Some files were attached, but the workspace refresh took too long. Refresh the page before retrying."
        )
          .then(() => render())
          .catch((error) => {
            setInlineStatus("#clientUploadStatus", error.message, "warning");
            showPersistentNotice(error.message);
          });
      }
      if (status) {
        status.textContent = message;
        status.classList.add("warning");
      }
      showPersistentNotice(message);
      return;
    }
    document.querySelector("#clientUploadFiles").value = "";
    document.querySelector("#clientUploadNotes").value = "";
    document.querySelector("#clientUploadFileList").textContent = "No files selected yet.";
    if (status) {
      const fileText = `${result.uploaded} file${result.uploaded === 1 ? "" : "s"}`;
      status.textContent = result.storedOnline
        ? `${fileText} uploaded and attached. The advisory team will review the workspace.`
        : `${fileText} recorded in this workspace.`;
      status.classList.add("success");
    }
    if (result.storedOnline) {
      await withClientTimeout(
        loadClientWorkspaceData(),
        20000,
        "Files were uploaded, but the workspace refresh took too long. Refresh the page if the new files are not visible."
      ).then(() => null, (error) => {
        setInlineStatus("#clientUploadStatus", error.message, "warning");
        showPersistentNotice(error.message);
      });
    }
    render();
    showToast("Client upload added to the workspace.");
  } catch (error) {
    const message = error.message || "Files could not be uploaded. Please try again or contact support.";
    if (status) {
      status.textContent = message;
      status.classList.add("warning");
    }
    showPersistentNotice(message);
  } finally {
    setButtonBusy(submitButton, false);
  }
});

function resetRequestIntakeForm() {
  const form = document.querySelector("#requestForm");
  if (!form) return;
  form.reset();
  const fileList = document.querySelector("#fileList");
  if (fileList) fileList.textContent = "No files selected yet.";
  const status = document.querySelector("#requestStatus");
  if (status) {
    status.textContent = "Complete the required fields before submitting.";
    status.classList.remove("warning", "success");
  }
  renderClientProjectControls();
  updateRequestReadinessStatus([]);
}

document.querySelector("#requestForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = document.querySelector("#requestSubmitButton") || event.submitter;
  if (submitButton?.dataset.busy === "true") return;
  const statusSelector = "#requestStatus";
  const warn = (message) => {
    setInlineStatus(statusSelector, message, "warning");
    showPersistentNotice(message);
  };

  setButtonBusy(submitButton, true, "Submitting Request");
  setInlineStatus(statusSelector, "Checking your profile, credit balance, and selected files.");

  try {
    if (!state.session?.user) {
      window.location.hash = "login";
      warn("Please sign in before submitting a request. This keeps your files, requests, and deliverables connected to one secure workspace.");
      return;
    }

    if (!isEmailVerified()) {
      window.location.hash = "login";
      warn("Please verify your email before submitting a request.");
      return;
    }

    const { estimateValue, requestedCredits } = getRequestCreditScope();
    if (estimateValue === "custom") {
      window.location.hash = "quote";
      setInlineStatus(statusSelector, "Custom scope selected. Please complete the custom advisory request form.", "success");
      showPersistentNotice("This looks like a custom advisory scope. Please use the custom quote form so we can review the work properly before pricing it.");
      addAuditEvent("Custom scope prompted", "Client selected custom scope review from request intake.");
      saveState();
      render();
      return;
    }

    const userId = getUserId();
    const selectedType = document.querySelector("#requestType").value;
    const otherType = document.querySelector("#requestOther").value.trim();
    const requestProjectSelectValue = document.querySelector("#requestProjectSelect")?.value || "";
    const requestProjectNameValue = document.querySelector("#requestProjectName")?.value.trim() || "";
    const businessGoal = document.querySelector("#businessGoal").value.trim();
    const targetAudience = document.querySelector("#targetAudience").value.trim();
    const desiredOutput = document.querySelector("#desiredOutput")?.value.trim() || "";
    const decisionDeadline = document.querySelector("#decisionDeadline")?.value || "";
    const attachmentDescription = document.querySelector("#attachmentDescription").value.trim();
    const requestFiles = Array.from(document.querySelector("#fileUpload")?.files || []);
    const requestFieldsValid = validateFieldSet({
      containerSelector: "#requestForm",
      statusSelector,
      message: "Complete the highlighted request fields before submitting.",
      fields: [
        { selector: "#requestProjectSelect", isValid: () => Boolean(requestProjectSelectValue || requestProjectNameValue), message: "Select an existing project or enter a new project name." },
        {
          selector: "#requestProjectName",
          when: () => requestProjectSelectValue === "__new__" || !requestProjectSelectValue,
          isValid: () => Boolean(document.querySelector("#requestProjectName")?.value.trim()),
          message: "Enter a project name.",
        },
        {
          selector: "#requestOther",
          when: () => selectedType === "Other",
          isValid: () => Boolean(otherType),
          message: "Describe the deliverable.",
        },
        { selector: "#businessGoal", isValid: () => Boolean(businessGoal), message: "Describe the business goal." },
        { selector: "#targetAudience", isValid: () => Boolean(targetAudience), message: "Add the target audience." },
        { selector: "#desiredOutput", isValid: () => Boolean(desiredOutput), message: "Describe the desired output." },
        { selector: "#decisionDeadline", isValid: () => Boolean(decisionDeadline), message: "Choose a deadline." },
        { selector: "#fileUpload", isValid: () => Boolean(requestFiles.length), message: "Attach at least one source file." },
        { selector: "#attachmentDescription", isValid: () => Boolean(attachmentDescription), message: "Describe the files." },
      ],
    });
    if (!requestFieldsValid) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const chosenDeadline = new Date(`${decisionDeadline}T00:00:00`);
    if (Number.isNaN(chosenDeadline.getTime()) || chosenDeadline < today) {
      warn("Please choose today or a future date for the deadline or decision date.");
      return;
    }

    const requestFileValidationError = validateWorkspaceFiles(requestFiles);
    if (requestFileValidationError) {
      warn(requestFileValidationError);
      return;
    }

    const organizationId = await withClientTimeout(
      getProfileOrganizationId(),
      8000,
      "We could not verify your client profile quickly enough. Please refresh the page and try again."
    );
    if (supabaseClient && !organizationId) {
      window.location.hash = "profile";
      warn("Please complete your client profile before submitting a request. This keeps your files, payment, and deliverables connected.");
      return;
    }
    if (requestedCredits > 0) {
      let creditResult;
      try {
        creditResult = await withClientTimeout(
          refreshCreditBalanceForSubmit(organizationId),
          12000,
          "Credit balance refresh is taking longer than expected."
        );
      } catch (_balanceError) {
        const fallbackBalance = getAvailableCredits();
        creditResult = fallbackBalance >= requestedCredits
          ? { ok: true, balance: fallbackBalance, usedWorkspaceBalance: true }
          : { ok: false, balance: fallbackBalance };
      }
      if (!creditResult.ok) {
        warn("We could not verify enough Advisory Credits for this request. Please open Billing to refresh your balance, or contact support if this continues.");
        return;
      }
      if (Number(creditResult.balance || 0) < requestedCredits) {
        window.location.hash = "billing";
        warn(getInsufficientCreditMessage(requestedCredits, creditResult.balance));
        addAuditEvent("Request paused", `Client attempted to submit a ${requestedCredits} credit request with insufficient balance.`);
        saveState();
        render();
        return;
      }
      if (creditResult.usedWorkspaceBalance) {
        setInlineStatus(statusSelector, "Using your current workspace credit balance to continue this request.");
      }
    }

    if (supabaseClient && state.workspaceLoadIssue && requestedCredits > 0) {
      warn("We could not verify all workspace records. Refresh the page and try again, or contact support if this continues.");
      return;
    }

    if (estimateValue === "rescue" && !hasRescueSprintAccess()) {
      window.location.hash = "billing";
      warn("Please start or confirm the BA Rescue Sprint before submitting a Rescue Sprint request. This keeps your payment, intake, files, and delivery history connected.");
      addAuditEvent("Rescue Sprint request paused", "Client selected Rescue Sprint scope without a recorded Rescue Sprint payment.");
      saveState();
      render();
      return;
    }

    const projectResult = await resolveRequestProject(organizationId);
    if (!projectResult.ok) {
      warn(projectResult.error || "Please choose or create a project before submitting this request.");
      return;
    }
    const selectedProject = projectResult.project;
    state.selectedProjectId = selectedProject.id || "";

    const request = {
      id: generateRequestCode(),
      type: selectedType === "Other" && otherType ? otherType : selectedType,
      status: "Pending scope",
      due: formatDisplayDate(decisionDeadline),
      client: state.client.company,
      projectId: selectedProject.id || "",
      projectName: selectedProject.name || "",
      projectCode: selectedProject.projectCode || "",
      projectLabel: getProjectLabel(selectedProject),
      createdAt: getIsoNow(),
    };
    const requestPayload = {
      request_code: request.id,
      organization_id: organizationId,
      project_id: selectedProject.id || null,
      submitted_by: userId,
      request_type: request.type,
      business_goal: businessGoal,
      target_audience: targetAudience,
      attachment_description: `${attachmentDescription}\n\nDesired output: ${desiredOutput}\nDecision date: ${decisionDeadline}`,
      status: "pending_scope",
      credits_estimated: requestedCredits,
      due_at: decisionDeadline || null,
    };

    setInlineStatus(statusSelector, `Creating your request and preparing ${requestFiles.length} file${requestFiles.length === 1 ? "" : "s"} for upload. Larger files can take a few minutes.`);

    let result;
    let savedRequestId = null;
    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .rpc("create_client_request_intake_v2", {
          p_request_code: requestPayload.request_code,
          p_organization_id: requestPayload.organization_id,
          p_project_id: requestPayload.project_id,
          p_request_type: requestPayload.request_type,
          p_business_goal: requestPayload.business_goal,
          p_target_audience: requestPayload.target_audience,
          p_attachment_description: requestPayload.attachment_description,
          p_credits_estimated: requestPayload.credits_estimated,
          p_due_at: decisionDeadline || null,
          p_credit_scope: estimateValue,
        })
        .maybeSingle();
      result = error ? { ok: false, reason: error.message } : { ok: true };
      savedRequestId = data?.request_id || null;
      if (data?.request_code) request.id = data.request_code;
      if (data?.balance !== undefined) state.creditsLeft = Number(data.balance || 0);
      if (!savedRequestId) {
        result = {
          ok: false,
          reason: "The secure request reference was not returned. Please refresh the workspace and try again.",
        };
      }
    } else {
      result = await writeToSupabase("requests", requestPayload);
    }

    if (!result.ok) {
      warn(result.reason || `Request could not be submitted. Please try again or contact ${config.supportEmail}.`);
      return;
    }

    setInlineStatus(statusSelector, `Request created. Uploading ${requestFiles.length} file${requestFiles.length === 1 ? "" : "s"}. Please keep this page open.`);
    const uploadResult = await withClientTimeout(
      uploadRequestFiles(savedRequestId, organizationId, selectedProject.id || ""),
      getUploadOperationTimeoutMs(requestFiles),
      `Request ${request.id} was created, but the file upload took longer than expected. Please open Messages and Files and attach the files there.`
    ).catch((error) => ({
      ok: false,
      uploaded: 0,
      reason: error.message || "The request was created, but the file upload could not be completed.",
    }));
    request.requestId = savedRequestId;
    state.requests.unshift(request);
    addAuditEvent(
      "Request submitted",
      estimateValue === "rescue"
        ? `${request.id} submitted for BA Rescue Sprint delivery.`
        : `${request.id} submitted with an estimated ${requestedCredits} Advisory Credit scope.`
    );
    saveState();
    if (!uploadResult.ok && savedRequestId && supabaseClient) {
      await supabaseClient
        .rpc("mark_client_request_file_upload_attention", {
          p_request_id: savedRequestId,
          p_organization_id: organizationId,
          p_note: uploadResult.reason || "Source file upload needs attention.",
        })
        .then(() => null, () => null);
      request.status = "File upload needs attention";
    }
    await loadClientWorkspaceData();
    notifyAdvisorEventInBackground({
      eventType: "client_request_submitted",
      title: "New client request submitted",
      summary: `${request.id}: ${request.type}. Project: ${getProjectLabel(selectedProject)}. Desired output: ${desiredOutput}. Deadline: ${decisionDeadline}. Files uploaded: ${uploadResult.uploaded}.`,
      relatedEntityType: "request",
      relatedEntityId: savedRequestId,
      relatedLabel: request.id,
      projectId: selectedProject.id || null,
    });
    if (!uploadResult.ok) {
      const uploadAttentionMessage = `Request ${request.id} was created, but the file upload needs attention. Please open Messages and Files, choose ${request.id}, and attach the remaining files there. ${uploadResult.reason || ""}`.trim();
      resetRequestIntakeForm();
      setInlineStatus(statusSelector, uploadAttentionMessage, "warning");
      showPersistentNotice(uploadAttentionMessage);
      window.location.hash = "messages";
      render();
      return;
    }

    const successMessage = `Request received. ${uploadResult.uploaded} file${uploadResult.uploaded === 1 ? "" : "s"} uploaded and attached to your workspace.`;
    setInlineStatus(statusSelector, successMessage, "success");
    showPersistentNotice(successMessage);
    resetRequestIntakeForm();
    window.location.hash = "dashboard";
  } catch (error) {
    warn(error.message || `Request could not be submitted. Please try again or contact ${config.supportEmail}.`);
  } finally {
    setButtonBusy(submitButton, false);
  }
});

document.querySelector("#quoteForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter || document.querySelector("#quoteForm button[type='submit']");
  if (submitButton?.dataset.busy === "true") return;
  const quoteStatus = document.querySelector("#quoteStatus");
  const workEmail = (document.querySelector("#quoteEmail").value || state.client.email || getUserEmail()).trim();
  const companyType = document.querySelector("#quoteCompanyType").value;
  const otherCompanyType = document.querySelector("#quoteOtherCompanyType").value.trim();
  const country = document.querySelector("#quoteCountry").value;
  const budget = document.querySelector("#quoteBudget").value;
  const summary = document.querySelector("#quoteSummary").value.trim();
  const quoteFieldsValid = validateFieldSet({
    containerSelector: "#quoteForm",
    statusSelector: "#quoteStatus",
    message: "Complete the highlighted custom scope fields before sending.",
    fields: [
      { selector: "#quoteCompanyType", isValid: () => Boolean(companyType), message: "Select organization type." },
      {
        selector: "#quoteOtherCompanyType",
        when: () => companyType === "Other",
        isValid: () => Boolean(otherCompanyType),
        message: "Describe the organization type.",
      },
      { selector: "#quoteCountry", isValid: () => Boolean(country), message: "Select head office country." },
      { selector: "#quoteEmail", isValid: () => Boolean(workEmail && workEmail.includes("@")), message: "Add a valid work email." },
      { selector: "#quoteBudget", isValid: () => Boolean(budget), message: "Select a budget range." },
      { selector: "#quoteSummary", isValid: () => summary.length >= 25, message: "Add at least 25 characters." },
    ],
  });
  if (!quoteFieldsValid) return;

  if (quoteStatus) {
    quoteStatus.textContent = "Sending your custom advisory request.";
    quoteStatus.classList.remove("warning", "success");
  }
  setButtonBusy(submitButton, true, "Sending Request");
  try {
    const organizationId = await getProfileOrganizationId();

    const result = await fetchMaybeAuthedApi("/api/custom-quote", {
      method: "POST",
      body: {
        organizationId,
        workEmail,
        organizationName: state.client.company,
        companyType,
        otherCompanyType,
        headOfficeCountry: country,
        estimatedBudget: budget,
        requestSummary: summary,
      },
    });

    const successMessage = result.data?.emailed
      ? "Custom advisory request received. Our advisory team has been notified."
      : "Custom advisory request received. We will review and follow up with next steps.";
    const errorMessage = `Custom advisory request could not be submitted. Please try again or contact ${config.supportEmail}.`;
    if (quoteStatus) {
      quoteStatus.textContent = result.ok ? successMessage : errorMessage;
      quoteStatus.classList.toggle("success", result.ok);
      quoteStatus.classList.toggle("warning", !result.ok);
    }
    if (result.ok) {
      showPersistentNotice(successMessage);
      addAuditEvent("Custom quote requested", summary.slice(0, 100));
      saveState();
    } else {
      showPersistentNotice(errorMessage);
    }
  } finally {
    setButtonBusy(submitButton, false);
  }
});

document.querySelector("#profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter || document.querySelector("#profileForm button[type='submit']");
  if (submitButton?.dataset.busy === "true") return;
  const profileFieldsValid = validateFieldSet({
    containerSelector: "#profileForm",
    statusSelector: "#profileStatus",
    message: "Complete the highlighted client profile fields before saving.",
    fields: [
      { selector: "#profileFirstName", isValid: () => Boolean(document.querySelector("#profileFirstName")?.value.trim()), message: "Add first name." },
      { selector: "#profileLastName", isValid: () => Boolean(document.querySelector("#profileLastName")?.value.trim()), message: "Add last name." },
      { selector: "#profileTitle", isValid: () => Boolean(document.querySelector("#profileTitle")?.value.trim()), message: "Add job title." },
      { selector: "#profileCompany", isValid: () => Boolean(document.querySelector("#profileCompany")?.value.trim()), message: "Add company or agency." },
      { selector: "#profileIndustry", isValid: () => Boolean(document.querySelector("#profileIndustry")?.value), message: "Select industry." },
      { selector: "#profileCountry", isValid: () => Boolean(document.querySelector("#profileCountry")?.value), message: "Select country." },
      { selector: "#profileTimezone", isValid: () => Boolean(document.querySelector("#profileTimezone")?.value), message: "Select time zone." },
    ],
  });
  if (!profileFieldsValid) return;
  setButtonBusy(submitButton, true, "Saving Profile");
  try {
    state.client = {
      email: document.querySelector("#profileEmail").value,
      company: document.querySelector("#profileCompany").value,
    };
    syncAuthEmailFields(state.client.email);
    saveState();
    const orgResult = await saveClientProfileToSupabase();
    render();
    if (orgResult.ok) {
      const checkoutResumed = await resumePendingCheckout();
      if (!checkoutResumed) {
        await loadClientWorkspaceData();
        window.location.hash = "dashboard";
        setInlineStatus("#profileStatus", "Client profile saved. Your workspace is ready.", "success");
        showToast("Client profile saved. Your workspace is ready.");
      }
    } else {
      setInlineStatus("#profileStatus", orgResult.reason || `Client profile could not be saved. Please try again or contact ${config.supportEmail}.`, "warning");
      showPersistentNotice(orgResult.reason || `Client profile could not be saved. Please try again or contact ${config.supportEmail}.`);
    }
  } finally {
    setButtonBusy(submitButton, false);
  }
});

document.querySelector("#accountSecurityForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = await updateSignedInPassword(
    document.querySelector("#accountNewPassword")?.value || "",
    document.querySelector("#accountConfirmPassword")?.value || ""
  );
  if (!result.ok) {
    showPersistentNotice(result.error || "Password could not be updated.");
    return;
  }
  clearSensitiveAuthFields();
  showToast("Password updated.");
});

document.querySelector("#requestType").addEventListener("change", () => {
  toggleOther("#requestType", "#requestOtherWrap");
});

document.querySelector("#requestCreditEstimate")?.addEventListener("change", () => {
  updateRequestReadinessStatus();
});

document.querySelector("#clientProjectFilter")?.addEventListener("change", (event) => {
  state.selectedProjectId = event.target.value || "";
  saveState();
  render();
});

document.querySelector("#requestProjectSelect")?.addEventListener("change", () => {
  renderClientProjectControls();
  updateRequestReadinessStatus();
});

document.querySelector("#requestProjectName")?.addEventListener("input", () => {
  updateRequestReadinessStatus();
});

document.querySelector("#quoteCompanyType").addEventListener("change", () => {
  toggleOther("#quoteCompanyType", "#quoteOtherWrap");
});

document.querySelector("#fileUpload").addEventListener("change", (event) => {
  const files = Array.from(event.target.files || []);
  const list = document.querySelector("#fileList");
  if (!files.length) {
    list.textContent = "No files selected yet.";
    updateRequestReadinessStatus([]);
    return;
  }
  const validationError = validateWorkspaceFiles(files);
  const fileItems = files
    .map((file) => `<div><strong>${escapeHtml(file.name)}</strong> <span>${escapeHtml(formatFileSize(file.size))}</span></div>`)
    .join("");
  list.innerHTML = validationError ? `<div class="file-warning">${escapeHtml(validationError)}</div>${fileItems}` : fileItems;
  updateRequestReadinessStatus(files);
});

document.querySelector("#clientUploadFiles")?.addEventListener("change", (event) => {
  const files = Array.from(event.target.files || []);
  const list = document.querySelector("#clientUploadFileList");
  if (!list) return;
  if (!files.length) {
    list.textContent = "No files selected yet.";
    setInlineStatus("#clientUploadStatus", "Files are linked to the selected workspace item.");
    return;
  }
  const validationError = validateWorkspaceFiles(files);
  list.innerHTML = files
    .map((file) => `<div><strong>${escapeHtml(file.name)}</strong> <span>${escapeHtml(formatFileSize(file.size))}</span></div>`)
    .join("");
  if (validationError) {
    list.innerHTML = `<div class="file-warning">${escapeHtml(validationError)}</div>${list.innerHTML}`;
    setInlineStatus("#clientUploadStatus", validationError, "warning");
  } else {
    setInlineStatus("#clientUploadStatus", `${files.length} file${files.length === 1 ? "" : "s"} selected. Add context, then upload when ready.`, "success");
  }
});

document.querySelector("#adminDeliverableFiles")?.addEventListener("change", (event) => {
  const files = Array.from(event.target.files || []);
  const list = document.querySelector("#adminDeliverableFileList");
  if (!list) return;
  if (!files.length) {
    list.textContent = "No deliverable files selected yet.";
    return;
  }
  const validationError = validateWorkspaceFiles(files);
  list.innerHTML = files
    .map((file) => `<div><strong>${escapeHtml(file.name)}</strong> <span>${escapeHtml(formatFileSize(file.size))}</span></div>`)
    .join("");
  if (validationError) {
    list.innerHTML = `<div class="file-warning">${escapeHtml(validationError)}</div>${list.innerHTML}`;
  }
  updateAdminReleaseReadiness();
});

[
  "#adminUploadClientSelect",
  "#adminUploadRequestSelect",
  "#adminUploadProjectSelect",
  "#adminExistingDeliverableSelect",
  "#adminDeliverableTitle",
  "#adminDeliverableType",
  "#adminDeliverableSummary",
  "#adminDeliverableReleaseNote",
  "#adminReleaseCreditsUsed",
].forEach((selector) => {
  document.querySelector(selector)?.addEventListener("input", updateAdminReleaseReadiness);
  document.querySelector(selector)?.addEventListener("change", updateAdminReleaseReadiness);
});

window.addEventListener("hashchange", setView);
populateCountries();
renderContentDrivenSections();
setupOAuthButtons();
toggleOther("#requestType", "#requestOtherWrap");
toggleOther("#quoteCompanyType", "#quoteOtherWrap");
setView();
initAuth()
  .catch((error) => {
    setAuthStatus(error.message || `Secure account access could not be started. Please contact ${config.supportEmail}.`);
  })
  .finally(() => {
    authStartupComplete = true;
    if ((routeAliases[window.location.hash.replace("#", "")] || window.location.hash.replace("#", "")) === "checkout-success") {
      setView();
    }
  });
