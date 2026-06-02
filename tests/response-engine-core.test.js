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
  DEFAULT_MAX_RESPONSE_ENGINE_ATTEMPTS,
  DELIVERABLE_METADATA_AUTHOR,
  REQUIRED_QA_CHECKS,
  attemptsRemaining,
  buildJobManifest,
  buildPrompt,
  clientInputRequired,
  clientNotificationEmail,
  hasRequiredFitGapAssessment,
  maxResponseEngineAttempts,
  maxResponseEngineSubagents,
  outputCoverageFailures,
  qaReleaseGateFailures,
  textQualityFailures,
  validateEvidenceMap,
} = require("../scripts/response-engine-worker");

function buildPassingQa(overrides = {}) {
  return {
    score: 9.1,
    hardGateFailures: [],
    qualityChecks: Object.fromEntries(REQUIRED_QA_CHECKS.map((check) => [check, true])),
    subagentUsage: {
      mode: "multi_agent",
      maxAllowed: 6,
      subagentsUsed: 4,
      roles: ["source-evidence", "criteria-mapping", "resume-drafting", "release-qa"],
    },
    factualGrounding: {
      allClientClaimsSupported: true,
      noUnsupportedClaims: true,
      evidenceMapReviewed: true,
    },
    sourceFileCoverage: {
      allUploadedFilesReviewed: true,
      filesReviewed: ["candidate.docx", "grid.xlsx"],
    },
    keywordCoverage: {
      mandatoryAndRatedKeywordsCovered: true,
      criteriaKeywordsUsedNaturally: true,
    },
    industryTerminology: {
      terminologySubstantiated: true,
    },
    humanEditorialReview: {
      humanWrittenTone: true,
      noGenericAiLanguage: true,
      noEmDashOrEnDash: true,
    },
    fitGapAssessment: {
      includedInResumePackage: true,
      strongMatches: ["Supported procurement experience"],
      visibleGaps: [],
      areasToBeefUp: [],
      candidateFollowUpQuestions: [],
    },
    formattingQuality: {
      consultingGradeDocuments: true,
      gridPresentationQuality: true,
    },
    metadataReview: {
      baAdvisoryDeskMetadataApplied: true,
      restrictedTermsRemoved: true,
    },
    ...overrides,
  };
}

test("Response Engine constants use the production service key", () => {
  assert.equal(RESPONSE_ENGINE_SERVICE_KEY, "procurement_response_engine");
  assert.ok(OUTPUT_CATALOG.polished_resume);
  assert.ok(FORMAT_CATALOG.docx);
  assert.ok(FILE_ROLE_CATALOG.candidate_resume);
  assert.ok(FILE_ROLE_CATALOG.supporting_evidence);
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
  const keys = normalizeSelectedKeys(["DOCX", "docx", "zip", "bad-format", "xlsx"], FORMAT_CATALOG);
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
    {
      storage_path: "user/request/follow-up.pdf",
      file_name: "follow-up.pdf",
      file_role: "supporting_evidence",
      file_description: "Follow-up evidence",
    },
  ]);
  assert.equal(contexts[0].role, "candidate_resume");
  assert.equal(contexts[0].description.length, 1000);
  assert.equal(contexts[1].role, "other");
  assert.equal(contexts[2].role, "supporting_evidence");
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
    assert.equal(manifest.qualityControls.minimumAutomatedAttemptsBeforeFinalFailure, 3);
    assert.equal(manifest.qualityControls.metadataAuthorRequired, DELIVERABLE_METADATA_AUTHOR);
  } finally {
    if (originalMax === undefined) delete process.env.RESPONSE_ENGINE_MAX_SUBAGENTS;
    else process.env.RESPONSE_ENGINE_MAX_SUBAGENTS = originalMax;
  }
});

