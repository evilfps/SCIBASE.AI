import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  digest,
  evaluateIdentityPortability,
  renderIdentityPortabilityReport
} from "../src/identity-merge-portability-ledger.js";

async function loadSample() {
  const samplePath = new URL("../data/sample-identity-input.json", import.meta.url);
  return JSON.parse(await readFile(samplePath, "utf8"));
}

test("classifies merge requests by conflict severity", async () => {
  const result = evaluateIdentityPortability(await loadSample());
  const statuses = new Map(result.mergeDecisions.map((decision) => [decision.requestId, decision.status]));

  assert.equal(statuses.get("merge-ada-001"), "auto_merge");
  assert.equal(statuses.get("merge-mira-service-002"), "reviewer_hold");
  assert.equal(statuses.get("merge-missing-003"), "blocked");
  assert.equal(result.dashboard.autoMerge, 1);
  assert.equal(result.dashboard.reviewerHold, 1);
  assert.equal(result.dashboard.blocked, 1);
});

test("creates project owner and role transfer actions for duplicate accounts", async () => {
  const result = evaluateIdentityPortability(await loadSample());
  const decision = result.mergeDecisions.find((item) => item.requestId === "merge-ada-001");

  assert.ok(decision.actions.some((action) => action.code === "transfer_project_owner"));
  assert.ok(decision.actions.some((action) => action.code === "repoint_object_grant"));
  assert.equal(result.dashboard.projectRoleTransfers, 0);
});

test("allows self private exports with MFA and holds risky exports", async () => {
  const result = evaluateIdentityPortability(await loadSample());
  const exportsById = new Map(result.exportPackages.map((item) => [item.requestId, item]));

  assert.equal(exportsById.get("export-ada-full").status, "ready");
  assert.ok(exportsById.get("export-ada-full").privateProfile.email.includes("@northbridge.edu"));
  assert.equal(exportsById.get("export-mira-third-party").status, "review");
  assert.ok(exportsById.get("export-mira-third-party").redactions.includes("third_party_private_fields"));
  assert.equal(exportsById.get("export-service-public").status, "ready");
  assert.equal(exportsById.get("export-service-public").privateProfile, null);
});

test("produces deterministic digests and signed audit events", async () => {
  const input = await loadSample();
  const first = evaluateIdentityPortability(input);
  const second = evaluateIdentityPortability(input);

  assert.equal(first.manifestDigest, second.manifestDigest);
  assert.equal(first.auditEvents.length, 6);
  assert.ok(first.auditEvents.every((event) => /^[a-f0-9]{64}$/.test(event.signature)));
  assert.equal(digest({ a: 1, b: [2, 3] }), digest({ b: [2, 3], a: 1 }));
});

test("renders a reviewer friendly report", async () => {
  const result = evaluateIdentityPortability(await loadSample());
  const report = renderIdentityPortabilityReport(result);

  assert.match(report, /Identity Merge \+ Profile Export/);
  assert.match(report, /merge-ada-001: auto_merge/);
  assert.match(report, /export-mira-third-party: review/);
  assert.match(report, new RegExp(result.manifestDigest.slice(0, 12)));
});
