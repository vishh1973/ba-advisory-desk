const config = {
  domain: "baadvisorydesk.com",
  adminEmail: "vishh1973@gmail.com",
  supportEmail: "support@baadvisorydesk.com",
  maxFileSizeMb: 50,
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
  creditsLeft: Number(localStorage.getItem("baad-credits") || config.starterCredits),
  creditThreshold: Number(localStorage.getItem("baad-credit-threshold") || config.lowCreditThreshold),
  creditHistory: JSON.parse(localStorage.getItem("baad-credit-history") || "null") || [],
  paymentHistory: JSON.parse(localStorage.getItem("baad-payment-history") || "null") || [],
  auditEvents: JSON.parse(localStorage.getItem("baad-audit-events") || "null") || [],
  deliverables: JSON.parse(localStorage.getItem("baad-deliverables") || "null") || [],
  adminDeliverables: [],
  session: null,
  adminQueue: [],
  adminClients: [],
  selectedAdminClientId: localStorage.getItem("baad-admin-client-id") || "",
  adminNewCount: 0,
  quoteCount: 0,
};

const views = {
  home: document.querySelector("#view-home"),
  about: document.querySelector("#view-about"),
  services: document.querySelector("#view-services"),
  samples: document.querySelector("#view-samples"),
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

function saveState() {
  localStorage.setItem("baad-client", JSON.stringify(state.client));
  localStorage.setItem("baad-requests", JSON.stringify(state.requests));
  localStorage.setItem("baad-credits", String(state.creditsLeft));
  localStorage.setItem("baad-credit-threshold", String(state.creditThreshold));
  localStorage.setItem("baad-credit-history", JSON.stringify(state.creditHistory));
  localStorage.setItem("baad-payment-history", JSON.stringify(state.paymentHistory));
  localStorage.setItem("baad-audit-events", JSON.stringify(state.auditEvents));
  localStorage.setItem("baad-deliverables", JSON.stringify(state.deliverables));
  localStorage.setItem("baad-admin-client-id", state.selectedAdminClientId || "");
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 3200);
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

function getSelectedAdminClient() {
  return (
    state.adminClients.find((client) => client.id === state.selectedAdminClientId) ||
    state.adminClients[0] ||
    {
      id: "",
      name: state.client.company || "Client workspace",
      balance: state.creditsLeft,
      lowCreditThreshold: state.creditThreshold,
    }
  );
}

function syncSelectedAdminClientToState() {
  const client = getSelectedAdminClient();
  state.selectedAdminClientId = client.id || "";
  state.creditsLeft = Number(client.balance ?? state.creditsLeft);
  state.creditThreshold = Number(client.lowCreditThreshold ?? state.creditThreshold);
}

function updateSelectedAdminClientCreditAccount(balance, lowCreditThreshold) {
  const client = getSelectedAdminClient();
  if (!state.adminClients.length) return;
  client.balance = balance;
  client.lowCreditThreshold = lowCreditThreshold;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getLowCreditMessage() {
  return getCreditAlertState().message;
}

function getCreditPromptHtml() {
  if (state.creditsLeft <= 0) {
    return `No Advisory Credits remain. <a href="#billing" data-action="buy-topup">Add a Credit Top Up</a> to restart paused deliverables.`;
  }
  if (state.creditsLeft <= state.creditThreshold) {
    return `${state.creditsLeft} Advisory Credits remain. <a href="#billing" data-action="buy-topup">Add a Credit Top Up</a> before the next deliverable is scoped.`;
  }
  return "Your workspace has enough Advisory Credits for the current delivery cycle.";
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

function getAuthRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

function getNormalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
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
  }[provider] || "your identity provider";
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
  const route = isAdminUser() ? "admin" : pendingRoute;
  localStorage.removeItem("baad-post-auth-route");
  if (route && window.location.hash.replace("#", "") !== route) {
    window.location.hash = route;
  }
}

function getAuthErrorMessage() {
  const params = new URLSearchParams(window.location.search);
  const hashValue = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const hashParams = new URLSearchParams(hashValue);
  const error = params.get("error_description") || params.get("error") || hashParams.get("error_description") || hashParams.get("error");
  return error ? decodeURIComponent(error).replace(/\+/g, " ") : "";
}

function isAdminUser() {
  return Boolean(
    getUserEmail() &&
      config.adminEmail &&
      getNormalizedEmail(getUserEmail()) === getNormalizedEmail(config.adminEmail)
  );
}

function setAuthStatus(message) {
  const status = document.querySelector("#authStatus");
  if (status) status.textContent = message;
}

function updateAuthUi() {
  const isSignedIn = Boolean(state.session?.user);
  const loginButton = document.querySelector("#loginButton");
  const signOutButton = document.querySelector("#signOutButton");
  const providerButtons = document.querySelectorAll("[data-provider]");

  if (loginButton) {
    loginButton.textContent = isSignedIn ? "Go To Dashboard" : "Continue With Google";
  }

  providerButtons.forEach((button) => button.classList.toggle("hidden", isSignedIn));

  if (signOutButton) {
    signOutButton.classList.toggle("hidden", !isSignedIn);
  }

  if (isSignedIn) {
    state.client.email = getUserEmail() || state.client.email;
    saveState();
    setAuthStatus(isAdminUser() ? `Signed in as ${state.client.email}. Admin access is available.` : `Signed in as ${state.client.email}.`);
  } else {
    setAuthStatus("Continue with Google or Apple to access your client workspace.");
  }
}

async function initAuth() {
  if (!supabaseClient) {
    setAuthStatus("Continue with Google or Apple to access your client workspace.");
    return;
  }

  const { data } = await supabaseClient.auth.getSession();
  state.session = data.session;
  if (state.session?.user) {
    await loadSignedInProfile();
    await loadClientWorkspaceData();
    applyPendingPostAuthRoute();
  }
  updateAuthUi();

  const authError = getAuthErrorMessage();
  if (authError) {
    setAuthStatus(`Sign in could not be completed: ${authError}`);
  }

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    updateAuthUi();
    if (session?.user) {
      await loadSignedInProfile();
      await loadClientWorkspaceData();
      applyPendingPostAuthRoute();
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
    return response.ok ? { ok: true, data } : { ok: false, error: data.error || "The admin request could not be completed." };
  } catch (error) {
    return { ok: false, error: error.message || "The admin request could not be completed." };
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
    return response.ok ? { ok: true, data } : { ok: false, error: data.error || "The secure workspace request could not be completed." };
  } catch (error) {
    return { ok: false, error: error.message || "The secure workspace request could not be completed." };
  }
}

async function updateServerCreditLedger(payload) {
  return fetchAdminApi("/api/ledger", {
    method: "POST",
    body: payload,
  });
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

  setFieldValue("#profileFirstName", profile.first_name || firstName);
  setFieldValue("#profileLastName", profile.last_name || lastName);
  setFieldValue("#profileEmail", state.client.email);
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
  if (!supabaseClient || !getUserId()) return null;

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("organization_id")
    .eq("id", getUserId())
    .maybeSingle();

  if (error) return null;
  return data?.organization_id || null;
}

async function loadClientWorkspaceData() {
  if (!supabaseClient || !getUserId()) return;

  const organizationId = await getProfileOrganizationId();
  if (!organizationId) return;

  try {
    const [creditResult, ledgerResult, paymentResult, requestResult, deliverableResult] = await Promise.all([
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
    ]);

    if (creditResult.data) {
      state.creditsLeft = Number(creditResult.data.balance ?? state.creditsLeft);
      state.creditThreshold = Number(creditResult.data.low_credit_threshold ?? state.creditThreshold);
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
      state.paymentHistory = paymentResult.data.map((item) => ({
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

    saveState();
  } catch (_error) {
    // The local browser state remains usable if the hosted data read is not available.
  }
}

async function writeToSupabase(table, payload) {
  if (!supabaseClient) {
    return { ok: false, reason: "The secure workspace is not available yet." };
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

  const { data: organizationId, error } = await supabaseClient.rpc("save_client_workspace_profile", {
    p_org_name: document.querySelector("#profileCompany").value,
    p_industry: document.querySelector("#profileIndustry").value,
    p_country: document.querySelector("#profileCountry").value,
    p_timezone: document.querySelector("#profileTimezone").value,
    p_company_type: document.querySelector("#profileIndustry").value,
    p_billing_email: document.querySelector("#profileEmail").value || state.client.email || getUserEmail(),
    p_first_name: document.querySelector("#profileFirstName").value,
    p_last_name: document.querySelector("#profileLastName").value,
    p_work_email: document.querySelector("#profileEmail").value || getUserEmail(),
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

  let uploaded = 0;
  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${userId}/${requestId}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabaseClient.storage.from("client-files").upload(storagePath, file, {
      upsert: false,
    });

    if (uploadError) {
      return { ok: false, reason: uploadError.message, uploaded };
    }

    const { error: fileRecordError } = await supabaseClient.from("request_files").insert({
      request_id: requestId,
      organization_id: organizationId,
      storage_path: storagePath,
      file_name: file.name,
      file_size_bytes: file.size,
      mime_type: file.type,
      uploaded_by: userId,
    });

    if (fileRecordError) {
      return { ok: false, reason: fileRecordError.message, uploaded };
    }

    uploaded += 1;
  }

  return { ok: true, uploaded };
}

function getAdminUploadFiles() {
  return Array.from(document.querySelector("#adminDeliverableFiles")?.files || []);
}

function getSafeFileName(name) {
  return String(name || "deliverable-file").replace(/[^a-zA-Z0-9._-]/g, "_");
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
  if (!supabaseClient || !isAdminUser()) {
    return { ok: false, error: "Please sign in with the administrator email before uploading deliverables." };
  }

  const organizationId = document.querySelector("#adminUploadClientSelect")?.value || state.selectedAdminClientId;
  const requestId = document.querySelector("#adminUploadRequestSelect")?.value || null;
  const existingDeliverableId = document.querySelector("#adminExistingDeliverableSelect")?.value || "";
  const title = document.querySelector("#adminDeliverableTitle")?.value.trim() || "Client deliverable";
  const deliverableType = document.querySelector("#adminDeliverableType")?.value || "Business Analysis deliverable";
  const summary = document.querySelector("#adminDeliverableSummary")?.value.trim() || "";
  const releaseNote = document.querySelector("#adminDeliverableReleaseNote")?.value.trim() || "Released to client workspace.";
  const notifyClient = Boolean(document.querySelector("#adminNotifyClient")?.checked);
  const files = getAdminUploadFiles();

  if (!organizationId) {
    return { ok: false, error: "Select a client before uploading a deliverable." };
  }

  if (!files.length) {
    return { ok: false, error: "Select at least one deliverable file to upload." };
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
        status: "delivered",
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
        status: "delivered",
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
      status: "released",
      summary,
      release_note: releaseNote,
      released_at: new Date().toISOString(),
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

    if (uploadError) return { ok: false, error: uploadError.message, uploaded };

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

    if (fileError) return { ok: false, error: fileError.message, uploaded };
    uploaded += 1;
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

  if (deliverableUpdateError) return { ok: false, error: deliverableUpdateError.message, uploaded };

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

  let notificationResult = { ok: true };
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
    deliverableId,
    versionId: version.id,
    notificationSent: notificationResult.ok,
    notificationError: notificationResult.error,
  };
}

function setView() {
  const rawKey = window.location.hash.replace("#", "") || "home";
  const protectedViews = ["dashboard", "profile", "request", "billing"];
  let key = views[rawKey] ? rawKey : rawKey.startsWith("error=") ? "login" : "home";

  if (key === "admin" && !state.session?.user) {
    setPendingPostAuthRoute("admin");
    key = "login";
    setAuthStatus("Please sign in with the administrator email to open the admin workspace.");
  }

  if (key === "admin" && state.session?.user && !isAdminUser()) {
    key = "dashboard";
    showToast("Admin access is restricted to the administrator email.");
  }

  if (supabaseClient && protectedViews.includes(key) && !state.session?.user) {
    setPendingPostAuthRoute(key);
    key = "login";
    setAuthStatus("Please sign in before opening the client workspace.");
  }

  Object.entries(views).forEach(([viewKey, element]) => {
    element.classList.toggle("active", viewKey === key);
  });
  if (rawKey.startsWith("error=")) {
    setAuthStatus("Sign in could not be completed. Please try Google or Apple again.");
  }
  render();
  if (key === "admin") {
    loadAdminQueue();
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
    : `<tr><td colspan="4" class="empty-cell">No deliverables have been requested from this workspace yet.</td></tr>`;

  document.querySelector("#requestTable tbody").innerHTML = rows;

  const adminSource = state.adminQueue.length ? state.adminQueue : state.requests.map((request) => ({
    client: request.client,
    type: request.type,
    action: request.status === "New" ? "Scope request" : "Review",
    status: request.status,
  }));

  const adminRows = adminSource
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.client)}</td>
          <td>${escapeHtml(item.type)}</td>
          <td>${escapeHtml(item.action)}</td>
          <td>${escapeHtml(item.status)}</td>
        </tr>
      `
    )
    .join("");

  document.querySelector("#adminTable tbody").innerHTML = adminRows;
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
      const currentFileHtml = currentFiles
        .map(
          (version) => `
            <div class="deliverable-file-row">
              <div>
                <strong>${escapeHtml(version.fileName)}</strong>
                <span>Version ${escapeHtml(version.versionNumber)} released ${escapeHtml(formatDisplayDate(version.uploadedAt))} · ${escapeHtml(formatFileSize(version.fileSize))}</span>
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
                    <span>${escapeHtml(version.fileName)} · ${escapeHtml(formatDisplayDate(version.uploadedAt))}</span>
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
            <strong>Version ${escapeHtml(deliverable.currentVersion)}</strong>
          </div>
          ${deliverable.summary ? `<p>${escapeHtml(deliverable.summary)}</p>` : ""}
          <div class="deliverable-files">${currentFileHtml}</div>
          <details class="version-history">
            <summary>Version history</summary>
            ${previousFileHtml}
          </details>
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

  const creditTable = document.querySelector("#creditHistoryTable tbody");
  const paymentTable = document.querySelector("#paymentHistoryTable tbody");
  const adminCreditLedgerTable = document.querySelector("#adminCreditLedgerTable tbody");
  const adminPaymentTable = document.querySelector("#adminPaymentHistoryTable tbody");
  const auditTable = document.querySelector("#auditTable tbody");
  if (creditTable) creditTable.innerHTML = creditRows;
  if (paymentTable) paymentTable.innerHTML = paymentRows;
  if (adminCreditLedgerTable) adminCreditLedgerTable.innerHTML = creditRows;
  if (adminPaymentTable) adminPaymentTable.innerHTML = paymentRows;
  if (auditTable) auditTable.innerHTML = auditRows;
}

function renderCreditControls() {
  if (state.adminClients.length) {
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
      : state.adminQueue.length
      ? state.adminQueue.reduce((list, item) => {
          if (!list.some((client) => client.id === item.organizationId && client.name === item.client)) {
            list.push({ id: item.organizationId || "", name: item.client || "Client workspace" });
          }
          return list;
        }, [])
      : [{ id: "", name: state.client.company || "Client workspace" }];
    clientSelect.innerHTML = clients
      .map((client) => {
        const selected = client.id === state.selectedAdminClientId ? " selected" : "";
        const balance = client.balance ?? state.creditsLeft;
        return `<option value="${escapeHtml(client.id)}"${selected}>${escapeHtml(client.name)} (${escapeHtml(balance)} credits)</option>`;
      })
      .join("");
  }
  if (deliverableSelect) {
    const deliverables = state.adminQueue.filter((item) => item.requestId || item.id);
    const source = deliverables.length ? deliverables : state.requests;
    deliverableSelect.innerHTML = source
      .map((request) => {
        const value = request.requestId || request.id;
        const label = `${request.id || request.requestCode || value} - ${request.type || "Client request"}`;
        return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
      })
      .join("");
  }
  const uploadClientId = uploadClientSelect?.value || state.selectedAdminClientId;
  if (uploadClientSelect) {
    const clients = state.adminClients.length
      ? state.adminClients
      : [{ id: state.selectedAdminClientId || "", name: state.client.company || "Client workspace", balance: state.creditsLeft }];
    uploadClientSelect.innerHTML = clients
      .map((client) => {
        const selected = client.id === (uploadClientId || state.selectedAdminClientId) ? " selected" : "";
        return `<option value="${escapeHtml(client.id)}"${selected}>${escapeHtml(client.name)}</option>`;
      })
      .join("");
  }
  if (uploadRequestSelect) {
    const selectedOrg = uploadClientSelect?.value || state.selectedAdminClientId;
    const requests = state.adminQueue.filter((item) => !selectedOrg || item.organizationId === selectedOrg);
    uploadRequestSelect.innerHTML =
      `<option value="">No linked request</option>` +
      requests
        .map((request) => `<option value="${escapeHtml(request.requestId || request.id)}">${escapeHtml(request.id)} - ${escapeHtml(request.type)}</option>`)
        .join("");
  }
  if (existingDeliverableSelect) {
    const selectedOrg = uploadClientSelect?.value || state.selectedAdminClientId;
    const deliverables = state.adminDeliverables.filter((deliverable) => !selectedOrg || deliverable.organizationId === selectedOrg);
    existingDeliverableSelect.innerHTML =
      `<option value="">Create new deliverable</option>` +
      deliverables
        .map((deliverable) => `<option value="${escapeHtml(deliverable.id)}">${escapeHtml(deliverable.title)} · Version ${escapeHtml(deliverable.currentVersion || 1)}</option>`)
        .join("");
  }
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
}

function render() {
  document.querySelector("#clientName").textContent = state.client.company || "Your organization";
  document.querySelector("#creditsLeft").textContent = state.creditsLeft;
  document.querySelector("#activeCount").textContent = state.requests.filter((request) => request.status !== "Complete").length;
  document.querySelector("#adminNewCount").textContent = state.adminNewCount || state.requests.filter((request) => request.status === "New").length;
  document.querySelector("#adminQuoteCount").textContent = state.quoteCount;
  renderRequests();
  renderDeliverableStatus();
  renderClientDeliverables();
  renderCreditHistory();
  renderCreditControls();
}

function setAdminStatus(message) {
  const status = document.querySelector("#adminQueueStatus");
  if (status) status.textContent = message;
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
    id: requestCode,
    requestId,
    organizationId: item.organizationId || item.organization_id || organization.id || null,
    client,
    type,
    action,
    status,
  };
}

function normalizeAdminRequest(request) {
  return {
    id: request.request_code || request.id || "Request",
    requestId: request.id || null,
    organizationId: request.organization_id || null,
    client:
      request.organization_name ||
      request.client_organizations?.name ||
      request.organization?.name ||
      (request.organization_id ? `Workspace ${String(request.organization_id).slice(0, 8)}` : "Client workspace"),
    type: request.request_type || request.request_code || "Client request",
    action: request.status === "new" ? "Scope request" : "Review intake",
    status: request.status || "New",
  };
}

function normalizeCustomQuoteRequest(quote) {
  return {
    id: quote.id || "Custom quote",
    requestId: quote.id || null,
    organizationId: quote.organization_id || null,
    client: quote.work_email || "Custom inquiry",
    type: `Custom quote${quote.company_type ? `: ${quote.company_type}` : ""}`,
    action: "Schedule discovery",
    status: quote.status || "New",
  };
}

function normalizePaymentOrder(order) {
  return {
    id: order.id || "Payment",
    requestId: order.id || null,
    organizationId: order.organization_id || null,
    client: order.organization_id ? `Workspace ${String(order.organization_id).slice(0, 8)}` : "Client workspace",
    type: order.product_type || "Payment order",
    action: "Review payment",
    status: order.status || "Pending",
  };
}

function normalizeNotification(notification) {
  return {
    id: notification.id || "Notification",
    requestId: notification.related_entity_id || notification.id || null,
    organizationId: notification.organization_id || null,
    client: notification.recipient_email || "Client workspace",
    type: notification.subject || notification.template_key || "Notification",
    action: "Check notification",
    status: notification.status || "Queued",
  };
}

function applyAdminQueueData(data) {
  const requests = data.requests || [];
  const quoteItems = data.quotes || data.customQuoteRequests || [];
  const paymentOrders = data.paymentOrders || [];
  const notifications = data.notifications || [];
  const fallbackItems = data.items || data.queue || data.adminQueue || [];
  const normalizedItems = [
    ...requests.map(normalizeAdminRequest),
    ...quoteItems.map(normalizeCustomQuoteRequest),
    ...paymentOrders.map(normalizePaymentOrder),
    ...notifications.map(normalizeNotification),
    ...fallbackItems.map(normalizeAdminQueueItem),
  ].slice(0, 25);
  state.adminQueue = normalizedItems;
  state.adminNewCount = Number(data.requestCount ?? data.request_count ?? requests.length ?? 0);
  state.quoteCount = Number(data.quoteCount ?? data.quote_count ?? quoteItems.length ?? 0);

  const creditAccountList = data.creditAccounts || [];
  const singleCreditAccount = data.creditAccount || data.credit_account || null;
  const creditAccounts = creditAccountList.length ? creditAccountList : singleCreditAccount ? [singleCreditAccount] : [];
  state.adminClients = creditAccounts.map((account) => ({
    id: account.organization_id || "",
    name:
      account.organization_name ||
      account.client_name ||
      account.company ||
      account.client_organizations?.name ||
      (account.organization_id ? `Workspace ${String(account.organization_id).slice(0, 8)}` : "Client workspace"),
    balance: Number(account.balance ?? account.credit_balance ?? state.creditsLeft),
    lowCreditThreshold: Number(account.low_credit_threshold ?? account.lowCreditThreshold ?? state.creditThreshold),
  }));

  if (creditAccounts.length) {
    const creditAccount = creditAccounts[0];
    state.creditsLeft = Number(creditAccount.balance ?? state.creditsLeft);
    state.creditThreshold = Number(creditAccount.low_credit_threshold ?? creditAccount.lowCreditThreshold ?? state.creditThreshold);
  }

  const paymentHistory = data.paymentHistory || data.payments || [];
  if (paymentHistory.length) {
    state.paymentHistory = paymentHistory.slice(0, 20).map((payment) => ({
      date: payment.date || payment.created_at || formatToday(),
      item: payment.item || payment.product_type || payment.description || "Payment",
      amount: payment.amount || payment.amount_display || payment.total || "Recorded",
      status: payment.status || "Recorded",
    }));
  }

  const creditLedger = data.creditLedger || data.creditHistory || data.ledger || [];
  if (creditLedger.length) {
    state.creditHistory = creditLedger.slice(0, 20).map((entry) => ({
      date: entry.date || entry.created_at || formatToday(),
      deliverable: entry.deliverable || entry.action || entry.reason || "Credit activity",
      credits: entry.credits || entry.delta || entry.credit_delta || "Recorded",
      balance: entry.balance ?? entry.balance_after ?? state.creditsLeft,
    }));
  }

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
  }));
}

async function loadAdminQueue() {
  if (!supabaseClient || !isAdminUser()) return;

  setAdminStatus("Loading admin queue.");
  const result = await fetchAdminApi("/api/admin-queue");

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
    select.innerHTML = countries.map((country) => `<option>${country}</option>`).join("");
    select.value = "Canada";
  });
}