test("Response Engine worker enforces at least three automated attempts", () => {
  assert.equal(DEFAULT_MAX_RESPONSE_ENGINE_ATTEMPTS, 3);
  assert.equal(maxResponseEngineAttempts({ max_attempts: 1 }), 3);
  assert.equal(maxResponseEngineAttempts({ max_attempts: 2 }), 3);
  assert.equal(maxResponseEngineAttempts({ max_attempts: 5 }), 5);
  assert.equal(attemptsRemaining({ attempts: 1, max_attempts: 3 }), true);
  assert.equal(attemptsRemaining({ attempts: 2, max_attempts: 3 }), true);
  assert.equal(attemptsRemaining({ attempts: 3, max_attempts: 3 }), false);
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

test("Response Engine worker prompt requires human rewrite, fit-gap, and consulting formatting standards", async () => {
  const manifest = buildJobManifest(
    {
      id: "job-3",
      request_id: "request-3",
      organization_id: "org-3",
      project_id: "project-3",
      response_engine_requests: {
        package_title: "Candidate package",
        output_options: ["polished_resume", "rated_matrix"],
        output_formats: ["docx", "xlsx"],
        credit_cost: 3,
        requests: { request_code: "REQ-3" },
      },
      client_organizations: { name: "Pilot Firm" },
    },
    []
  );

  const prompt = await buildPrompt("/tmp/response-engine-job", manifest);

  assert.match(prompt, /Human resume rewrite methodology:/);
  assert.match(prompt, /Rewrite from evidence first/);
  assert.match(prompt, /reads like careful recruiter or candidate writing/i);
  assert.match(prompt, /Do not use common AI-style phrases/);
  assert.match(prompt, /Do not use em dash or en dash punctuation/);
  assert.match(prompt, /Fit-Gap Assessment/);
  assert.match(prompt, /strong matches, areas to beef up, visible gaps, and candidate follow-up questions/);
  assert.match(prompt, /clientInputRequired/);
  assert.match(prompt, /internal quality problems/i);
  assert.match(prompt, /top-tier consulting standard/);
  assert.match(prompt, /readable wrapped text/);
  assert.match(prompt, /BA Advisory Desk/);
  assert.match(prompt, /metadata author, creator, company, manager, last modified by, and producer/i);
});

test("Response Engine distinguishes client evidence gaps from internal quality failure", () => {
  assert.equal(clientInputRequired({ clientInputRequired: true }, {}), true);
  assert.equal(clientInputRequired({}, { needsClientInput: true }), true);
  assert.equal(clientInputRequired({ status: "needs_more_information" }, { summary: "Formatting failed." }), false);
});

test("Response Engine client notifications prefer submitting recruiter email", () => {
  assert.equal(
    clientNotificationEmail({
      submitter_profile: { work_email: "recruiter@example.com" },
      client_organizations: { billing_email: "billing@example.com" },
    }),
    "recruiter@example.com"
  );
  assert.equal(
    clientNotificationEmail({
      submitter_profile: {},
      client_organizations: { billing_email: "billing@example.com" },
    }),
    "billing@example.com"
  );
});

test("Response Engine requires all requested outputs before release", () => {
  assert.deepEqual(
    outputCoverageFailures(
      ["polished_resume", "mandatory_matrix", "rated_matrix", "combined_grid", "client_template"],
      [
        { fileName: "Candidate Resume Package.docx", outputKeys: ["polished_resume", "client_template"] },
        { fileName: "Criteria Mapping Grid.xlsx", outputKeys: ["mandatory_matrix", "rated_matrix", "combined_grid"] },
      ]
    ),
    []
  );
  const failures = outputCoverageFailures(
    ["polished_resume", "mandatory_matrix", "rated_matrix"],
    [{ fileName: "Candidate Resume Package.docx", outputKeys: ["polished_resume"] }]
  );
  assert.ok(failures.some((failure) => failure.includes("mandatory criteria matrix")));
  assert.ok(failures.some((failure) => failure.includes("rated criteria scoring map")));
});

test("Response Engine release gate requires factual grounding and keyword QA", () => {
  const passingQa = buildPassingQa();
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

test("Response Engine release gate blocks missing human review, fit-gap, and formatting checks", () => {
  const failures = qaReleaseGateFailures(
    buildPassingQa({
      humanEditorialReview: {},
      fitGapAssessment: {},
      formattingQuality: {},
    })
  );

  assert.ok(failures.some((failure) => failure.includes("Human-written resume tone")));
  assert.ok(failures.some((failure) => failure.includes("Generic AI-style language")));
  assert.ok(failures.some((failure) => failure.includes("Em dash and en dash punctuation")));
  assert.ok(failures.some((failure) => failure.includes("Fit-gap assessment is missing")));
  assert.ok(failures.some((failure) => failure.includes("strongMatches and visibleGaps")));
  assert.ok(failures.some((failure) => failure.includes("Consulting-grade document formatting")));
  assert.ok(failures.some((failure) => failure.includes("Grid presentation quality")));
});

test("Response Engine release gate requires source coverage, metadata review, and private evidence map", () => {
  const evidenceMap = {
    claims: [{ claim: "Led requirements workshops", sourceFiles: ["candidate.docx"] }],
    criteriaMappings: [{ requirement: "Five years of BA experience", met: true, sourceFiles: ["candidate.docx"] }],
  };
  const sourceFiles = [{ file_name: "candidate.docx" }];
  assert.deepEqual(
    qaReleaseGateFailures(buildPassingQa(), {
      requireEvidenceMap: true,
      evidenceMap,
      sourceFiles,
    }),
    []
  );

  const failures = qaReleaseGateFailures(
    buildPassingQa({
      factualGrounding: { allClientClaimsSupported: true, noUnsupportedClaims: true, evidenceMapReviewed: false },
      sourceFileCoverage: { allUploadedFilesReviewed: false, filesReviewed: [] },
      metadataReview: {},
    }),
    { requireEvidenceMap: true, evidenceMap: null, sourceFiles }
  );

  assert.ok(failures.some((failure) => failure.includes("Evidence map review")));
  assert.ok(failures.some((failure) => failure.includes("Source file coverage")));
  assert.ok(failures.some((failure) => failure.includes("Evidence map is missing")));
  assert.ok(failures.some((failure) => failure.includes("BA Advisory Desk metadata")));
  assert.ok(failures.some((failure) => failure.includes("restricted-term cleanup")));
});

test("Response Engine text quality scan flags dash punctuation and generic AI phrases", () => {
  const textWithIssues = [
    "Supported delivery",
    "\u2014",
    "dynamic landscape",
    "\u2013",
    "seamlessly",
  ].join(" ");
  const failures = textQualityFailures(textWithIssues, "resume.docx");

  assert.ok(failures.includes("resume.docx contains em dash punctuation."));
  assert.ok(failures.includes("resume.docx contains en dash punctuation."));
  assert.ok(failures.includes("resume.docx contains generic AI-style phrase: dynamic landscape."));
  assert.ok(failures.includes("resume.docx contains generic AI-style phrase: seamlessly."));
  assert.ok(textQualityFailures("This output mentions OpenAI.", "resume.docx").includes("resume.docx contains restricted deliverable term: OpenAI."));
  assert.deepEqual(textQualityFailures("Plain supported evidence in concise sentences.", "resume.docx"), []);
});

test("Response Engine fit-gap and evidence map helpers enforce required structure", () => {
  assert.equal(
    hasRequiredFitGapAssessment("Fit-Gap Assessment. Strong matches: source evidence. Visible gaps: missing dates. Candidate follow-up questions: confirm dates."),
    true
  );
  assert.equal(hasRequiredFitGapAssessment("Fit summary only."), false);
  assert.deepEqual(
    validateEvidenceMap({
      claims: [{ claim: "Built a criteria matrix", sourceFiles: ["grid.xlsx"] }],
      criteriaMappings: [{ requirement: "Matrix experience", met: true, sourceFiles: ["grid.xlsx"] }],
    }),
    []
  );
  assert.ok(validateEvidenceMap({ claims: [{ claim: "Unsupported claim", sourceFiles: [] }] }).some((failure) => failure.includes("source file")));
});
