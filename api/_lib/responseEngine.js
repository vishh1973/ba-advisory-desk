const RESPONSE_ENGINE_SERVICE_KEY = "procurement_response_engine";
const RESPONSE_ENGINE_LABEL = "Bid/Proposal Automation";
const RESPONSE_ENGINE_DASHBOARD_LABEL = "Bid/Proposal Automation";
const RESPONSE_ENGINE_REQUEST_TYPE = "Candidate Submission Package";
const RESPONSE_ENGINE_PROJECT_NAME = "Bid/Proposal Automation";
const RESPONSE_ENGINE_PROJECT_CODE = "RSP";
const RESPONSE_ENGINE_MAX_FILE_DESCRIPTION = 1000;
const RESPONSE_ENGINE_RECOMMENDED_FILE_DESCRIPTION = 500;
const { getAuthenticatedWorkspace: getAuthenticatedOrganizationWorkspace } = require("./organizationAccess");

const OUTPUT_CATALOG = {
  polished_resume: {
    label: "Polished candidate resume",
    credits: 1,
    includedInFullPackage: true,
  },
  mandatory_matrix: {
    label: "Mandatory criteria matrix",
    credits: 1,
    includedInFullPackage: true,
  },
  rated_matrix: {
    label: "Rated criteria scoring map",
    credits: 1,
    includedInFullPackage: true,
  },
  combined_grid: {
    label: "Combined response grid",
    credits: 1,
    includedInFullPackage: false,
  },
  gap_note: {
    label: "Fit-gap assessment and recruiter risk note",
    credits: 0,
    includedInFullPackage: true,
  },
  recruiter_checklist: {
    label: "Recruiter submission checklist",
    credits: 0,
    includedInFullPackage: true,
  },
  client_template: {
    label: "Format into uploaded client template",
    credits: 1,
    includedInFullPackage: false,
  },
};

const FORMAT_CATALOG = {
  docx: "Word document",
  xlsx: "Excel workbook",
  pdf: "PDF copy",
  zip: "ZIP package",
  uploaded_template: "Use uploaded template where possible",
};

const FILE_ROLE_CATALOG = {
  rfp_sow: "RFP, SOW, or opportunity document",
  mandatory_grid: "Mandatory criteria grid",
  rated_grid: "Rated criteria grid",
  candidate_resume: "Candidate resume",
  past_profile: "Past candidate profile",
  recruiter_instructions: "Recruiter email or instructions",
  client_template: "Client template",
  supporting_evidence: "Additional supporting evidence",
  reference_material: "Reference material",
  other: "Other",
};

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeSelectedKeys(value, catalog) {
  const list = Array.isArray(value) ? value : [];
  const allowed = new Set(Object.keys(catalog));
  return Array.from(new Set(list.map(normalizeKey).filter((key) => allowed.has(key))));
}

function calculateResponseCreditCost(outputKeys) {
  const keys = normalizeSelectedKeys(outputKeys, OUTPUT_CATALOG);
  if (!keys.length) return { credits: 0, outputKeys: [] };

  const fullPackageKeys = ["polished_resume", "mandatory_matrix", "rated_matrix"];
  const hasFullPackage = fullPackageKeys.every((key) => keys.includes(key));
  let credits = 0;

  if (hasFullPackage) {
    credits = 3;
    for (const key of keys) {
      const item = OUTPUT_CATALOG[key];
      if (!item?.includedInFullPackage) credits += Number(item.credits || 0);
    }
  } else {
    credits = keys.reduce((total, key) => total + Number(OUTPUT_CATALOG[key]?.credits || 0), 0);
  }

  return { credits, outputKeys: keys };
}

function buildOutputOptionSummary(outputKeys) {
  return normalizeSelectedKeys(outputKeys, OUTPUT_CATALOG)
    .map((key) => OUTPUT_CATALOG[key].label)
    .join(", ");
}

function buildFormatSummary(formatKeys) {
  return normalizeSelectedKeys(formatKeys, FORMAT_CATALOG)
    .map((key) => FORMAT_CATALOG[key])
    .join(", ");
}

function normalizeFileContexts(value) {
  const list = Array.isArray(value) ? value : [];
  return list.map((item) => {
    const role = normalizeKey(item?.role || item?.fileRole || item?.file_role || "other");
    return {
      storagePath: String(item?.storagePath || item?.storage_path || "").trim(),
      fileName: String(item?.fileName || item?.file_name || "").trim(),
      role: FILE_ROLE_CATALOG[role] ? role : "other",
      description: String(item?.description || item?.fileDescription || item?.file_description || "")
        .trim()
        .slice(0, RESPONSE_ENGINE_MAX_FILE_DESCRIPTION),
    };
  });
}

