import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateResidency, renderTextReport } from "../src/data-residency-guard.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(moduleDir, "..");
const input = JSON.parse(
  fs.readFileSync(path.join(rootDir, "data", "sample-residency-input.json"), "utf8")
);

test("evaluates data residency transfer decisions", () => {
  const report = evaluateResidency(input);
  const byId = new Map(report.results.map((result) => [result.id, result]));

  assert.equal(report.dashboard.metrics.total, 6);
  assert.equal(report.dashboard.metrics.approved, 3);
  assert.equal(report.dashboard.metrics.review, 1);
  assert.equal(report.dashboard.metrics.blocked, 2);
  assert.equal(report.dashboard.metrics.crossBorder, 3);
  assert.equal(report.dashboard.metrics.criticalFindings, 5);
  assert.equal(report.dashboard.byRegime.GDPR, 3);
  assert.equal(report.dashboard.byRegime.HIPAA, 1);
  assert.equal(report.dashboard.byRegime.UKRI, 2);

  assert.equal(byId.get("rec-eu-clinical-supplement").decision, "blocked");
  assert.deepEqual(
    byId.get("rec-eu-clinical-supplement").findings.map((finding) => finding.code),
    ["REGION_OUTSIDE_POLICY", "MISSING_DPA", "NO_ADEQUACY_OR_SCC", "BLOCKED_CLASSIFICATION", "HUMAN_SUBJECT_REVIEW"]
  );

  assert.equal(byId.get("rec-us-patient-dashboard").decision, "review");
  assert.equal(byId.get("rec-uk-grant-report").decision, "approved");
  assert.equal(byId.get("rec-eu-embargoed-preprint").decision, "blocked");
});

test("builds stable webhook signatures and export manifest evidence", () => {
  const first = evaluateResidency(input);
  const second = evaluateResidency(input);

  assert.equal(first.auditDigest, second.auditDigest);
  assert.equal(first.webhookEvents.length, input.records.length);
  assert.ok(first.webhookEvents.every((event) => event.signature.startsWith("sha256=")));
  assert.match(first.exportManifest.packageId, /^residency-[a-f0-9]{12}$/);
  assert.equal(first.exportManifest.entries[2].decision, "blocked");
  assert.ok(first.exportManifest.entries[2].findingCodes.includes("BLOCKED_CLASSIFICATION"));
});

test("renders a reviewer-friendly text report", () => {
  const report = evaluateResidency(input);
  const output = renderTextReport(report);

  assert.match(output, /SCIBASE data residency guard/);
  assert.match(output, /Transfers: 6/);
  assert.match(output, /Blocked: 2/);
  assert.match(output, /rec-eu-embargoed-preprint: blocked/);
});
