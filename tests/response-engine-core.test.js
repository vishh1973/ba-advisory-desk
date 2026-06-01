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