async function getAuthenticatedWorkspace(supabase, req) {
  return getAuthenticatedOrganizationWorkspace(supabase, req, {
    missingTokenMessage: `Please sign in before using ${RESPONSE_ENGINE_DASHBOARD_LABEL}.`,
    invalidTokenMessage: `Please sign in again before using ${RESPONSE_ENGINE_DASHBOARD_LABEL}.`,
    unverifiedMessage: `Please verify your email before using ${RESPONSE_ENGINE_DASHBOARD_LABEL}.`,
    missingWorkspaceMessage: `Please complete your client profile or wait for administrator approval before using ${RESPONSE_ENGINE_DASHBOARD_LABEL}.`,
  });
}

async function readResponseEntitlement(supabase, organizationId) {
  const { data, error } = await supabase
    .from("service_entitlements")
    .select("id,organization_id,service_key,status,pilot_credit_limit,approved_at,expires_at,notes")
    .eq("organization_id", organizationId)
    .eq("service_key", RESPONSE_ENGINE_SERVICE_KEY)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function requireApprovedResponseEngine(supabase, organizationId) {
  const entitlement = await readResponseEntitlement(supabase, organizationId);
  if (!entitlement || entitlement.status !== "approved") {
    const error = new Error(`${RESPONSE_ENGINE_DASHBOARD_LABEL} access is pending approval.`);
    error.status = 403;
    error.entitlement = entitlement;
    throw error;
  }
  return entitlement;
}

async function readResponseCreditBalance(supabase, organizationId) {
  const { data, error } = await supabase
    .from("response_credit_balance_summary")
    .select("balance,reserved_balance,available_balance,low_credit_threshold,status,updated_at")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return {
    balance: Number(data?.balance || 0),
    reservedBalance: Number(data?.reserved_balance || 0),
    availableBalance: Number(data?.available_balance || 0),
    lowCreditThreshold: Number(data?.low_credit_threshold || 0),
    status: data?.status || "not_started",
    updatedAt: data?.updated_at || null,
  };
}

async function ensureResponseEngineProject(supabase, organizationId, actorId) {
  const { data: existing, error: existingError } = await supabase
    .from("client_projects")
    .select("id,name,project_code,status")
    .eq("organization_id", organizationId)
    .eq("project_code", RESPONSE_ENGINE_PROJECT_CODE)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.id && existing.status !== "archived") return existing;

  const { data, error } = await supabase
    .from("client_projects")
    .insert({
      organization_id: organizationId,
      name: RESPONSE_ENGINE_PROJECT_NAME,
      project_code: RESPONSE_ENGINE_PROJECT_CODE,
      description: "Private workspace for bid, proposal, and candidate submission automation.",
      status: "active",
      is_default: false,
      created_by: actorId || null,
    })
    .select("id,name,project_code,status")
    .single();
  if (error) throw error;
  return data;
}

function responseEngineError(res, error, fallback = `${RESPONSE_ENGINE_DASHBOARD_LABEL} request could not be completed.`) {
  res.status(error.status || 500).json({ error: error.message || fallback });
}

module.exports = {
  FILE_ROLE_CATALOG,
  FORMAT_CATALOG,
  OUTPUT_CATALOG,
  RESPONSE_ENGINE_DASHBOARD_LABEL,
  RESPONSE_ENGINE_LABEL,
  RESPONSE_ENGINE_MAX_FILE_DESCRIPTION,
  RESPONSE_ENGINE_PROJECT_CODE,
  RESPONSE_ENGINE_PROJECT_NAME,
  RESPONSE_ENGINE_RECOMMENDED_FILE_DESCRIPTION,
  RESPONSE_ENGINE_REQUEST_TYPE,
  RESPONSE_ENGINE_SERVICE_KEY,
  buildFormatSummary,
  buildOutputOptionSummary,
  calculateResponseCreditCost,
  ensureResponseEngineProject,
  getAuthenticatedWorkspace,
  normalizeFileContexts,
  normalizeSelectedKeys,
  readResponseCreditBalance,
  readResponseEntitlement,
  requireApprovedResponseEngine,
  responseEngineError,
};
