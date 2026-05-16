import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateCreditLedger,
  renderCreditReport
} from "../src/credit-attestation-ledger.js";
import sampleInput from "../data/sample-credit-input.json" with {type: "json"};

test("builds dashboard counts for verified, review, and disputed credits", () => {
  const result = evaluateCreditLedger(sampleInput);

  assert.equal(result.dashboard.totalCredits, 5);
  assert.equal(result.dashboard.verified, 1);
  assert.equal(result.dashboard.needsReview, 3);
  assert.equal(result.dashboard.disputed, 1);
  assert.equal(result.dashboard.moderationQueue, 4);
});

test("releases reputation only for well-attested credit", () => {
  const result = evaluateCreditLedger(sampleInput);
  const alex = result.records.find(record => record.contributionId === "CR-001");

  assert.equal(alex.state, "verified");
  assert.equal(alex.reputationDelta, 15);
  assert.equal(alex.attestationStrength, 17);
  assert.equal(alex.findings.length, 0);
});

test("routes weak and duplicate credits to review", () => {
  const result = evaluateCreditLedger(sampleInput);
  const bela = result.records.find(record => record.contributionId === "CR-002");

  assert.equal(bela.state, "needs_review");
  assert.ok(bela.findings.some(finding => finding.code === "evidence_missing"));
  assert.ok(bela.findings.some(finding => finding.code === "duplicate_credit_claim"));
});

test("marks unresolved disputes as disputed", () => {
  const result = evaluateCreditLedger(sampleInput);
  const carol = result.records.find(record => record.contributionId === "CR-003");

  assert.equal(carol.state, "disputed");
  assert.equal(carol.reputationDelta, 0);
  assert.ok(carol.findings.some(finding => finding.code === "active_credit_dispute"));
  assert.ok(carol.findings.some(finding => finding.code === "attestor_conflict"));
});

test("creates stable manifest and signatures", () => {
  const first = evaluateCreditLedger(sampleInput);
  const second = evaluateCreditLedger(sampleInput);

  assert.equal(first.manifest.digest, second.manifest.digest);
  assert.deepEqual(
    first.records.map(record => record.event.signature),
    second.records.map(record => record.event.signature)
  );
});

test("renders a reviewer report", () => {
  const report = renderCreditReport(evaluateCreditLedger(sampleInput));

  assert.match(report, /Credit attestation ledger/);
  assert.match(report, /CR-003/);
  assert.match(report, /Manifest digest/);
});
