import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateReproducibilityAudit,
  renderAuditReport
} from "../src/submission-reproducibility-audit.js";
import sampleInput from "../data/sample-repro-input.json" with {type: "json"};

test("summarizes reproducibility decisions for the review queue", () => {
  const result = evaluateReproducibilityAudit(sampleInput);

  assert.equal(result.dashboard.totalSubmissions, 3);
  assert.equal(result.dashboard.reproducible, 1);
  assert.equal(result.dashboard.review, 1);
  assert.equal(result.dashboard.blocked, 1);
  assert.equal(result.dashboard.payoutRelease, 1);
  assert.equal(result.dashboard.payoutHold, 2);
});

test("blocks restricted data packages without NDA coverage", () => {
  const result = evaluateReproducibilityAudit(sampleInput);
  const gamma = result.audits.find(audit => audit.submissionId === "SUB-GAMMA");

  assert.equal(gamma.decision, "blocked");
  assert.equal(gamma.payoutGate, "block_until_fixed");
  assert.ok(gamma.findings.some(finding => finding.code === "restricted_data_without_nda"));
  assert.ok(gamma.findings.some(finding => finding.code === "missing_deliverable"));
});

test("holds packages with failed reruns or drift for reviewer action", () => {
  const result = evaluateReproducibilityAudit(sampleInput);
  const beta = result.audits.find(audit => audit.submissionId === "SUB-BETA");

  assert.equal(beta.decision, "review");
  assert.equal(beta.payoutGate, "hold_for_reviewer");
  assert.ok(beta.score < 75);
  assert.ok(beta.findings.some(finding => finding.code === "metric_drift_exceeded"));
  assert.ok(beta.findings.some(finding => finding.code === "rerun_check_failed"));
});

test("produces deterministic manifest digest and event signatures", () => {
  const first = evaluateReproducibilityAudit(sampleInput);
  const second = evaluateReproducibilityAudit(sampleInput);

  assert.equal(first.manifest.digest, second.manifest.digest);
  assert.deepEqual(
    first.audits.map(audit => audit.event.signature),
    second.audits.map(audit => audit.event.signature)
  );
});

test("renders a reviewer-readable report", () => {
  const result = evaluateReproducibilityAudit(sampleInput);
  const report = renderAuditReport(result);

  assert.match(report, /CRISPR off-target ranking bounty/);
  assert.match(report, /SUB-GAMMA/);
  assert.match(report, /Manifest digest/);
});
