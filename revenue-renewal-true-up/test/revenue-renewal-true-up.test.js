import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateRenewalPortfolio,
  renderRenewalReport,
  stableStringify
} from "../src/revenue-renewal-true-up.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const samplePath = join(currentDir, "../data/sample-renewal-input.json");

async function loadSample() {
  return JSON.parse(await readFile(samplePath, "utf8"));
}

async function evaluateSample(options = {}) {
  return evaluateRenewalPortfolio(await loadSample(), {
    signingKey: "test-renewal-signing-key",
    ...options
  });
}

test("builds renewal queue decisions and dashboard metrics", async () => {
  const result = await evaluateSample();
  const byId = new Map(result.accounts.map((account) => [account.id, account]));

  assert.equal(result.dashboard.totalAccounts, 4);
  assert.equal(result.dashboard.dueWithin45Days, 2);
  assert.equal(result.dashboard.blocked, 1);
  assert.equal(result.dashboard.review, 1);
  assert.equal(result.dashboard.expansionCandidates, 1);
  assert.equal(result.dashboard.trueUpCents, 738000);
  assert.equal(result.dashboard.computeOverageCents, 26000);
  assert.equal(result.dashboard.churnExposureCents, 2045840);

  assert.equal(byId.get("acct-northstar").status, "blocked");
  assert.equal(byId.get("acct-northstar").trueUpSeatCount, 16);
  assert.equal(byId.get("acct-riverlab").status, "expand");
  assert.equal(byId.get("acct-hillview").status, "review");
  assert.equal(byId.get("acct-clearwater").status, "watch");
});

test("creates deterministic signed events and manifest evidence", async () => {
  const result = await evaluateSample();
  const northstarEvent = result.events.find((event) => event.body.accountId === "acct-northstar");
  const canonicalBody = stableStringify(northstarEvent.body);
  const expectedSignature = createHmac("sha256", "test-renewal-signing-key")
    .update(canonicalBody)
    .digest("hex");

  assert.equal(northstarEvent.signature, expectedSignature);
  assert.match(northstarEvent.id, /^evt_acct-northstar_/);
  assert.equal(result.manifest.entries.length, 4);
  assert.equal(result.manifest.digest.length, 64);

  const secondRun = await evaluateSample();
  assert.deepEqual(secondRun.manifest, result.manifest);
});

test("renders a compact renewal report", async () => {
  const result = await evaluateSample();
  const report = renderRenewalReport(result);

  assert.match(report, /SCIBASE Revenue Renewal True-Up/);
  assert.match(report, /Northstar University Library: blocked/);
  assert.match(report, /River Lab Consortium: expand/);
  assert.match(report, /Manifest digest: [a-f0-9]{64}/);
});

test("requires explicit signing and clear generatedAt values", async () => {
  const sample = await loadSample();

  assert.throws(
    () => evaluateRenewalPortfolio(sample),
    /Expected signingKey/
  );
  assert.throws(
    () => evaluateRenewalPortfolio(sample, { signingKey: "test-renewal-signing-key", generatedAt: "nope" }),
    /Invalid generatedAt/
  );
});
