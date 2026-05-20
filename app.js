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

const state = {
  client: JSON.parse(localStorage.getItem("baad-client") || "null") || {
    email: "",
    company: "Your organization",
  },
  requests: JSON.parse(localStorage.getItem("baad-requests") || "null") || [],
  creditsLeft: Number(localStorage.getItem("baad-credits") || 0),
  creditThreshold: Number(localStorage.getItem("baad-credit-threshold") || config.lowCreditThreshold),
  creditHistory: JSON.parse(localStorage.getItem("baad-credit-history") || "null") || [],
  paymentHistory: JSON.parse(localStorage.getItem("baad-payment-history") || "null") || [],
  auditEvents: JSON.parse(localStorage.getItem("baad-audit-events") || "null") || [],
  deliverables: JSON.parse(localStorage.getItem("baad-deliverables") || "null") || [],
  clientMessages: JSON.parse(localStorage.getItem("baad-client-messages") || "null") || [],
  clientUploads: JSON.parse(localStorage.getItem("baad-client-uploads") || "null") || [],
  requestFiles: JSON.parse(localStorage.getItem("baad-request-files") || "null") || [],
  adminDeliverables: [],
  adminDeliverableFiles: [],
  adminClientUploads: [],
  adminRequestFiles: [],
  adminCreditLedger: [],
  adminPaymentHistory: [],
  adminAuditEvents: [],
  session: null,
  adminAccess: false,
  adminStatusChecked: false,
  adminStatusUserId: "",
  adminQueue: [],
  adminClients: [],
  selectedAdminClientId: localStorage.getItem("baad-admin-client-id") || "",
  adminNewCount: 0,
  quoteCount: 0,
  passwordRecovery: false,
  profileOrganizationId: "",
  workspaceLoadIssue: "",
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
  localStorage.setItem("baad-client", JSON.stringify(state.client));
  localStorage.setItem("baad-requests", JSON.stringify(state.requests));
  localStorage.setItem("baad-credits", String(state.creditsLeft));
  localStorage.setItem("baad-credit-threshold", String(state.creditThreshold));
  localStorage.setItem("baad-credit-history", JSON.stringify(state.creditHistory));
  localStorage.setItem("baad-payment-history", JSON.stringify(state.paymentHistory));
  localStorage.setItem("baad-audit-events", JSON.stringify(state.auditEvents));
  localStorage.setItem("baad-deliverables", JSON.stringify(state.deliverables));
  localStorage.setItem("baad-client-messages", JSON.stringify(state.clientMessages));
  localStorage.setItem("baad-client-uploads", JSON.stringify(state.clientUploads));
  localStorage.setItem("baad-request-files", JSON.stringify(state.requestFiles));
  localStorage.setItem("baad-admin-client-id", state.selectedAdminClientId || "");
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

function getCreditAlertState(balance = state.creditsLeft, threshold = state.creditThreshold) {
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
  if (client.id) return Number(client.balance ?? 0);
  return organizationId === state.selectedAdminClientId ? Number(state.creditsLeft || 0) : 0;
}

function syncSelectedAdminClientToState() {
  const client = getSelectedAdminClient();
  state.selectedAdminClientId = client.selectionId || client.id || "";
  state.creditsLeft = Number(client.balance ?? 0);
  state.creditThreshold = Number(client.lowCreditThreshold ?? config.lowCreditThreshold);
}

function hasSelectedAdminClient() {
  const client = getSelectedAdminClient();
  return Boolean(state.selectedAdminClientId && (client.id || client.email || client.name));
}

function updateSelectedAdminClientCreditAccount(balance, lowCreditThreshold) {
  const client = getSelectedAdminClient();
  if (!state.adminClients.length || !client.id) return;
  client.balance = balance;
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
  return !isShippedStatus(status) && !isPausedStatus(status) && normalized !== "sent" && normalized !== "paid";
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

function getSelectedAdminQueueItems() {
  const selectedClient = getSelectedAdminClient();
  if (!state.selectedAdminClientId) return state.adminQueue;
  if (!selectedClient.id && !selectedClient.email && !selectedClient.name) return [];
  return state.adminQueue.filter((item) => isSelectedAdminRecord(item, selectedClient));
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
  if (state.creditsLeft <= 0) {
    return `No Advisory Credits remain. <a href="#billing" data-action="buy-topup">Add a Credit Top Up</a> before starting new credit based work.`;
  }
  if (state.creditsLeft <= state.creditThreshold) {
    return `${state.creditsLeft} Advisory Credits remain. <a href="#billing" data-action="buy-topup">Add a Credit Top Up</a> before the next deliverable is scoped.`;
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

  if (validationError) {
    setInlineStatus(statusSelector, validationError, "warning");
    return;
  }

  if (!selectedFiles.length) {
    setInlineStatus(statusSelector, "Requests are checked against your profile, credit balance, and selected files before submission.");
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

  if (requestedCredits > 0 && Number(state.creditsLeft || 0) < requestedCredits) {
    setInlineStatus(statusSelector, getInsufficientCreditMessage(requestedCredits), "warning");
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

async function refreshCreditBalanceForSubmit(organizationId) {
  if (!supabaseClient || !organizationId) {
    return { ok: true, balance: Number(state.creditsLeft || 0) };
  }

  const { data, error } = await supabaseClient
    .from("credit_balance_summary")
    .select("balance,low_credit_threshold,status,reserved_balance,updated_at")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };

  state.creditsLeft = Number(data?.balance ?? 0);
  state.creditThreshold = Number(data?.low_credit_threshold ?? config.lowCreditThreshold);
  saveState();
  render();
  return { ok: true, balance: state.creditsLeft };
}

function getStatusGroup(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("complete") || normalized.includes("delivered")) return "completed";
  if (normalized.includes("review")) return "inReview";
  if (normalized.includes("pause") || normalized.includes("awaiting credit")) return "paused";
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
  return status
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getVerificationLevel(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("approved") || normalized.includes("complete")) return "approved";
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
  return rawMessage;
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

function isEmailVerified() {
  const user = state.session?.user;
  if (!user) return false;
  return Boolean(user.email_confirmed_at || user.confirmed_at || user.user_metadata?.email_verified);
}

function resetClientWorkspaceState() {
  state.session = null;
  resetAdminAccessState();
  state.client = { email: "", company: "" };
  state.requests = [];
  state.deliverables = [];
  state.clientMessages = [];
  state.clientUploads = [];
  state.requestFiles = [];
  state.creditHistory = [];
  state.auditEvents = [];
  state.paymentHistory = [];
  state.adminQueue = [];
  state.adminClients = [];
  state.adminDeliverables = [];
  state.adminDeliverableFiles = [];
  state.adminClientUploads = [];
  state.adminRequestFiles = [];
  state.adminCreditLedger = [];
  state.adminPaymentHistory = [];
  state.adminAuditEvents = [];
  state.creditsLeft = 0;
  state.creditThreshold = 2;
  state.passwordRecovery = false;
  state.profileOrganizationId = "";
  [
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
  ].forEach((key) => localStorage.removeItem(key));
  localStorage.removeItem("baad-post-auth-route");
  clearPendingCheckoutType();
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
    window.location.hash = "admin";
    return;
  }

  const organizationId = await getProfileOrganizationId();
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
  return error ? decodeURIComponent(error).replace(/\+/g, " ") : "";
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

  const { data } = await supabaseClient.auth.getSession();
  state.session = data.session;
  if (state.session?.user) {
    await loadSignedInProfile();
    await loadClientWorkspaceData();
    await refreshAdminStatus(true);
    if (state.passwordRecovery) {
      window.history.replaceState(null, "", `${window.location.pathname}#login`);
    } else {
      await routeAfterAuth();
    }
  }
  updateAuthUi();

  const authError = getAuthErrorMessage();
  if (authError) {
    setAuthStatus(`Sign in could not be completed: ${authError}`);
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
    if (session?.user) {
      await loadSignedInProfile();
      await loadClientWorkspaceData();
      await refreshAdminStatus(true);
      updateAuthUi();
      await routeAfterAuth();
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
    const response = await fetch(path, {
      ...options,
      headers,
      body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
    });
    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_error) {
        data = { error: "The admin service returned an unexpected response." };
      }
    }
    return response.ok ? { ok: true, status: response.status, data } : { ok: false, status: response.status, error: data.error || "The admin request could not be completed." };
  } catch (error) {
    return { ok: false, status: 0, error: error.message || "The admin request could not be completed." };
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
    const response = await fetch(path, {
      ...options,
      headers,
      body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
    });
    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_error) {
        data = { error: "The secure workspace returned an unexpected response." };
      }
    }
    return response.ok ? { ok: true, status: response.status, data } : { ok: false, status: response.status, error: data.error || "The secure workspace request could not be completed." };
  } catch (error) {
    return { ok: false, status: 0, error: error.message || "The secure workspace request could not be completed." };
  }
}

let checkoutReconcileSessionId = "";
let authStartupComplete = false;

function getCheckoutSessionId() {
  return new URLSearchParams(window.location.search).get("session_id") || "";
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
  const result = await fetchClientApi("/api/create-checkout-session", {
    method: "POST",
    body: {
      action: "reconcile_checkout",
      sessionId,
    },
  });

  if (!result.ok) {
    checkoutReconcileSessionId = "";
    await withClientTimeout(loadClientWorkspaceData(), 8000, "Workspace refresh is taking longer than expected.").catch(() => null);
    render();
    const creditsNow = Number(state.creditsLeft || 0);
    const paymentWasRecorded = state.paymentHistory.some((payment) => isPaidPaymentStatus(payment.status));
    if (creditsNow > priorCredits || paymentWasRecorded) {
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
  addPaymentHistory(productLabel(data.productType), data.credits ? `${data.credits} Advisory Credit${Number(data.credits) === 1 ? "" : "s"}` : "Paid", "Paid");
  if (Number(data.credits || 0) > 0) {
    addCreditHistory(productLabel(data.productType), `+${data.credits}`, state.creditsLeft);
  }
  clearPendingCheckoutType();
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

  return fetchClientApi("/api/notify", {
    method: "POST",
    body: payload,
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
  if (field && value !== undefined && value !== null && value !== "") {
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

function normalizeClientMessage(row) {
  return {
    id: row.id || `message-${Date.now()}`,
    contextType: row.deliverable_id ? "deliverable" : row.request_id ? "request" : row.context_type || "workspace",
    contextId: row.deliverable_id || row.request_id || row.context_id || "",
    contextLabel: row.subject || row.context_label || "Workspace message",
    body: row.body || row.message || "",
    status: normalizeVerificationStatus(row.status || "Received"),
    createdAt: row.created_at || row.createdAt || getIsoNow(),
  };
}

function normalizeClientUpload(row) {
  return {
    id: row.id || `upload-${Date.now()}`,
    fileId: row.id || "",
    fileKind: "client_upload",
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
  return {
    id: row.id || `request-file-${Date.now()}`,
    fileId: row.id || "",
    fileKind: "request_file",
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
    const [creditResult, ledgerResult, paymentResult, requestResult, deliverableResult, requestFileResult] = await Promise.all([
      supabaseClient
        .from("credit_balance_summary")
        .select("balance,low_credit_threshold,status,reserved_balance,updated_at")
        .eq("organization_id", organizationId)
        .maybeSingle(),
      supabaseClient
        .from("credit_ledger")
        .select("entry_type,entry_reason,credits,balance_after,created_at")
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
        .select("id,request_code,request_type,status,due_at,created_at,credits_estimated")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabaseClient
        .from("client_deliverable_versions")
        .select("deliverable_id,request_id,title,deliverable_type,status,current_version_number,version_id,file_id,version_number,original_file_name,file_size_bytes,summary,release_note,uploaded_at,updated_at")
        .eq("organization_id", organizationId)
        .order("uploaded_at", { ascending: false })
        .limit(100),
      supabaseClient
        .from("request_files")
        .select("id,request_id,organization_id,file_name,file_size_bytes,mime_type,created_at,requests(request_code,request_type)")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const firstDataError = [creditResult, ledgerResult, paymentResult, requestResult, deliverableResult, requestFileResult].find((result) => result?.error);
    if (firstDataError?.error) {
      state.workspaceLoadIssue = firstDataError.error.message || "Some workspace information could not be loaded.";
    }

    if (creditResult.data) {
      state.creditsLeft = Number(creditResult.data.balance ?? state.creditsLeft);
      state.creditThreshold = Number(creditResult.data.low_credit_threshold ?? state.creditThreshold);
    } else if (!creditResult.error) {
      state.creditsLeft = 0;
      state.creditThreshold = config.lowCreditThreshold;
    }

    if (!ledgerResult.error && Array.isArray(ledgerResult.data)) {
      state.creditHistory = ledgerResult.data.map((item) => ({
        date: formatDisplayDate(item.created_at),
        deliverable: item.entry_reason || item.entry_type || "Credit event",
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
        type: request.request_type,
        status: request.status || "New",
        due: formatDisplayDate(request.due_at),
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
        .select("id,deliverable_id,request_id,subject,body,status,created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseClient
        .from("client_uploads")
        .select("id,deliverable_id,request_id,upload_type,original_file_name,file_size_bytes,note,status,created_at")
        .eq("organization_id", organizationId)
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

async function uploadRequestFiles(requestId, organizationId) {
  const fileInput = document.querySelector("#fileUpload");
  const files = Array.from(fileInput.files || []);
  const userId = getUserId();

  if (!files.length || !supabaseClient || !userId || !requestId) {
    return { ok: true, uploaded: 0 };
  }
  const validationError = validateWorkspaceFiles(files);
  if (validationError) {
    return { ok: false, reason: validationError, uploaded: 0 };
  }

  let uploaded = 0;
  for (const [index, file] of files.entries()) {
    const storagePath = createClientStoragePath(userId, requestId, file.name, index);
    const uploadResponse = await withClientTimeout(
      supabaseClient.storage.from("client-files").upload(storagePath, file, {
        upsert: false,
        contentType: getUploadContentType(file),
      }),
      45000,
      `${file.name} took too long to upload. Please try again with a smaller file or contact ${config.supportEmail}.`
    );
    const uploadError = uploadResponse?.error;

    if (uploadError) {
      return { ok: false, reason: getPartialUploadError(file.name, uploaded, files.length, uploadError.message), uploaded };
    }

    const fileRecordResponse = await withClientTimeout(
      supabaseClient.from("request_files").insert({
        request_id: requestId,
        organization_id: organizationId,
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
      await supabaseClient.storage.from("client-files").remove([storagePath]).then(() => null, () => null);
      return { ok: false, reason: getPartialUploadError(file.name, uploaded, files.length, fileRecordError.message), uploaded };
    }

    uploaded += 1;
  }

  return { ok: true, uploaded };
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
  return `Upload stopped at ${fileName}. ${countText} were uploaded before the issue. ${reason || "Please review the file and try again."}`;
}

function getWorkspaceItems() {
  const deliverableItems = state.deliverables.map((deliverable) => ({
    type: "deliverable",
    id: deliverable.id,
    label: `${deliverable.title} | Version ${deliverable.currentVersion}`,
  }));
  const requestItems = state.requests.map((request) => ({
    type: "request",
    id: request.requestId || request.id,
    label: `${request.id} | ${request.type}`,
  }));
  return [...deliverableItems, ...requestItems];
}

function parseWorkspaceContext(value) {
  const [type = "workspace", ...idParts] = String(value || "").split(":");
  const id = idParts.join(":");
  const item = getWorkspaceItems().find((entry) => entry.type === type && String(entry.id) === id);
  return {
    type,
    id,
    label: item?.label || "Workspace",
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

  const organizationId = await getProfileOrganizationId();
  if (supabaseClient && !organizationId) {
    return { ok: false, error: "Please complete your client profile before sending a workspace message." };
  }

  const result =
    organizationId && supabaseClient
      ? await writeToSupabase("client_deliverable_messages", {
          organization_id: organizationId,
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
  addAuditEvent("Client message received", `${context.label}: ${body.slice(0, 80)}`);
  saveState();
  const notification = await notifyAdvisorEvent({
    eventType: "client_message",
    title: "Client message received",
    summary: `${context.label}: ${body}`,
    relatedEntityType: context.deliverableId ? "deliverable" : context.requestId ? "request" : "workspace",
    relatedEntityId: context.deliverableId || context.requestId || null,
    relatedLabel: context.label,
  });
  return { ok: true, storedOnline: Boolean(result.ok), advisorNotified: notification.ok && notification.data?.sent !== false };
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

  const organizationId = await getProfileOrganizationId();
  const userId = getUserId();
  let storedOnline = false;
  let uploaded = 0;
  if (supabaseClient && !organizationId) {
    return { ok: false, error: "Please complete your client profile before uploading files." };
  }

  for (const [index, file] of files.entries()) {
    const entry = {
      id: `upload-${Date.now()}-${uploaded}`,
      fileId: "",
      fileKind: "client_upload",
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
      const uploadResponse = await withClientTimeout(
        supabaseClient.storage.from("client-files").upload(storagePath, file, {
          upsert: false,
          contentType: getUploadContentType(file),
        }),
        45000,
        `${file.name} took too long to upload. Please try again with a smaller file or contact ${config.supportEmail}.`
      );
      const uploadError = uploadResponse?.error;

      if (uploadError) {
        return { ok: false, error: getPartialUploadError(file.name, uploaded, files.length, uploadError.message || "File could not be uploaded.") };
      }

      const recordResponse = await withClientTimeout(
        supabaseClient
          .from("client_uploads")
          .insert({
            organization_id: organizationId,
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
        await supabaseClient.storage.from("client-files").remove([storagePath]).then(() => null, () => null);
        return { ok: false, error: getPartialUploadError(file.name, uploaded, files.length, recordError.message || "File record could not be saved to the workspace.") };
      }
      entry.fileId = uploadRecord?.id || "";
      storedOnline = true;
    }

    addLocalUpload(entry);
    uploaded += 1;
  }

  addAuditEvent("Client files received", `${uploaded} file${uploaded === 1 ? "" : "s"} attached to ${context.label}.`);
  saveState();
  const notification = await notifyAdvisorEvent({
    eventType: "client_file_upload",
    title: "Client files uploaded",
    summary: `${uploaded} file${uploaded === 1 ? "" : "s"} attached to ${context.label}. Purpose: ${purpose}. ${note ? `Notes: ${note}` : ""}`,
    relatedEntityType: context.deliverableId ? "deliverable" : context.requestId ? "request" : "workspace",
    relatedEntityId: context.deliverableId || context.requestId || null,
    relatedLabel: context.label,
  });
  return { ok: true, uploaded, storedOnline, advisorNotified: notification.ok && notification.data?.sent !== false };
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

  const organizationId = document.querySelector("#adminUploadClientSelect")?.value || state.selectedAdminClientId;
  const requestId = document.querySelector("#adminUploadRequestSelect")?.value || null;
  const existingDeliverableId = document.querySelector("#adminExistingDeliverableSelect")?.value || "";
  const title = document.querySelector("#adminDeliverableTitle")?.value.trim() || "Client deliverable";
  const deliverableType = document.querySelector("#adminDeliverableType")?.value || "Business Analysis deliverable";
  const summary = document.querySelector("#adminDeliverableSummary")?.value.trim() || "";
  const releaseNote = document.querySelector("#adminDeliverableReleaseNote")?.value.trim() || "Released to client workspace.";
  const creditsUsed = Math.max(0, Number(document.querySelector("#adminReleaseCreditsUsed")?.value || 0));
  const notifyClient = Boolean(document.querySelector("#adminNotifyClient")?.checked);
  const files = getAdminUploadFiles();

  if (!organizationId) {
    return { ok: false, error: "Select a client before uploading a deliverable." };
  }

  if (!state.adminClients.some((client) => client.id === organizationId)) {
    return { ok: false, error: "The selected client workspace is not available for upload." };
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
    !state.adminQueue.some((item) => item.queueType === "request" && item.organizationId === organizationId && (item.requestId === requestId || item.id === requestId))
  ) {
    return { ok: false, error: "The selected request does not belong to this client." };
  }

  if (
    existingDeliverableId &&
    !state.adminDeliverables.some((deliverable) => deliverable.id === existingDeliverableId && deliverable.organizationId === organizationId)
  ) {
    return { ok: false, error: "The selected deliverable does not belong to this client." };
  }

  if (!files.length) {
    return { ok: false, error: "Select at least one deliverable file to upload." };
  }
  const validationError = validateWorkspaceFiles(files);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  let deliverableId = existingDeliverableId;
  if (!deliverableId) {
    const { data, error } = await supabaseClient
      .from("deliverables")
      .insert({
        request_id: requestId || null,
        organization_id: organizationId,
        title,
        deliverable_type: deliverableType,
        summary,
        status: "draft",
        created_by: getUserId(),
        uploaded_by: getUserId(),
      })
      .select("id")
      .single();

    if (error) return { ok: false, error: error.message };
    deliverableId = data.id;
  } else {
    const { error } = await supabaseClient
      .from("deliverables")
      .update({
        title,
        deliverable_type: deliverableType,
        summary,
        status: "draft",
        updated_at: new Date().toISOString(),
      })
      .eq("id", deliverableId);

    if (error) return { ok: false, error: error.message };
  }

  const versionNumber = await getNextDeliverableVersionNumber(deliverableId);
  const { data: version, error: versionError } = await supabaseClient
    .from("deliverable_versions")
    .insert({
      deliverable_id: deliverableId,
      request_id: requestId || null,
      organization_id: organizationId,
      version_number: versionNumber,
      status: "draft",
      summary,
      release_note: releaseNote,
      released_at: null,
      released_by: getUserId(),
      created_by: getUserId(),
    })
    .select("id")
    .single();

  if (versionError) return { ok: false, error: versionError.message };

  let uploaded = 0;
  for (const file of files) {
    const safeName = getSafeFileName(file.name);
    const storagePath = `clients/${organizationId}/deliverables/${deliverableId}/v${versionNumber}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabaseClient.storage.from("private-deliverables").upload(storagePath, file, {
      upsert: false,
      contentType: file.type || undefined,
    });

    if (uploadError) return { ok: false, error: getPartialUploadError(file.name, uploaded, files.length, uploadError.message), uploaded };

    const { error: fileError } = await supabaseClient.from("deliverable_version_files").insert({
      deliverable_version_id: version.id,
      deliverable_id: deliverableId,
      organization_id: organizationId,
      storage_bucket: "private-deliverables",
      storage_path: storagePath,
      file_name: file.name,
      content_type: file.type,
      file_size_bytes: file.size,
      uploaded_by: getUserId(),
    });

    if (fileError) return { ok: false, error: getPartialUploadError(file.name, uploaded, files.length, fileError.message), uploaded };
    uploaded += 1;
  }

  let creditResult = { ok: true, data: { balance: availableCredits } };
  if (creditsUsed > 0) {
    creditResult = await updateServerCreditLedger({
      organizationId,
      type: "consume",
      credits: creditsUsed,
      reason: `Released deliverable: ${title}`,
      requestId: requestId || null,
      recipientEmail: getClientEmail(selectedClient) || null,
      idempotencyKey: `admin-release-${organizationId}-${deliverableId}-${version.id}-${creditsUsed}`,
    });

    if (!creditResult.ok) {
      return { ok: false, error: creditResult.error || "Advisory Credits could not be recorded. Files remain in draft and were not released.", uploaded };
    }

    state.creditsLeft = Number(creditResult.data?.balance ?? state.creditsLeft);
    updateSelectedAdminClientCreditAccount(state.creditsLeft, creditResult.data?.lowCreditThreshold ?? state.creditThreshold);
  }

  const { error: deliverableUpdateError } = await supabaseClient
    .from("deliverables")
    .update({
      latest_version_id: version.id,
      current_version_number: versionNumber,
      status: "delivered",
      shipped_at: new Date().toISOString(),
      shipped_by: getUserId(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", deliverableId);

  if (deliverableUpdateError) {
    if (creditsUsed > 0) {
      await updateServerCreditLedger({
        organizationId,
        type: "adjust",
        credits: -creditsUsed,
        reason: `Credit reversal because release failed: ${title}`,
        requestId: requestId || null,
        recipientEmail: getClientEmail(selectedClient) || null,
        idempotencyKey: `admin-release-reversal-${organizationId}-${deliverableId}-${version.id}-${creditsUsed}`,
      });
    }
    return { ok: false, error: deliverableUpdateError.message, uploaded };
  }

  const { error: versionReleaseError } = await supabaseClient
    .from("deliverable_versions")
    .update({
      status: "released",
      released_at: new Date().toISOString(),
      released_by: getUserId(),
    })
    .eq("id", version.id);

  if (versionReleaseError) {
    if (creditsUsed > 0) {
      await updateServerCreditLedger({
        organizationId,
        type: "adjust",
        credits: -creditsUsed,
        reason: `Credit reversal because version release failed: ${title}`,
        requestId: requestId || null,
        recipientEmail: getClientEmail(selectedClient) || null,
        idempotencyKey: `admin-version-release-reversal-${organizationId}-${deliverableId}-${version.id}-${creditsUsed}`,
      });
    }
    return { ok: false, error: versionReleaseError.message, uploaded };
  }

  if (requestId) {
    await supabaseClient
      .from("requests")
      .update({
        status: "delivered",
        shipped_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId);
  }

  let notificationResult = { ok: true, data: { sent: false, queued: false } };
  if (notifyClient) {
    notificationResult = await fetchAdminApi("/api/deliverable-ready-notification", {
      method: "POST",
      body: {
        deliverableId,
        versionId: version.id,
      },
    });
  }

  return {
    ok: true,
    uploaded,
    creditsUsed,
    balance: creditsUsed > 0 ? Number(creditResult.data?.balance ?? state.creditsLeft) : availableCredits,
    deliverableId,
    versionId: version.id,
    notificationRequested: notifyClient,
    notificationQueued: notifyClient && notificationResult.ok && notificationResult.data?.queued === true,
    notificationSent: notifyClient && notificationResult.ok && notificationResult.data?.sent === true,
    notificationError: notificationResult.error,
  };
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

function renderRequests() {
  const rows = state.requests.length
    ? state.requests
        .map(
          (request) => `
        <tr>
          <td>${escapeHtml(request.id)}</td>
          <td>${escapeHtml(request.type)}</td>
          <td>${escapeHtml(request.status)}</td>
          <td>${escapeHtml(request.due)}</td>
        </tr>
      `
        )
        .join("")
    : `<tr><td colspan="4" class="empty-cell">No requests yet. Start a request when you are ready to send source material or ask for Business Analysis support.</td></tr>`;

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
        return `
        <tr>
          <td>${escapeHtml(item.client)}</td>
          <td>${escapeHtml(item.dueLabel || item.due || "Not dated")}</td>
          <td>
            <strong>${escapeHtml(item.id || "Request")}</strong>
            <span>${escapeHtml(item.type)}</span>
            <small>${escapeHtml(item.action)}</small>
          </td>
          <td>${escapeHtml(item.status)}</td>
          <td>
            <div class="table-actions">
              <a class="secondary small" href="${escapeHtml(getClientMailto({ email: item.clientEmail }, `Follow up on ${item.id || "request"}`))}" data-mailto="admin-row">Message</a>
              ${
                canUpload
                  ? `<button class="small" type="button" data-admin-action="prepare-upload" data-request-id="${escapeHtml(item.requestId)}" data-organization-id="${escapeHtml(item.organizationId)}">Upload</button>`
                  : ""
              }
              ${
                canDownload
                  ? `<button class="secondary small" type="button" data-download-source-file="${escapeHtml(item.fileId)}" data-source-kind="${escapeHtml(item.fileKind || "request_file")}">Download</button>`
                  : ""
              }
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

  state.requests.forEach((request) => {
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

  if (!state.deliverables.length) {
    list.innerHTML = `<div class="empty-cell">No completed deliverables have been released to this workspace yet.</div>`;
    return;
  }

  list.innerHTML = state.deliverables
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
              <button class="secondary small" type="button" data-download-file="${escapeHtml(version.fileId)}">Download</button>
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
                  <button class="secondary small" type="button" data-download-file="${escapeHtml(version.fileId)}">Download</button>
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
  const latest = [...state.deliverables].sort((a, b) => new Date(getDeliverableReleasedAt(b) || 0) - new Date(getDeliverableReleasedAt(a) || 0))[0];
  const newCount = state.deliverables.filter(isNewDeliverable).length;
  const reviewCount = state.deliverables.filter((deliverable) => getVerificationLevel(deliverable.verificationStatus) !== "approved").length;
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
    `<option value="workspace:">Workspace message</option>` +
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
    ...state.clientMessages.map((item) => ({ ...item, kind: "Message" })),
    ...state.clientUploads.map((item) => ({ ...item, kind: "Upload" })),
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
            <strong>${escapeHtml(entry.kind)} | ${escapeHtml(entry.contextLabel || "Workspace")}</strong>
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
  const adminCreditRows = state.adminCreditLedger.length
    ? state.adminCreditLedger
        .filter((item) => isSelectedAdminRecord(item, selectedClient))
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
        .filter((item) => isSelectedAdminRecord(item, selectedClient))
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
  if (auditTable) auditTable.innerHTML = adminAuditRows || auditRows;
}

function renderCreditControls() {
  if (state.adminClients.length && state.selectedAdminClientId) {
    syncSelectedAdminClientToState();
  }
  const used = Math.max(0, config.starterCredits - state.creditsLeft);
  const usageText = `${used} of ${config.starterCredits} used this cycle`;
  const usagePercent = Math.min(100, Math.round((used / config.starterCredits) * 100));
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
  const existingDeliverableSelect = document.querySelector("#adminExistingDeliverableSelect");
  const selectedClient = getSelectedAdminClient();
  const hasAdminClient = hasSelectedAdminClient();
  const selectedQueueItems = hasAdminClient ? getSelectedAdminQueueItems() : [];
  const selectedDeliverables = state.adminDeliverables.filter((deliverable) => isSelectedAdminRecord(deliverable, selectedClient));
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
  if (accountBalance) accountBalance.textContent = state.creditsLeft;
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
      (item) => item.queueType === "request" && isSelectedAdminRecord(item, selectedClient) && (item.requestId || item.id)
    ) : [];
    const source = deliverables.length ? deliverables : [];
    deliverableSelect.innerHTML = source
      .map((request) => {
        const value = request.requestId || request.id;
        const label = `${request.id || request.requestCode || value} - ${request.type || "Client request"}`;
        return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
      })
      .join("") || `<option value="">Select a client request</option>`;
  }
  const uploadClientId = uploadClientSelect?.value || state.selectedAdminClientId;
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
  if (uploadRequestSelect) {
    const selectedOrg = uploadClientSelect?.value || state.selectedAdminClientId;
    const requests = selectedOrg ? state.adminQueue.filter((item) => item.queueType === "request" && item.organizationId === selectedOrg) : [];
    uploadRequestSelect.innerHTML =
      `<option value="">No linked request</option>` +
      requests
        .map((request) => `<option value="${escapeHtml(request.requestId || request.id)}">${escapeHtml(request.id)} - ${escapeHtml(request.type)}</option>`)
        .join("");
  }
  if (existingDeliverableSelect) {
    const selectedOrg = uploadClientSelect?.value || state.selectedAdminClientId;
    const deliverables = selectedOrg ? state.adminDeliverables.filter((deliverable) => deliverable.organizationId === selectedOrg) : [];
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
  if (selectedCredits) selectedCredits.textContent = hasAdminClient ? state.creditsLeft : "0";
  if (selectedStatus) selectedStatus.textContent = hasAdminClient ? creditAlertState.summary : "No client selected";
  if (dueDeliverables) dueDeliverables.textContent = dueCount;
  if (pendingRequests) pendingRequests.textContent = pendingCount;
  if (shippedDeliverables) shippedDeliverables.textContent = shippedCount;
  if (pausedDeliverables) pausedDeliverables.textContent = pausedCount;
  [messageClient, queueMessageClient].forEach((link) => {
    if (!link) return;
    const clientEmail = getClientEmail(selectedClient);
    if (hasAdminClient && clientEmail) {
      link.href = getClientMailto(selectedClient, link === messageClient ? "BA Advisory Desk follow up" : "BA Advisory Desk request follow up");
      link.classList.remove("disabled");
      link.removeAttribute("aria-disabled");
    } else {
      link.href = "#";
      link.classList.add("disabled");
      link.setAttribute("aria-disabled", "true");
    }
  });
  if (adminAlertCount) adminAlertCount.textContent = creditAlertState.count;
  if (adminAlertSummary) adminAlertSummary.textContent = creditAlertState.summary;
  if (adminCreditAlertPanel) {
    adminCreditAlertPanel.classList.toggle("warning", creditAlertState.level === "low");
    adminCreditAlertPanel.classList.toggle("danger", creditAlertState.level === "depleted");
  }
  if (adminCreditAlertText) adminCreditAlertText.textContent = creditAlertState.message;
  if (deliveryCreditStatus) {
    deliveryCreditStatus.textContent =
      state.creditsLeft <= 0
        ? "Delivery is paused until credits are added."
        : `${state.creditsLeft} Advisory Credits available for the selected client.`;
    deliveryCreditStatus.classList.toggle("warning", state.creditsLeft <= state.creditThreshold);
  }
  updateAdminReleaseReadiness();
}

function updateAdminReleaseReadiness() {
  const status = document.querySelector("#adminDeliverableUploadStatus");
  const button = document.querySelector("#adminReleaseFilesButton");
  if (!status || !button) return;

  const organizationId = document.querySelector("#adminUploadClientSelect")?.value || state.selectedAdminClientId;
  const title = document.querySelector("#adminDeliverableTitle")?.value.trim();
  const creditsUsed = Math.max(0, Number(document.querySelector("#adminReleaseCreditsUsed")?.value || 0));
  const availableCredits = getAdminCreditBalanceForOrganization(organizationId);
  const files = getAdminUploadFiles();
  const validationError = validateWorkspaceFiles(files);

  let message = "Select a client and upload files when the deliverable is ready.";
  let ready = true;

  if (!organizationId) {
    message = "Step 1: select a client before releasing files.";
    ready = false;
  } else if (!title) {
    message = "Step 2: add a clear deliverable title.";
    ready = false;
  } else if (!files.length) {
    message = "Step 3: choose one or more deliverable files.";
    ready = false;
  } else if (validationError) {
    message = validationError;
    ready = false;
  } else if (creditsUsed > availableCredits) {
    message = `This client has ${availableCredits} Advisory Credit${availableCredits === 1 ? "" : "s"} available. Add credits or set credits to 0 only if this work is covered by a fixed scope.`;
    ready = false;
  } else {
    const creditText = creditsUsed > 0 ? ` ${creditsUsed} Advisory Credit${creditsUsed === 1 ? "" : "s"} will be recorded.` : " No Advisory Credits will be recorded.";
    message = `${files.length} file${files.length === 1 ? "" : "s"} ready to release to the selected client.${creditText}`;
  }

  status.textContent = message;
  status.classList.toggle("warning", !ready);
  status.classList.toggle("success", ready);
  button.disabled = !ready;
}

function render() {
  document.querySelector("#clientName").textContent = state.client.company || "Your organization";
  document.querySelector("#creditsLeft").textContent = state.creditsLeft;
  const billingCreditBalance = document.querySelector("#billingCreditBalance");
  if (billingCreditBalance) billingCreditBalance.textContent = state.creditsLeft;
  document.querySelector("#activeCount").textContent = state.requests.filter((request) => !isShippedStatus(request.status)).length;
  document.querySelector("#adminNewCount").textContent = state.adminNewCount || state.requests.filter((request) => request.status === "New").length;
  document.querySelector("#adminQuoteCount").textContent = state.quoteCount;
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
  const requestFiles = state.requestFiles.map((file) => ({
    ...file,
    source: "Request source",
  }));
  const uploads = state.clientUploads.map((file) => ({
    ...file,
    source: file.purpose || "Workspace upload",
  }));
  return [...requestFiles, ...uploads].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function getReleasedFileCount() {
  return state.deliverables.reduce((total, deliverable) => total + (deliverable.versions?.length || 0), 0);
}

function getLatestClientActivityLabel() {
  const candidates = [
    ...state.requests.map((item) => item.createdAt || item.due),
    ...state.deliverables.flatMap((deliverable) => deliverable.versions?.map((version) => version.uploadedAt) || []),
    ...state.clientMessages.map((item) => item.createdAt),
    ...state.clientUploads.map((item) => item.createdAt),
    ...state.requestFiles.map((item) => item.createdAt),
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
  const reviewCount = state.deliverables.filter((deliverable) => getVerificationLevel(deliverable.verificationStatus) !== "approved").length;
  if (!hasProfile) {
    return {
      title: "Complete your client profile",
      body: "Add company, role, timezone, and working context so your payments, requests, files, and deliverables stay connected.",
      href: "#profile",
      cta: "Complete Profile",
    };
  }
  if (state.creditsLeft <= 0 && !state.requests.length) {
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
  if (!state.requests.length) {
    return {
      title: "Start your first request",
      body: "Send the business goal, desired output, deadline, and supporting files so the advisory team can scope the work.",
      href: "#request",
      cta: "Start Request",
    };
  }
  if (reviewCount) {
    return {
      title: "Review released work",
      body: `${reviewCount} released deliverable${reviewCount === 1 ? "" : "s"} need your review, approval, or revision notes.`,
      href: "#dashboard",
      cta: "Review Work",
    };
  }
  if (state.creditsLeft <= state.creditThreshold) {
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
            <span>${escapeHtml(file.source)} | ${escapeHtml(file.contextLabel || "Workspace")} | ${escapeHtml(formatFileSize(file.fileSize))}</span>
            ${file.note ? `<small>${escapeHtml(file.note)}</small>` : ""}
          </div>
          <div class="file-row-actions">
            <small>${escapeHtml(formatDateTime(file.createdAt))}</small>
            ${
              file.fileId
                ? `<button class="secondary small" type="button" data-download-source-file="${escapeHtml(file.fileId)}" data-source-kind="${escapeHtml(file.fileKind || "request_file")}">Download</button>`
                : ""
            }
            ${
              file.fileId
                ? `<button class="secondary small danger-button" type="button" data-delete-source-file="${escapeHtml(file.fileId)}" data-source-kind="${escapeHtml(file.fileKind || "request_file")}">Delete</button>`
                : ""
            }
          </div>
        </article>
      `
    )
    .join("");
}

function getAdminOpenItemsForClient(client) {
  return state.adminQueue.filter((item) => isSelectedAdminRecord(item, client) && isPendingStatus(item.status));
}

function getAdminFilesForClient(client) {
  return [
    ...state.adminRequestFiles.map((file) => ({ ...file, source: "Request source" })),
    ...state.adminClientUploads
      .map((item) => ({
        id: item.requestId || item.id,
        fileId: item.fileId || item.id,
        fileKind: "client_upload",
        organizationId: item.organizationId,
        clientEmail: item.clientEmail,
        client: item.client,
        fileName: item.type,
        fileSize: item.fileSize || 0,
        source: "Client upload",
        contextLabel: item.dueLabel || "Workspace upload",
        status: item.status,
        createdAt: item.dueAt,
      })),
  ].filter((file) => isSelectedAdminRecord(file, client));
}

function getAdminMessagesForClient(client) {
  return state.adminQueue.filter((item) => ["client-message", "notification"].includes(item.queueType) && isSelectedAdminRecord(item, client));
}

function getAdminLastActivityForClient(client) {
  const values = [
    ...state.adminQueue.filter((item) => isSelectedAdminRecord(item, client)).map((item) => item.dueAt),
    ...state.adminDeliverables.filter((item) => isSelectedAdminRecord(item, client)).map((item) => item.updatedAt || item.createdAt),
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
  const alert = getCreditAlertState(Number(client.balance || 0), Number(client.lowCreditThreshold || config.lowCreditThreshold));
  if (alert.level === "depleted") return "Blocked";
  if (alert.level === "low") return "Needs top up";
  if (getAdminOpenItemsForClient(client).length) return "Active";
  return "Current";
}

function renderAdminSnapshot() {
  const clients = state.adminClients.filter((client) => client.id);
  const fileInbox = state.adminClientUploads.length + state.adminRequestFiles.length;
  const released = state.adminDeliverables.length;
  const lowCreditClients = clients.filter((client) => getCreditAlertState(Number(client.balance || 0), Number(client.lowCreditThreshold || config.lowCreditThreshold)).level !== "healthy").length;
  const openWork = state.adminQueue.filter((item) => isPendingStatus(item.status)).length;
  const activeClientCount = document.querySelector("#adminActiveClientCount");
  const openWorkCount = document.querySelector("#adminNewCount");
  const fileInboxCount = document.querySelector("#adminFileInboxCount");
  const readyCount = document.querySelector("#adminReadyCount");
  const alertCount = document.querySelector("#adminAlertCount");
  if (activeClientCount) activeClientCount.textContent = clients.length;
  if (openWorkCount) openWorkCount.textContent = openWork || state.adminNewCount || 0;
  if (fileInboxCount) fileInboxCount.textContent = fileInbox;
  if (readyCount) readyCount.textContent = released;
  if (alertCount) alertCount.textContent = lowCreditClients;
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
      return `
        <tr>
          <td>
            <strong>${escapeHtml(client.name || "Client workspace")}</strong>
            <span>${escapeHtml(getClientEmail(client) || "No email recorded")}</span>
            <button class="small secondary" type="button" data-admin-action="select-client" data-client-selection="${escapeHtml(client.selectionId || client.id)}">Open file</button>
          </td>
          <td>${escapeHtml(getAdminClientHealth(client))}</td>
          <td>${escapeHtml(client.balance ?? 0)}</td>
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
  const files = document.querySelector("#adminDossierFiles");
  const deliverables = document.querySelector("#adminDossierDeliverables");
  const messages = document.querySelector("#adminDossierMessages");
  if (!state.selectedAdminClientId) {
    const empty = `<p class="muted">Select a client to open their complete file.</p>`;
    if (profile) profile.innerHTML = empty;
    if (files) files.innerHTML = empty;
    if (deliverables) deliverables.innerHTML = empty;
    if (messages) messages.innerHTML = empty;
    return;
  }

  if (profile) {
    const profileRows = [
      ["Email", getClientEmail(client) || "Not recorded"],
      ["Workspace status", client.id ? "Client workspace active" : "Inquiry without workspace"],
      ["Industry", client.industry || "Not recorded"],
      ["Country", client.country || "Not recorded"],
      ["Time zone", client.timezone || "Not recorded"],
      ["Primary need", client.primaryBusinessNeed || "Not recorded"],
      ["Working style", client.workingStyle || "Not recorded"],
    ];
    profile.innerHTML = profileRows.map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join("");
  }

  if (files) {
    const fileRows = client.id ? getAdminFilesForClient(client) : [];
    files.innerHTML = fileRows.length
      ? fileRows
        .slice(0, 20)
        .map(
          (file) => `
              <p><strong>${escapeHtml(file.fileName || file.type || "Client file")}</strong><br />
              <span>${escapeHtml(file.source || "File")} | ${escapeHtml(file.contextLabel || file.status || "Received")} | ${escapeHtml(formatFileSize(file.fileSize))} | ${escapeHtml(formatDateTime(file.createdAt || file.dueAt))}</span>
              ${
                file.fileId
                  ? `<br /><button class="secondary small" type="button" data-download-source-file="${escapeHtml(file.fileId)}" data-source-kind="${escapeHtml(file.fileKind || "request_file")}">Download</button>`
                  : ""
              }</p>
            `
        )
          .join("")
      : `<p class="muted">${client.id ? "No client files are attached yet." : "Create or link a client workspace before file handling."}</p>`;
  }

  if (deliverables) {
    const rows = client.id ? state.adminDeliverables.filter((deliverable) => isSelectedAdminRecord(deliverable, client)) : [];
    deliverables.innerHTML = rows.length
      ? rows
          .slice(0, 8)
          .map((deliverable) => {
            const files = state.adminDeliverableFiles.filter((file) => file.deliverableId === deliverable.id);
            const fileHtml = files.length
              ? files
                  .slice(0, 5)
                  .map(
                    (file) => `<br /><button class="secondary small" type="button" data-download-file="${escapeHtml(file.fileId)}">${escapeHtml(file.fileName)} | Version ${escapeHtml(file.versionNumber || deliverable.currentVersion || 1)}</button>`
                  )
                  .join("")
              : `<br /><span class="muted">No file rows found for this deliverable.</span>`;
            return `<p><strong>${escapeHtml(deliverable.title)}</strong><br /><span>${escapeHtml(deliverable.type)} | Version ${escapeHtml(deliverable.currentVersion || 1)} | ${escapeHtml(deliverable.status)}</span>${fileHtml}</p>`;
          })
          .join("")
      : `<p class="muted">${client.id ? "No deliverables have been released yet." : "No deliverables can be released until a client workspace exists."}</p>`;
  }

  if (messages) {
    const rows = getAdminMessagesForClient(client);
    messages.innerHTML = rows.length
      ? rows
          .slice(0, 8)
          .map((message) => `<p><strong>${escapeHtml(message.type)}</strong><br /><span>${escapeHtml(message.action)} | ${escapeHtml(formatDateTime(message.dueAt))}</span></p>`)
          .join("")
      : `<p class="muted">No client messages need review.</p>`;
  }
}

function normalizeAdminQueueItem(item) {
  const organization = item.organization || item.organizations || item.account || {};
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
  return {
    queueType: "request",
    id: request.request_code || request.id || "Request",
    requestId: request.id || null,
    organizationId: request.organization_id || null,
    clientEmail: request.client_organizations?.billing_email || "",
    client:
      request.organization_name ||
      request.client_organizations?.name ||
      request.organization?.name ||
      (request.organization_id ? `Workspace ${String(request.organization_id).slice(0, 8)}` : "Client workspace"),
    type: request.request_type || request.request_code || "Client request",
    action: normalizeStatusValue(status) === "new" ? "Scope request" : "Review intake",
    status,
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
    client: quote.work_email || "Custom inquiry",
    type: `Custom quote${quote.company_type ? `: ${quote.company_type}` : ""}`,
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
    client: organization.name || (order.organization_id ? `Workspace ${String(order.organization_id).slice(0, 8)}` : isRescueSprint ? "One time client" : "Client workspace"),
    type: isRescueSprint ? "BA Rescue Sprint buyer" : productLabel(order.product_type),
    action: isRescueSprint ? "Open intake follow up" : "Review payment",
    status: order.status || "Pending",
    dueAt: order.created_at || null,
    dueLabel: isRescueSprint ? "Intake follow up" : formatDisplayDate(order.created_at),
  };
}

function normalizeNotification(notification) {
  return {
    queueType: "notification",
    id: notification.id || "Notification",
    requestId: notification.related_entity_id || notification.id || null,
    organizationId: notification.organization_id || null,
    clientEmail: notification.recipient_email || "",
    client: notification.recipient_email || "Client workspace",
    type: notification.subject || notification.template_key || "Notification",
    action: "Check notification",
    status: notification.status || "Queued",
    dueAt: notification.created_at || null,
    dueLabel: notification.sent_at ? `Sent ${formatDisplayDate(notification.sent_at)}` : "Queued",
  };
}

function normalizeAdminClientMessage(message) {
  const organization = message.client_organizations || {};
  return {
    queueType: "client-message",
    id: message.id || "Client message",
    requestId: message.request_id || message.deliverable_id || message.id || null,
    organizationId: message.organization_id || null,
    clientEmail: organization.billing_email || "",
    client: organization.name || (message.organization_id ? `Workspace ${String(message.organization_id).slice(0, 8)}` : "Client workspace"),
    type: message.subject || "Client workspace message",
    action: "Review and respond",
    status: message.status || "Received",
    dueAt: message.created_at || null,
    dueLabel: "Client message",
  };
}

function normalizeAdminClientUpload(upload) {
  const organization = upload.client_organizations || {};
  return {
    queueType: "client-upload",
    id: upload.id || "Client upload",
    fileId: upload.id || "",
    fileKind: "client_upload",
    requestId: upload.request_id || upload.deliverable_id || upload.id || null,
    organizationId: upload.organization_id || null,
    clientEmail: organization.billing_email || "",
    client: organization.name || (upload.organization_id ? `Workspace ${String(upload.organization_id).slice(0, 8)}` : "Client workspace"),
    type: upload.original_file_name || upload.upload_type || "Client upload",
    fileName: upload.original_file_name || upload.upload_type || "Client upload",
    fileSize: upload.file_size_bytes || 0,
    source: "Client upload",
    action: "Review uploaded file",
    status: upload.status || "Received",
    dueAt: upload.created_at || null,
    dueLabel: upload.upload_type || "Client upload",
  };
}

function normalizeAdminRequestFile(file) {
  const organization = file.client_organizations || {};
  const request = file.requests || {};
  return {
    queueType: "request-file",
    id: file.id || "Request file",
    fileId: file.id || "",
    fileKind: "request_file",
    requestId: file.request_id || null,
    organizationId: file.organization_id || null,
    clientEmail: organization.billing_email || "",
    client: organization.name || (file.organization_id ? `Workspace ${String(file.organization_id).slice(0, 8)}` : "Client workspace"),
    fileName: file.file_name || "Request source file",
    type: file.file_name || "Request source file",
    source: "Request source",
    contextLabel: request.request_code || request.request_type || "Request source file",
    status: "Received",
    dueAt: file.created_at || null,
    dueLabel: "Request source file",
    createdAt: file.created_at || null,
  };
}

function applyAdminQueueData(data) {
  const requests = data.requests || [];
  const quoteItems = data.quotes || data.customQuoteRequests || [];
  const paymentOrders = data.paymentOrders || [];
  const notifications = data.notifications || [];
  const clientMessages = data.clientMessages || [];
  const clientUploads = data.clientUploads || [];
  const requestFiles = data.requestFiles || [];
  const deliverableFiles = data.deliverableFiles || [];
  const clientProfiles = data.clientProfiles || [];
  const profileByOrganization = new Map(
    clientProfiles
      .filter((profile) => profile.organization_id)
      .map((profile) => [profile.organization_id, profile])
  );
  const fallbackItems = data.items || data.queue || data.adminQueue || [];
  const normalizedItems = [
    ...quoteItems.map(normalizeCustomQuoteRequest),
    ...requests.map(normalizeAdminRequest),
    ...clientMessages.map(normalizeAdminClientMessage),
    ...clientUploads.map(normalizeAdminClientUpload),
    ...requestFiles.map(normalizeAdminRequestFile),
    ...paymentOrders.map(normalizePaymentOrder),
    ...notifications.map(normalizeNotification),
    ...fallbackItems.map(normalizeAdminQueueItem),
  ].slice(0, 100);
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
        (id ? `Workspace ${String(id).slice(0, 8)}` : "Client workspace"),
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
      balance: Number(account.balance ?? account.credit_balance ?? state.creditsLeft),
      lowCreditThreshold: Number(account.low_credit_threshold ?? account.lowCreditThreshold ?? state.creditThreshold),
      status: account.status || organization.status || "active",
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
      balance: Number(item.organizationId ? state.creditsLeft : 0),
      lowCreditThreshold: state.creditThreshold,
      status: item.organizationId ? "active" : "intake follow up",
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
      balance: Number(file.organizationId ? state.creditsLeft : 0),
      lowCreditThreshold: state.creditThreshold,
      status: "active",
    });
  });
  (data.deliverables || []).forEach((deliverable) => {
    const key = deliverable.organization_id || `deliverable-${adminClientMap.size}`;
    if (!deliverable.organization_id || adminClientMap.has(key)) return;
    adminClientMap.set(key, {
      id: deliverable.organization_id,
      selectionId: deliverable.organization_id,
      name: `Workspace ${String(deliverable.organization_id).slice(0, 8)}`,
      email: "",
      balance: Number(state.creditsLeft || 0),
      lowCreditThreshold: state.creditThreshold,
      status: "active",
    });
  });
  clientProfiles.forEach((profile) => {
    const id = profile.organization_id || "";
    if (!id || adminClientMap.has(id)) return;
    const organization = profile.client_organizations || {};
    adminClientMap.set(id, {
      id,
      selectionId: id,
      name: organization.name || profile.work_email || `Workspace ${String(id).slice(0, 8)}`,
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
    });
  });
  state.adminClients = Array.from(adminClientMap.values());
  if (state.selectedAdminClientId) {
    const stillValid = state.adminClients.some(
      (client) => client.selectionId === state.selectedAdminClientId || client.id === state.selectedAdminClientId
    );
    if (!stillValid) {
      state.selectedAdminClientId = "";
    }
  }

  if (creditAccounts.length && state.selectedAdminClientId) {
    const creditAccount =
      creditAccounts.find((account) => account.organization_id === state.selectedAdminClientId) ||
      creditAccounts.find((account) => account.id === state.selectedAdminClientId);
    if (creditAccount) {
      state.creditsLeft = Number(creditAccount.balance ?? state.creditsLeft);
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
  if (data.paymentHistory || data.payments) {
    state.paymentHistory = state.adminPaymentHistory.slice(0, 20);
  }

  const creditLedger = data.creditLedger || data.creditHistory || data.ledger || [];
  state.adminCreditLedger = creditLedger.slice(0, 30).map((entry) => ({
    organizationId: entry.organization_id || entry.organizationId || null,
    rawDate: entry.created_at || entry.date || null,
    date: formatDisplayDate(entry.created_at || entry.date),
    deliverable: entry.deliverable || entry.action || entry.reason || entry.entry_reason || entry.entry_type || "Credit activity",
    credits: entry.credits ?? entry.delta ?? entry.credit_delta ?? "Recorded",
    balance: entry.balance ?? entry.balance_after ?? state.creditsLeft,
  }));
  if (data.creditHistory || data.ledger) {
    state.creditHistory = state.adminCreditLedger.slice(0, 20);
  }

  const auditEvents = data.auditEvents || [];
  state.adminAuditEvents = auditEvents.slice(0, 30).map((entry) => ({
    organizationId: entry.organization_id || null,
    date: formatDisplayDate(entry.created_at),
    event: entry.event || entry.event_type || "Audit event",
    client: entry.client_organizations?.name || (entry.organization_id ? `Workspace ${String(entry.organization_id).slice(0, 8)}` : "Client workspace"),
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
  const result = await fetchAdminApi("/api/admin-queue?limit=100");

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
  setPendingPostAuthRoute("dashboard");
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
  window.location.hash = isAdmin ? "admin" : organizationId ? "dashboard" : "profile";
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
  await notifyAdvisorEvent({
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
      const response = await fetch("/api/create-checkout-session", {
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
      });
      const data = await response.json();
      if (response.ok && data.url) {
        clearPendingCheckoutType();
        window.location.href = data.url;
        return true;
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
    syncSelectedAdminClientToState();
    saveState();
    render();
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-admin-action]");
  if (!target) return;
  const lockedAdminActions = new Set(["save-credit-settings", "ship-deliverable", "upload-deliverable"]);
  const shouldLockAction = lockedAdminActions.has(target.dataset.adminAction);
  if (shouldLockAction && target.dataset.busy === "true") return;
  if (shouldLockAction) {
    target.dataset.busy = "true";
    target.disabled = true;
  }

  try {

  if (target.dataset.adminAction === "select-client") {
    const selectionId = target.dataset.clientSelection || "";
    if (!selectionId) {
      showToast("Client workspace could not be selected.");
      return;
    }
    state.selectedAdminClientId = selectionId;
    syncSelectedAdminClientToState();
    saveState();
    render();
    document.querySelector("#adminSelectedClientName")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    if (!organizationId) {
      showToast("Select a client before uploading a deliverable.");
      return;
    }
    if (organizationId) {
      state.selectedAdminClientId = organizationId;
      syncSelectedAdminClientToState();
      render();
    }
    const uploadClientSelect = document.querySelector("#adminUploadClientSelect");
    const uploadRequestSelect = document.querySelector("#adminUploadRequestSelect");
    if (uploadClientSelect && organizationId) uploadClientSelect.value = organizationId;
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
    const targetBalance = Math.max(0, balance + adjustment);
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
    const creditsUsed = Math.max(0, Number(document.querySelector("#adminCreditsUsed").value || 0));
    const selectedClient = getSelectedAdminClient();
    const adminItem = state.adminQueue.find(
      (item) =>
        item.queueType === "request" &&
        isSelectedAdminRecord(item, selectedClient) &&
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

    if (creditsUsed > state.creditsLeft) {
      const pausedStatus = "Paused, awaiting credits";
      if (supabaseClient && adminItem?.requestId && adminItem?.organizationId) {
        await supabaseClient
          .from("requests")
          .update({
            status: toRequestStorageStatus(pausedStatus),
            updated_at: new Date().toISOString(),
          })
          .eq("id", adminItem.requestId)
          .eq("organization_id", adminItem.organizationId);
      }
      if (request) {
        request.status = pausedStatus;
      }
      if (adminItem) {
        adminItem.status = pausedStatus;
      }
      addAuditEvent("Delivery paused", `${request?.id || adminItem.id} paused because the selected client does not have enough Advisory Credits.`);
      saveState();
      render();
      showToast("Delivery paused until credits are added.");
      return;
    }

    if (adminItem && creditsUsed > 0 && isShippedStatus(adminItem.status)) {
      showToast("Credits already appear to be recorded for this item. Use 0 credits for later status changes.");
      return;
    }

    if (adminItem?.organizationId && creditsUsed > 0) {
      const result = await updateServerCreditLedger({
        organizationId: adminItem.organizationId,
        type: "consume",
        credits: creditsUsed,
        reason: `${status}: ${request?.type || adminItem.type}`,
        requestId: adminItem.requestId || null,
        recipientEmail: adminItem.clientEmail || null,
        idempotencyKey: `admin-delivery-${adminItem.organizationId}-${adminItem.requestId || adminItem.id}-${status}-${creditsUsed}`,
      });

      if (!result.ok) {
        showToast(result.error || "Deliverable credits could not be updated.");
        return;
      }

      state.creditsLeft = Number(result.data.balance ?? state.creditsLeft);
    }

    const displayStatus = status === "Delivered" || status === "Completed" || status === "Completed and shipped" ? "Complete" : status;
    if (supabaseClient && adminItem?.requestId && adminItem?.organizationId) {
      const { error: statusUpdateError } = await supabaseClient
        .from("requests")
        .update({
          status: toRequestStorageStatus(displayStatus),
          shipped_at: isShippedStatus(displayStatus) ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", adminItem.requestId)
        .eq("organization_id", adminItem.organizationId);

      if (statusUpdateError) {
        showToast(statusUpdateError.message || "Request status could not be saved.");
        return;
      }
    }

    if (request) {
      request.status = displayStatus;
    }
    if (adminItem) {
      adminItem.status = displayStatus;
    }
    if (creditsUsed > 0 && !adminItem?.organizationId) {
      state.creditsLeft = Math.max(0, state.creditsLeft - creditsUsed);
      addCreditHistory(request?.type || adminItem.type, `-${creditsUsed} consumed`, state.creditsLeft);
    }
    updateSelectedAdminClientCreditAccount(state.creditsLeft, state.creditThreshold);
    addAuditEvent("Deliverable status updated", `${request?.id || adminItem.id} set to ${status}. Credits used: ${creditsUsed}.`);
    saveState();
    render();
    showToast("Deliverable status and credit usage updated.");
  }

  if (target.dataset.adminAction === "upload-deliverable") {
    const status = document.querySelector("#adminDeliverableUploadStatus");
    if (status) {
      status.textContent = "Uploading deliverable files and preparing the client release.";
      status.classList.remove("warning", "success");
    }

    const result = await uploadAdminDeliverable();
    if (!result.ok) {
      if (status) {
        status.textContent = result.error || "Deliverable could not be uploaded.";
        status.classList.add("warning");
      }
      showToast(result.error || "Deliverable could not be uploaded.");
      return;
    }

    if (status) {
      const fileText = `${result.uploaded} file${result.uploaded === 1 ? "" : "s"} released`;
      const creditText = result.creditsUsed > 0 ? ` ${result.creditsUsed} Advisory Credit${result.creditsUsed === 1 ? "" : "s"} recorded.` : " No Advisory Credits were recorded for this release.";
      if (!result.notificationRequested) {
        status.textContent = `Deliverable uploaded. ${fileText}.${creditText} Client notification was not selected.`;
      } else if (result.notificationSent) {
        status.textContent = `Deliverable uploaded. ${fileText}.${creditText} Client notification sent.`;
      } else if (result.notificationQueued) {
        status.textContent = `Deliverable uploaded. ${fileText}.${creditText} Client notification is queued and needs email service review.`;
      } else {
        status.textContent = `Deliverable uploaded. ${fileText}.${creditText} Client notification needs review.`;
      }
      status.classList.toggle("warning", result.notificationRequested && !result.notificationSent);
      status.classList.toggle("success", !result.notificationRequested || result.notificationSent);
    }

    const fileInput = document.querySelector("#adminDeliverableFiles");
    const fileList = document.querySelector("#adminDeliverableFileList");
    if (fileInput) fileInput.value = "";
    if (fileList) fileList.textContent = "No deliverable files selected yet.";
    await loadAdminQueue();
    saveState();
    render();
    showToast("Deliverable uploaded to the client workspace.");
  }
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
    body: { fileId },
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
    body: { fileId, fileKind },
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

  const confirmed = window.confirm("Delete this uploaded file from your workspace? This cannot be undone.");
  if (!confirmed) return;

  setButtonBusy(target, true, "Deleting");
  const result = await fetchClientApi("/api/source-file-download-url", {
    method: "POST",
    body: { fileId, fileKind, action: "delete" },
  });
  setButtonBusy(target, false);

  if (!result.ok || !result.data?.deleted) {
    showPersistentNotice(result.error || "File could not be deleted.");
    return;
  }

  state.requestFiles = state.requestFiles.filter((file) => !(file.fileId === fileId && file.fileKind === fileKind));
  state.clientUploads = state.clientUploads.filter((file) => !(file.fileId === fileId && file.fileKind === fileKind));
  saveState();
  await loadClientWorkspaceData();
  render();
  showToast("File deleted from the workspace.");
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
  const focusTarget = action === "upload" ? document.querySelector("#clientUploadFiles") : document.querySelector("#clientMessageBody");
  focusTarget?.focus();
});

document.querySelector("#clientMessageForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#clientMessageStatus");
  if (status) {
    status.textContent = "Sending your message.";
    status.classList.remove("warning", "success");
  }
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
    status.textContent = result.advisorNotified
      ? "Message sent, attached, and shared with the advisory team."
      : result.storedOnline
        ? "Message sent and attached to the selected item. The advisory team will review it in the workspace."
        : "Message saved in this workspace.";
    status.classList.add("success");
  }
  render();
  showToast("Message added to the client workspace.");
});

document.querySelector("#clientUploadForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = event.submitter || document.querySelector("#clientUploadForm button[type='submit']");
  if (submitButton?.dataset.busy === "true") return;
  const status = document.querySelector("#clientUploadStatus");
  if (status) {
    status.textContent = "Uploading client files.";
    status.classList.remove("warning", "success");
  }
  setButtonBusy(submitButton, true, "Uploading Files");
  try {
    const result = await saveClientUpload();
    if (!result.ok) {
      if (status) {
        status.textContent = result.error || "Files could not be uploaded.";
        status.classList.add("warning");
      }
      showToast(result.error || "Files could not be uploaded.");
      return;
    }
    document.querySelector("#clientUploadFiles").value = "";
    document.querySelector("#clientUploadNotes").value = "";
    document.querySelector("#clientUploadFileList").textContent = "No files selected yet.";
    if (status) {
      const fileText = `${result.uploaded} file${result.uploaded === 1 ? "" : "s"}`;
      status.textContent = result.advisorNotified
        ? `${fileText} uploaded, attached, and shared with the advisory team.`
        : result.storedOnline
          ? `${fileText} uploaded and attached. The advisory team will review the workspace.`
          : `${fileText} recorded in this workspace.`;
      status.classList.add("success");
    }
    render();
    showToast("Client upload added to the workspace.");
  } finally {
    setButtonBusy(submitButton, false);
  }
});

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
    const businessGoal = document.querySelector("#businessGoal").value.trim();
    const targetAudience = document.querySelector("#targetAudience").value.trim();
    const desiredOutput = document.querySelector("#desiredOutput")?.value.trim() || "";
    const decisionDeadline = document.querySelector("#decisionDeadline")?.value || "";
    const attachmentDescription = document.querySelector("#attachmentDescription").value.trim();
    if (selectedType === "Other" && !otherType) {
      warn("Please describe the Business Analysis deliverable you need.");
      return;
    }
    if (!businessGoal || !targetAudience || !desiredOutput || !decisionDeadline || !attachmentDescription) {
      warn("Please complete the business goal, target audience, desired output, deadline, and attachment description before submitting.");
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const chosenDeadline = new Date(`${decisionDeadline}T00:00:00`);
    if (Number.isNaN(chosenDeadline.getTime()) || chosenDeadline < today) {
      warn("Please choose today or a future date for the deadline or decision date.");
      return;
    }

    const requestFiles = Array.from(document.querySelector("#fileUpload")?.files || []);
    if (!requestFiles.length) {
      warn("Please attach at least one source file before submitting. This can be a PDF, Word, Excel, PowerPoint, PNG, or JPG file.");
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
        const fallbackBalance = Number(state.creditsLeft || 0);
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

    const request = {
      id: generateRequestCode(),
      type: selectedType === "Other" && otherType ? otherType : selectedType,
      status: "Pending scope",
      due: formatDisplayDate(decisionDeadline),
      client: state.client.company,
      createdAt: getIsoNow(),
    };
    const requestPayload = {
      request_code: request.id,
      organization_id: organizationId,
      submitted_by: userId,
      request_type: request.type,
      business_goal: businessGoal,
      target_audience: targetAudience,
      attachment_description: `${attachmentDescription}\n\nDesired output: ${desiredOutput}\nDecision date: ${decisionDeadline}`,
      status: "pending_scope",
      credits_estimated: requestedCredits,
      due_at: decisionDeadline || null,
    };

    setInlineStatus(statusSelector, `Creating your request and preparing ${requestFiles.length} file${requestFiles.length === 1 ? "" : "s"} for upload.`);

    let result;
    let savedRequestId = null;
    if (supabaseClient) {
      const { data, error } = await supabaseClient.from("requests").insert(requestPayload).select("id").single();
      result = error ? { ok: false, reason: error.message } : { ok: true };
      savedRequestId = data?.id || null;
    } else {
      result = await writeToSupabase("requests", requestPayload);
    }

    if (!result.ok) {
      warn(result.reason || `Request could not be submitted. Please try again or contact ${config.supportEmail}.`);
      return;
    }

    setInlineStatus(statusSelector, `Request created. Uploading ${requestFiles.length} file${requestFiles.length === 1 ? "" : "s"}.`);
    const uploadResult = await uploadRequestFiles(savedRequestId, organizationId);
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
        .from("requests")
        .update({
          status: "file_upload_attention",
          updated_at: new Date().toISOString(),
        })
        .eq("id", savedRequestId)
        .then(() => null, () => null);
      request.status = "File upload needs attention";
    }
    await loadClientWorkspaceData();
    await notifyAdvisorEvent({
      eventType: "client_request_submitted",
      title: "New client request submitted",
      summary: `${request.id}: ${request.type}. Desired output: ${desiredOutput}. Deadline: ${decisionDeadline}. Files uploaded: ${uploadResult.uploaded}.`,
      relatedEntityType: "request",
      relatedEntityId: savedRequestId,
      relatedLabel: request.id,
    });
    if (!uploadResult.ok) {
      const uploadAttentionMessage = `Request ${request.id} was created, but the file upload needs attention. Please open Messages and Files, choose ${request.id}, and attach the remaining files there. ${uploadResult.reason || ""}`.trim();
      setInlineStatus(statusSelector, uploadAttentionMessage, "warning");
      showPersistentNotice(uploadAttentionMessage);
      render();
      return;
    }

    const successMessage = `Request received. ${uploadResult.uploaded} file${uploadResult.uploaded === 1 ? "" : "s"} uploaded and attached to your workspace.`;
    setInlineStatus(statusSelector, successMessage, "success");
    showToast(successMessage);
    window.location.hash = "dashboard";
  } catch (error) {
    warn(error.message || `Request could not be submitted. Please try again or contact ${config.supportEmail}.`);
  } finally {
    setButtonBusy(submitButton, false);
  }
});

document.querySelector("#quoteForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const quoteStatus = document.querySelector("#quoteStatus");
  if (quoteStatus) {
    quoteStatus.textContent = "Sending your custom advisory request.";
    quoteStatus.classList.remove("warning", "success");
  }
  const organizationId = await getProfileOrganizationId();
  const workEmail = (document.querySelector("#quoteEmail").value || state.client.email || getUserEmail()).trim();
  const companyType = document.querySelector("#quoteCompanyType").value;
  const otherCompanyType = document.querySelector("#quoteOtherCompanyType").value.trim();
  const country = document.querySelector("#quoteCountry").value;
  const budget = document.querySelector("#quoteBudget").value;
  const summary = document.querySelector("#quoteSummary").value.trim();
  if (!companyType || (companyType === "Other" && !otherCompanyType) || !country || !workEmail || !budget || summary.length < 25) {
    const message = "Please complete company type, country, work email, budget range, and a clear request summary before sending.";
    if (quoteStatus) {
      quoteStatus.textContent = message;
      quoteStatus.classList.add("warning");
    }
    showToast(message);
    return;
  }

  const result = await fetchPublicApi("/api/custom-quote", {
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
  showToast(result.ok ? successMessage : errorMessage);
  if (result.ok) {
    addAuditEvent("Custom quote requested", summary.slice(0, 100));
    saveState();
  }
});

document.querySelector("#profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
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
      showToast("Client profile saved. Your workspace is ready.");
    }
  } else {
    showPersistentNotice(orgResult.reason || `Client profile could not be saved. Please try again or contact ${config.supportEmail}.`);
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

document.querySelector("#quoteCompanyType").addEventListener("change", () => {
  toggleOther("#quoteCompanyType", "#quoteOtherWrap");
});

document.querySelector("#fileUpload").addEventListener("change", (event) => {
  const files = Array.from(event.target.files || []);
  const list = document.querySelector("#fileList");
  if (!files.length) {
    list.textContent = "No files selected yet.";
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
    return;
  }
  const validationError = validateWorkspaceFiles(files);
  list.innerHTML = files
    .map((file) => `<div><strong>${escapeHtml(file.name)}</strong> <span>${escapeHtml(formatFileSize(file.size))}</span></div>`)
    .join("");
  if (validationError) {
    list.innerHTML = `<div class="file-warning">${escapeHtml(validationError)}</div>${list.innerHTML}`;
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
