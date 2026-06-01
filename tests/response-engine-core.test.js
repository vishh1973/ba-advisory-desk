const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FILE_ROLE_CATALOG,
  FORMAT_CATALOG,
  OUTPUT_CATALOG,
  RESPONSE_ENGINE_SERVICE_KEY,
  calculateResponseCreditCost,
  normalizeFileContexts,
  normalizeSelectedKeys,
} = require("../api/_lib/responseEngine");
const {
  REQUIRED_QA_CHECKS,
  buildJobManifest,
  buildPrompt,
  maxResponseEngineSubagents,
  qaReleaseGateFailures,
} = require("../scripts/response-engine-worker");

test("Response Engine constants use the production service key", () => {
  assert.equal(RESPONSE_ENGINE_SERVICE_KEY, "procurement_response_engine");
  assert.ok(OUTPUT_CATALOG.polished_resume);
  assert.ok(FORMAT_CATALOG.docx);
  assert.ok(FILE_ROLE_CATALOG.candidate_resume);
});

test("Response Engine full package costs three response credits", () => {
  const result = calculateResponseCreditCost([
    "polished_resume",
    "mandatory_matrix",
    "rated_matrix",
    "gap_note",
    "recruiter_checklist",
  ]);
  assert.deepEqual(result.outputKeys, [
    "polished_resume",
    "mandatory_matrix",
    "rated_matrix",
    "gap_note",
    "recruiter_checklist",
  ]);
  assert.equal(result.credits, 3);
});

test("Response Engine add ons increase package cost only when selected", () => {
  const result = calculateResponseCreditCost([
    "polished_resume",
    "mandatory_matrix",
    "rated_matrix",
    "combined_grid",
    "client_template",
  ]);
  assert.equal(result.credits, 5);
});

test("Response Engine selected keys are deduped and unknown keys are ignored", () => {
  const keys = normalizeSelectedKeys(["DOCX", "docx", "bad-format", "xlsx"], FORMAT_CATALOG);
  assert.deepEqual(keys, ["docx", "xlsx"]);
});

test("Response Engine file context is normalized and capped", () => {
  const longDescription = "a".repeat(1200);
  const contexts = normalizeFileContexts([
    {
      storagePath: "user/request/file.docx",
      fileName: "candidate.docx",
      role: "candidate_resume",
      description: longDescription,
    },
    {
      storage_path: "user/request/file.pdf",
      file_name: "unknown.pdf",
      file_role: "unsupported",
      file_description: "Reference",
    },
  ]);
  assert.equal(contexts[0].role, "candidate_resume");
  assert.equal(contexts[0].description.length, 1000);
  assert.equal(contexts[1].role, "other");
});

test("Response Engine worker caps dynamic subagents at six", () => {
  const originalMax = process.env.RESPONSE_ENGINE_MAX_SUBAGENTS;
  process.env.RESPONSE_ENGINE_MAX_SUBAGENTS = "12";
  try {
    assert.equal(maxResponseEngineSubagents(), 6);
    const manifest = buildJobManifest(
      {
        id: "job-1",
        request_id: "request-1",
        organization_id: "org-1",
        project_id: "project-1",
        response_engine_requests: {
          package_title: "Candidate package",
          output_options: ["polished_resume"],
          output_formats: ["docx"],
          credit_cost: 1,
          requests: { request_code: "REQ-1" },
        },
        client_organizations: { name: "Pilot Firm" },
      },
      []
    );
    assert.equal(manifest.orchestrationPolicy.maxSubagents, 6);
    assert.equal(manifest.orchestrationPolicy.dynamicSubagentsRequired, true);
    assert.equal(manifest.qualityControls.releaseThreshold, 8.5);
  } finally {
    if (originalMax === undefined) delete process.env.RESPONSE_ENGINE_MAX_SUBAGENTS;
    else process.env.RESPONSE_ENGINE_MAX_SUBAGENTS = originalMax;
  }
});

test("Response Engine worker prompt requires subagent orchestration and factual QA", async () => {
  const manifest = buildJobManifest(
    {
      id: "job-2",
      request_id: "request-2",
      organization_id: "org-2",
      project_id: "project-2",
      response_engine_requests: {
        package_title: "Candidate package",
        output_options: ["polished_resume", "mandatory_matrix"],
        output_formats: ["docx", "xlsx"],
        credit_cost: 3,
        requests: { request_code: "REQ-2" },
      },
      client_organizations: { name: "Pilot Firm" },
    },
    []
  );
  const prompt = await buildPrompt("/tmp/response-engine-job", manifest);
  assert.match(prompt, /Use up to 6 specialist subagents/);
  assert.match(prompt, /criteria, SOW, and skills matrix keywords/i);
  assert.match(prompt, /factual grounding, keyword coverage, natural language/i);
});

test("Response Engine release gate requires factual grounding and keyword QA", () => {
  const passingQualityChecks = Object.fromEntries(REQUIRED_QA_CHECKS.map((check) => [check, true]));
  const passingQa = {
    score: 9.1,
    hardGateFailures: [],
    qualityChecks: passingQualityChecks,
    subagentUsage: {
      mode: "multi_agent",
      maxAllowed: 6,
      subagentsUsed: 4,
      roles: ["source-evidence", "criteria-mapping", "resume-drafting", "release-qa"],
    },
    factualGrounding: {
      allClientClaimsSupported: true,
      noUnsupportedClaims: true,
    },
    keywordCoverage: {
      mandatoryAndRatedKeywordsCovered: true,
      criteriaKeywordsUsedNaturally: true,
    },
    industryTerminology: {
      terminologySubstantiated: true,
    },
  };
  assert.deepEqual(qaReleaseGateFailures(passingQa), []);

  const failingQa = {
    ...passingQa,
    keywordCoverage: {
      mandatoryAndRatedKeywordsCovered: false,
      criteriaKeywordsUsedNaturally: false,
    },
  };
  assert.ok(qaReleaseGateFailures(failingQa).some((failure) => failure.includes("keyword")));
});