function setupOAuthButtons() {
  document.querySelectorAll("[data-provider]").forEach((button) => {
    button.type = "button";
  });
}

function rememberClientLoginFields() {
  const email = document.querySelector("#loginEmail")?.value || state.client.email || getUserEmail();
  const company = document.querySelector("#loginCompany")?.value || state.client.company || "Your organization";
  state.client = { email, company };
  saveState();
}

async function signInWithOAuthProvider(provider) {
  if (state.session?.user) {
    window.location.hash = isAdminUser() ? "admin" : "dashboard";
    return;
  }

  rememberClientLoginFields();

  if (!supabaseClient) {
    showToast(`Secure sign in is temporarily unavailable. Please contact ${config.supportEmail}.`);
    return;
  }

  setPendingPostAuthRoute(getNormalizedEmail(state.client.email) === getNormalizedEmail(config.adminEmail) ? "admin" : "dashboard");

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

async function requireClientWorkspaceForCheckout() {
  if (!state.session?.user) {
    window.location.hash = "login";
    showToast("Please use client login before purchasing so credits can be assigned to your workspace.");
    return null;
  }

  const organizationId = await getProfileOrganizationId();
  if (!organizationId) {
    window.location.hash = "profile";
    showToast("Please complete your workspace profile before starting a monthly plan or buying a credit top up.");
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
      const response = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productType,
          email: state.client.email,
          organizationId,
        }),
      });
      const data = await response.json();
      if (response.ok && data.url) {
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
    window.location.href = paymentLink;
    return true;
  }

  showToast(`${fallbackMessage} If checkout does not open, contact ${config.supportEmail}. Reference: ${priceId || "pending"}.`);
  return false;
}

