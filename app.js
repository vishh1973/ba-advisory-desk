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
    email: "client@example.com",
    company: "Northstar Apps Inc.",
  },
  requests: JSON.parse(localStorage.getItem("baad-requests") || "null") || [
    {
      id: "REQ 1042",
      type: "Business case review",
      status: "In review",
      due: "May 21",
      client: "Northstar Apps Inc.",
    },
    {
      id: "REQ 1041",
      type: "SOP cleanup",
      status: "Ready",
      due: "May 20",
      client: "Northstar Apps Inc.",
    },
  ],
  creditsLeft: Number(localStorage.getItem("baad-credits") || config.starterCredits),
  creditThreshold: Number(localStorage.getItem("baad-credit-threshold") || config.lowCreditThreshold),
  creditHistory: JSON.parse(localStorage.getItem("baad-credit-history") || "null") || [
    {
      date: "May 18",
      deliverable: "Starter package credits issued",
      credits: `+${config.starterCredits}`,
      balance: config.starterCredits,
    },
  ],
  paymentHistory: JSON.parse(localStorage.getItem("baad-payment-history") || "null") || [
    {
      date: "May 18",
      item: "BA Advisory Desk Starter",
      amount: "$2,500",
      status: "Payment confirmed",
    },
  ],
  auditEvents: JSON.parse(localStorage.getItem("baad-audit-events") || "null") || [
    {
      date: "May 18",
      event: "Credits issued",
      client: "Northstar Apps Inc.",
      details: `${config.starterCredits} Advisory Credits issued for Starter package.`,
    },
  ],
  session: null,
  adminQueue: [],
  quoteCount: 0,
};

const views = {
  home: document.querySelector("#view-home"),
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

function getLowCreditMessage() {
  if (state.creditsLeft <= 0) {
    return "No Advisory Credits remain. New deliverables are paused until credits are added.";
  }
  if (state.creditsLeft <= state.creditThreshold) {
    return `${state.creditsLeft} Advisory Credits remain. Consider adding credits before new deliverables are scoped.`;
  }
  return "Credit balance is healthy.";
}

function getAuthRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}#dashboard`;
}

function setAuthStatus(message) {
  const status = document.querySelector("#authStatus");
  if (status) status.textContent = message;
}

function updateAuthUi() {
  const isSignedIn = Boolean(state.session?.user);
  const loginButton = document.querySelector("#loginButton");
  const signOutButton = document.querySelector("#signOutButton");

  if (loginButton) {
    loginButton.textContent = isSignedIn ? "Go To Dashboard" : "Send Secure Sign In Link";
  }

  if (signOutButton) {
    signOutButton.classList.toggle("hidden", !isSignedIn);
  }

  if (isSignedIn) {
    state.client.email = state.session.user.email || state.client.email;
    saveState();
    setAuthStatus(`Signed in as ${state.client.email}.`);
  } else {
    setAuthStatus("Enter your work email. We will send a sign in link.");
  }
}

async function initAuth() {
  if (!supabaseClient) {
    setAuthStatus("Enter your work email. We will send a sign in link.");
    return;
  }

  const { data } = await supabaseClient.auth.getSession();
  state.session = data.session;
  updateAuthUi();

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    updateAuthUi();
  });
}

