import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  digest,
  evaluateEthicsDataAvailability,
  renderEthicsDataAvailabilityReport
} from "../src/ethics-data-availability-checker.js";

async function loadSample() {
  const samplePath = new URL("../data/sample-ethics-input.json", import.meta.url);
  return JSON.parse(await readFile(samplePath, "utf8"));
}

test("blocks missing claim artifacts while keeping controlled data in review", async () => {
  const result = evaluateEthicsDataAvailability(await loadSample());
  const checks = new Map(result.checks.map((check) => [check.id, check]));

  assert.equal(result.status, "blocked");
  assert.equal(checks.get("ethics").status, "review");
  assert.equal(checks.get("data").status, "ready");
  assert.equal(checks.get("code").status, "ready");
  assert.equal(checks.get("claim-secondary-model").status, "blocked");
  assert.ok(result.reviewerActions.some((action) => action.code === "claim_artifact_not_found"));
});

test("flags public sensitive data and consent scope conflicts", async () => {
  const input = await loadSample();
  input.dataAvailability.repository.visibility = "public";
  const result = evaluateEthicsDataAvailability(input);
  const codes = result.reviewerActions.map((action) => action.code);

  assert.equal(result.status, "blocked");
  assert.ok(codes.includes("sensitive_data_public"));
  assert.ok(codes.includes("consent_scope_conflict"));
});

test("handles full timestamp approval expiry values", async () => {
  const input = await loadSample();
  input.ethics.approval.expiresAt = "2026-05-15T12:00:00.000Z";
  const result = evaluateEthicsDataAvailability(input);
  const codes = result.reviewerActions.map((action) => action.code);

  assert.equal(result.status, "blocked");
  assert.ok(codes.includes("approval_expired"));
});

test("treats timezone-less approval timestamps as UTC", async () => {
  const input = await loadSample();
  input.ethics.approval.expiresAt = "2026-05-15T12:00:00.000";
  const result = evaluateEthicsDataAvailability(input);

  assert.ok(result.reviewerActions.some((action) => action.code === "approval_expired"));
});

test("flags approval, consent, repository, license, and code gaps", async () => {
  const input = await loadSample();
  input.ethics.approval = { status: "pending", expiresAt: "bad-date" };
  input.ethics.consent = { status: "partial", scope: "internal_only" };
  input.ethics.safeguards = [];
  input.ethics.transferBasis = "";
  input.dataAvailability.statement = "TBD";
  input.dataAvailability.repository = {};
  input.dataAvailability.accession = "";
  input.dataAvailability.accessCommittee = "";
  input.dataAvailability.license = "";
  input.dataAvailability.embargoReason = "";
  input.codeAvailability = {
    repository: { url: "https://git.example.org/neuroimmune/analysis" }
  };
  input.claims.push({
    id: "claim-unlinked",
    text: "Unlinked claim needs checks.",
    requiresData: true,
    requiresEthics: true,
    evidenceArtifactIds: []
  });

  const result = evaluateEthicsDataAvailability(input);
  const codes = result.reviewerActions.map((action) => action.code);

  assert.ok(codes.includes("approval_missing"));
  assert.ok(codes.includes("consent_incomplete"));
  assert.ok(codes.includes("vulnerable_group_safeguards_missing"));
  assert.ok(codes.includes("transfer_basis_missing"));
  assert.ok(codes.includes("statement_too_short"));
  assert.ok(codes.includes("repository_missing"));
  assert.ok(codes.includes("access_committee_missing"));
  assert.ok(codes.includes("license_missing"));
  assert.ok(codes.includes("embargo_reason_missing"));
  assert.ok(codes.includes("commit_missing"));
  assert.ok(codes.includes("environment_missing"));
  assert.ok(codes.includes("reproduction_command_missing"));
  assert.ok(codes.includes("claim_data_evidence_missing"));
  assert.ok(codes.includes("claim_ethics_protocol_missing"));
});

test("flags unparseable approval expiry values", async () => {
  const input = await loadSample();
  input.ethics.approval.expiresAt = "not-a-date";
  input.claims[1].evidenceArtifactIds = ["artifact-cytokine-table"];
  const result = evaluateEthicsDataAvailability(input);

  assert.equal(result.status, "review");
  assert.ok(result.reviewerActions.some((action) => action.code === "approval_expiry_invalid"));
});

test("allows a clean ready packet", async () => {
  const input = await loadSample();
  input.ethics.approval.expiresAt = "2027-05-30";
  input.claims[1].evidenceArtifactIds = ["artifact-cytokine-table"];
  const result = evaluateEthicsDataAvailability(input);

  assert.equal(result.status, "ready");
  assert.equal(result.riskScore, 0);
  assert.equal(result.dashboard.blocked, 0);
  assert.equal(result.reviewerActions.length, 0);
});

test("requires generatedAt and signing key", async () => {
  const input = await loadSample();

  assert.throws(() => evaluateEthicsDataAvailability({ ...input, generatedAt: "not-a-date" }), /generatedAt/);
  assert.throws(() => evaluateEthicsDataAvailability({ ...input, signingKey: "short" }), /signingKey/);
});

test("produces deterministic digests and signatures", async () => {
  const input = await loadSample();
  const first = evaluateEthicsDataAvailability(input);
  const second = evaluateEthicsDataAvailability(input);

  assert.equal(first.manifestDigest, second.manifestDigest);
  assert.ok(first.auditEvents.every((event) => /^[a-f0-9]{64}$/.test(event.signature)));
  assert.equal(digest({ b: [2, 3], a: 1 }), digest({ a: 1, b: [2, 3] }));
});

test("renders a reviewer friendly report", async () => {
  const result = evaluateEthicsDataAvailability(await loadSample());
  const report = renderEthicsDataAvailabilityReport(result);

  assert.match(report, /Ethics \+ Data Availability/);
  assert.match(report, /claim_artifact_not_found/);
  assert.match(report, new RegExp(result.manifestDigest.slice(0, 12)));
});