async function beginCheckout(type) {
  if (type === "buy-sprint") {
    addAuditEvent("Checkout started", "BA Rescue Sprint checkout opened.");
    saveState();
    await openConfiguredCheckout("rescueSprint", "Secure checkout is being prepared for BA Rescue Sprint.");
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
  const target = event.target.closest("[data-action]");
  if (!target) return;
  event.preventDefault();
  beginCheckout(target.dataset.action);
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

  if (target.dataset.adminAction === "save-credit-settings") {
    if (!isAdminUser()) {
      showToast("Please sign in with the administrator email before saving.");
      return;
    }

    const balance = Math.max(0, Number(document.querySelector("#adminCreditBalance").value || 0));
    const lowCreditThreshold = Math.max(0, Number(document.querySelector("#adminLowCreditThreshold").value || 0));
    const adjustment = Number(document.querySelector("#adminCreditAdjustment").value || 0);
    const reason = document.querySelector("#adminCreditAdjustmentReason").value.trim();
    const selectedClient = getSelectedAdminClient();
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
    const adminItem = state.adminQueue.find((item) => item.requestId === requestId || item.id === requestId);
    const request = state.requests.find((item) => item.id === requestId);
    if (!request && !adminItem) {
      showToast("Select a deliverable before saving.");
      return;
    }

    if (!isAdminUser()) {
      showToast("Please sign in with the administrator email before saving.");
      return;
    }

    if (state.creditsLeft <= 0 || creditsUsed > state.creditsLeft) {
      const pausedStatus = "Paused, awaiting credits";
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

    if (adminItem?.organizationId && creditsUsed > 0) {
      const result = await updateServerCreditLedger({
        organizationId: adminItem.organizationId,
        type: "consume",
        credits: creditsUsed,
        reason: `${status}: ${request?.type || adminItem.type}`,
        requestId: adminItem.requestId || null,
        recipientEmail: adminItem.clientEmail || null,
      });

      if (!result.ok) {
        showToast(result.error || "Deliverable credits could not be updated.");
        return;
      }

      state.creditsLeft = Number(result.data.balance ?? state.creditsLeft);
    }

    if (request) {
      request.status = status === "Delivered" || status === "Completed" || status === "Completed and shipped" ? "Complete" : status;
    }
    if (adminItem) {
      adminItem.status = status === "Delivered" || status === "Completed" || status === "Completed and shipped" ? "Complete" : status;
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
      status.classList.remove("warning");
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
      status.textContent = result.notificationSent
        ? `Deliverable uploaded. ${result.uploaded} file${result.uploaded === 1 ? "" : "s"} released and client notification sent.`
        : `Deliverable uploaded. ${result.uploaded} file${result.uploaded === 1 ? "" : "s"} released. Client notification needs review.`;
      status.classList.toggle("warning", !result.notificationSent);
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
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-provider]");
  if (!target) return;
  event.preventDefault();
  await signInWithOAuthProvider(target.dataset.provider);
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

  const result = await fetchClientApi("/api/deliverable-download-url", {
    method: "POST",
    body: { fileId },
  });

  if (!result.ok || !result.data?.signedUrl) {
    showToast(result.error || "Download link could not be created.");
    return;
  }

  window.open(result.data.signedUrl, "_blank", "noopener,noreferrer");
});

document.querySelector("#signOutButton").addEventListener("click", async () => {
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
  }
  state.session = null;
  updateAuthUi();
  showToast("Signed out.");
});

document.querySelector("#requestForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const estimateValue = document.querySelector("#requestCreditEstimate").value;
  const requestedCredits = estimateValue === "custom" ? 0 : Number(estimateValue || 1);
  if (estimateValue === "custom") {
    showToast("This request is better handled as a custom scope. Please use Request Custom Scope.");
    addAuditEvent("Custom scope prompted", "Client selected custom scope review from request intake.");
    saveState();
    render();
    return;
  }

  if (state.creditsLeft < requestedCredits) {
    showToast("Not enough Advisory Credits remain. Please add credits before submitting this deliverable request.");
    addAuditEvent("Request paused", `Client attempted to submit a ${requestedCredits} credit request with insufficient balance.`);
    saveState();
    render();
    return;
  }

  const selectedType = document.querySelector("#requestType").value;
  const otherType = document.querySelector("#requestOther").value.trim();
  const request = {
    id: `REQ ${1043 + state.requests.length}`,
    type: selectedType === "Other" && otherType ? otherType : selectedType,
    status: "Pending scope",
    due: "To be scoped",
    client: state.client.company,
  };
  const userId = getUserId();
  const organizationId = await getProfileOrganizationId();
  if (supabaseClient && !organizationId) {
    window.location.hash = "profile";
    showToast("Please complete your client profile before submitting a request.");
    return;
  }

  state.requests.unshift(request);
  addAuditEvent("Request submitted", `${request.id} submitted with an estimated ${requestedCredits} Advisory Credit scope.`);
  saveState();
  const requestPayload = {
    request_code: request.id,
    organization_id: organizationId,
    submitted_by: userId,
    request_type: request.type,
    business_goal: document.querySelector("#businessGoal").value,
    target_audience: document.querySelector("#targetAudience").value,
    attachment_description: document.querySelector("#attachmentDescription").value,
    status: "pending_scope",
    credits_estimated: requestedCredits,
  };

  let result;
  let savedRequestId = null;
  if (supabaseClient) {
    const { data, error } = await supabaseClient.from("requests").insert(requestPayload).select("id").single();
    result = error ? { ok: false, reason: error.message } : { ok: true };
    savedRequestId = data?.id || null;
  } else {
    result = await writeToSupabase("requests", requestPayload);
  }

  const uploadResult = await uploadRequestFiles(savedRequestId, organizationId);
  if (result.ok) {
    await loadClientWorkspaceData();
  }
  window.location.hash = "dashboard";
  showToast(
    result.ok && uploadResult.ok
      ? `Request received. Files uploaded: ${uploadResult.uploaded}. We will review and respond from ${config.supportEmail}.`
      : `Request could not be submitted. Please try again or contact ${config.supportEmail}.`
  );
});