function getUserId() {
  return state.session?.user?.id || null;
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

async function writeToSupabase(table, payload) {
  if (!supabaseClient) {
    return { ok: false, reason: "Supabase client is not loaded yet." };
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

  const orgPayload = {
    name: document.querySelector("#profileCompany").value,
    industry: document.querySelector("#profileIndustry").value,
    country: document.querySelector("#profileCountry").value,
    timezone: document.querySelector("#profileTimezone").value,
    company_type: document.querySelector("#profileIndustry").value,
  };

  const { data: organization, error: orgError } = await supabaseClient
    .from("client_organizations")
    .insert(orgPayload)
    .select("id")
    .single();

  if (orgError) {
    return { ok: false, reason: orgError.message };
  }

  const { error: profileError } = await supabaseClient.from("profiles").upsert({
    id: getUserId(),
    organization_id: organization.id,
    first_name: document.querySelector("#profileFirstName").value,
    last_name: document.querySelector("#profileLastName").value,
    work_email: document.querySelector("#profileEmail").value,
    phone: document.querySelector("#profilePhone").value,
    job_title: document.querySelector("#profileTitle").value,
    department: document.querySelector("#profileFunction").value,
    preferred_working_style: document.querySelector("#profileWorkingStyle").value,
    primary_business_need: document.querySelector("#profileNeed").value,
    role: "client",
    updated_at: new Date().toISOString(),
  });

  if (profileError) {
    return { ok: false, reason: profileError.message };
  }

  return { ok: true, organizationId: organization.id };
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

function setView() {
  const rawKey = window.location.hash.replace("#", "") || "home";
  const protectedViews = ["dashboard", "profile", "request", "billing"];
  let key = views[rawKey] ? rawKey : rawKey.startsWith("error=") ? "login" : "home";

  if (supabaseClient && protectedViews.includes(key) && !state.session?.user) {
    key = "login";
    setAuthStatus("Please sign in before opening the client workspace.");
  }

  Object.entries(views).forEach(([viewKey, element]) => {
    element.classList.toggle("active", viewKey === key);
  });
  if (rawKey.startsWith("error=")) {
    setAuthStatus("The email link has expired. Please request a fresh sign in link.");
  }
  render();
  if (key === "admin") {
    loadAdminQueue();
  }
}

function renderRequests() {
  const rows = state.requests
    .map(
      (request) => `
        <tr>
          <td>${request.id}</td>
          <td>${request.type}</td>
          <td>${request.status}</td>
          <td>${request.due}</td>
        </tr>
      `
    )
    .join("");

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
          <td>${item.client}</td>
          <td>${item.type}</td>
          <td>${item.action}</td>
          <td>${item.status}</td>
        </tr>
      `
    )
    .join("");

  document.querySelector("#adminTable tbody").innerHTML = adminRows;
}

function renderCreditHistory() {
  const creditRows = state.creditHistory
    .map(
      (item) => `
        <tr>
          <td>${item.date}</td>
          <td>${item.deliverable}</td>
          <td>${item.credits}</td>
          <td>${item.balance}</td>
        </tr>
      `
    )
    .join("");

  const paymentRows = state.paymentHistory
    .map(
      (item) => `
        <tr>
          <td>${item.date}</td>
          <td>${item.item}</td>
          <td>${item.amount}</td>
          <td>${item.status}</td>
        </tr>
      `
    )
    .join("");

  const auditRows = state.auditEvents
    .map(
      (item) => `
        <tr>
          <td>${item.date}</td>
          <td>${item.event}</td>
          <td>${item.client}</td>
          <td>${item.details}</td>
        </tr>
      `
    )
    .join("");

  const creditTable = document.querySelector("#creditHistoryTable tbody");
  const paymentTable = document.querySelector("#paymentHistoryTable tbody");
  const auditTable = document.querySelector("#auditTable tbody");
  if (creditTable) creditTable.innerHTML = creditRows;
  if (paymentTable) paymentTable.innerHTML = paymentRows;
  if (auditTable) auditTable.innerHTML = auditRows;
}

function renderCreditControls() {
  const used = Math.max(0, config.starterCredits - state.creditsLeft);
  const usageText = `${used} of ${config.starterCredits} used this cycle`;
  const usagePercent = Math.min(100, Math.round((used / config.starterCredits) * 100));
  const summary = document.querySelector("#creditUsageSummary");
  const bar = document.querySelector("#creditUsageBar");
  const alert = document.querySelector("#creditAlert");
  const adminBalance = document.querySelector("#adminCreditBalance");
  const adminThreshold = document.querySelector("#adminLowCreditThreshold");
  const deliverableSelect = document.querySelector("#adminDeliverableSelect");

  if (summary) summary.textContent = usageText;
  if (bar) bar.style.width = `${usagePercent}%`;
  if (alert) {
    alert.textContent = getLowCreditMessage();
    alert.classList.toggle("warning", state.creditsLeft <= state.creditThreshold);
  }
  if (adminBalance) adminBalance.value = state.creditsLeft;
  if (adminThreshold) adminThreshold.value = state.creditThreshold;
  if (deliverableSelect) {
    deliverableSelect.innerHTML = state.requests
      .map((request) => `<option value="${request.id}">${request.id} - ${request.type}</option>`)
      .join("");
  }
}

function render() {
  document.querySelector("#clientName").textContent = state.client.company;
  document.querySelector("#creditsLeft").textContent = state.creditsLeft;
  document.querySelector("#activeCount").textContent = state.requests.filter((request) => request.status !== "Complete").length;
  document.querySelector("#adminNewCount").textContent = state.adminQueue.length || state.requests.filter((request) => request.status === "New").length;
  document.querySelector("#adminQuoteCount").textContent = state.quoteCount;
  renderRequests();
  renderCreditHistory();
  renderCreditControls();
}

async function loadAdminQueue() {
  if (!supabaseClient) return;

  const { data: requests } = await supabaseClient
    .from("requests")
    .select("request_code, request_type, status, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: quotes } = await supabaseClient
    .from("custom_quote_requests")
    .select("company_type, estimated_budget, status, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  const requestRows = (requests || []).map((request) => ({
    client: "Client request",
    type: request.request_type || request.request_code || "BA request",
    action: "Review intake",
    status: request.status || "new",
  }));

  const quoteRows = (quotes || []).map((quote) => ({
    client: quote.company_type || "Custom inquiry",
    type: `Custom quote ${quote.estimated_budget ? `(${quote.estimated_budget})` : ""}`,
    action: "Schedule discovery",
    status: quote.status || "new",
  }));

  state.adminQueue = [...requestRows, ...quoteRows].slice(0, 12);
  state.quoteCount = quoteRows.length;
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
    showToast("Please sign in before purchasing a recurring credit package so credits can be assigned to your workspace.");
    return null;
  }

  const organizationId = await getProfileOrganizationId();
  if (!organizationId) {
    window.location.hash = "profile";
    showToast("Please complete the client profile before purchasing a recurring credit package.");
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
  beginCheckout(target.dataset.action);
});

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-admin-action]");
  if (!target) return;

  if (target.dataset.adminAction === "save-credit-settings") {
    state.creditsLeft = Math.max(0, Number(document.querySelector("#adminCreditBalance").value || 0));
    state.creditThreshold = Math.max(0, Number(document.querySelector("#adminLowCreditThreshold").value || 0));
    addCreditHistory("Admin credit balance update", "Manual update", state.creditsLeft);
    addAuditEvent("Credit settings updated", `Balance set to ${state.creditsLeft}. Low credit threshold set to ${state.creditThreshold}.`);
    saveState();
    render();
    showToast("Credit settings updated.");
  }

  if (target.dataset.adminAction === "ship-deliverable") {
    const requestId = document.querySelector("#adminDeliverableSelect").value;
    const status = document.querySelector("#adminDeliverableStatus").value;
    const creditsUsed = Math.max(0, Number(document.querySelector("#adminCreditsUsed").value || 0));
    const request = state.requests.find((item) => item.id === requestId);
    if (!request) {
      showToast("Select a deliverable before saving.");
      return;
    }

    if (creditsUsed > state.creditsLeft && status !== "Paused, awaiting credits") {
      request.status = "Paused";
      addAuditEvent("Deliverable paused", `${request.id} paused because available credits are below the requested usage.`);
      saveState();
      render();
      showToast("Deliverable paused because the client does not have enough credits.");
      return;
    }

    request.status = status === "Delivered" || status === "Completed" ? "Complete" : status;
    if (creditsUsed > 0) {
      state.creditsLeft = Math.max(0, state.creditsLeft - creditsUsed);
      addCreditHistory(request.type, `-${creditsUsed} consumed`, state.creditsLeft);
    }
    addAuditEvent("Deliverable status updated", `${request.id} set to ${status}. Credits used: ${creditsUsed}.`);
    saveState();
    render();
    showToast("Deliverable status and credit usage updated.");
  }
});

document.querySelector("#loginButton").addEventListener("click", async () => {
  if (state.session?.user) {
    window.location.hash = "dashboard";
    return;
  }

  state.client = {
    email: document.querySelector("#loginEmail").value,
    company: document.querySelector("#loginCompany").value,
  };
  saveState();

  if (!supabaseClient) {
    window.location.hash = "dashboard";
    showToast("Client workspace opened for this browser session.");
    return;
  }

  const { error } = await supabaseClient.auth.signInWithOtp({
    email: state.client.email,
    options: {
      emailRedirectTo: getAuthRedirectUrl(),
      data: {
        company: state.client.company,
      },
    },
  });

  showToast(
    error
      ? `Sign in link could not be sent: ${error.message}`
      : `Secure sign in link sent to ${state.client.email}.`
  );
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
    status: "New",
    due: "To be scoped",
    client: state.client.company,
  };
  state.requests.unshift(request);
  state.creditsLeft = Math.max(0, state.creditsLeft - requestedCredits);
  addCreditHistory(request.type, `-${requestedCredits} reserved`, state.creditsLeft);
  addAuditEvent("Credit reserved", `${requestedCredits} Advisory Credit(s) reserved for ${request.id}.`);
  saveState();
  const userId = getUserId();
  const organizationId = await getProfileOrganizationId();
  const requestPayload = {
    request_code: request.id,
    organization_id: organizationId,
    submitted_by: userId,
    request_type: request.type,
    business_goal: document.querySelector("#businessGoal").value,
    target_audience: document.querySelector("#targetAudience").value,
    attachment_description: document.querySelector("#attachmentDescription").value,
    status: "new",
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

window.addEventListener("hashchange", setView);
populateCountries();
toggleOther("#requestType", "#requestOtherWrap");
toggleOther("#quoteCompanyType", "#quoteOtherWrap");
initAuth();
setView();