document.querySelector("#quoteForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const result = await writeToSupabase("custom_quote_requests", {
    organization_id: await getProfileOrganizationId(),
    work_email: state.client.email,
    company_type: document.querySelector("#quoteCompanyType").value,
    other_company_type: document.querySelector("#quoteOtherCompanyType").value,
    head_office_country: document.querySelector("#quoteCountry").value,
    estimated_budget: document.querySelector("#quoteBudget").value,
    request_summary: document.querySelector("#quoteForm textarea").value,
    status: "new",
  });
  showToast(
    result.ok
      ? "Custom advisory request received. We will review and follow up with next steps."
      : `Custom advisory request could not be submitted. Please try again or contact ${config.supportEmail}.`
  );
  window.location.hash = "dashboard";
});

document.querySelector("#profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  state.client = {
    email: document.querySelector("#profileEmail").value,
    company: document.querySelector("#profileCompany").value,
  };
  saveState();
  const orgResult = await saveClientProfileToSupabase();
  render();
  showToast(
    orgResult.ok
      ? "Client profile saved."
      : `Client profile could not be saved. Please try again or contact ${config.supportEmail}.`
  );
});

document.querySelector("#requestType").addEventListener("change", () => {
  toggleOther("#requestType", "#requestOtherWrap");
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
  const fileItems = files
    .map((file) => `<div><strong>${file.name}</strong> <span>${(file.size / 1024 / 1024).toFixed(2)} MB</span></div>`)
    .join("");
  list.innerHTML = fileItems;
});

document.querySelector("#adminDeliverableFiles")?.addEventListener("change", (event) => {
  const files = Array.from(event.target.files || []);
  const list = document.querySelector("#adminDeliverableFileList");
  if (!list) return;
  if (!files.length) {
    list.textContent = "No deliverable files selected yet.";
    return;
  }
  list.innerHTML = files
    .map((file) => `<div><strong>${escapeHtml(file.name)}</strong> <span>${escapeHtml(formatFileSize(file.size))}</span></div>`)
    .join("");
});

window.addEventListener("hashchange", setView);
populateCountries();
setupOAuthButtons();
toggleOther("#requestType", "#requestOtherWrap");
toggleOther("#quoteCompanyType", "#quoteOtherWrap");
initAuth();
setView();
