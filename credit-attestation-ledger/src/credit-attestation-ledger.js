import crypto from "node:crypto";
import fs from "node:fs";

const CREDIT_ROLES = new Set([
  "conceptualization",
  "data-curation",
  "formal-analysis",
  "funding-acquisition",
  "investigation",
  "methodology",
  "project-administration",
  "resources",
  "software",
  "supervision",
  "validation",
  "visualization",
  "writing-original-draft",
  "writing-review-editing"
]);

const ROLE_SCORE = {
  lead: 10,
  reviewer: 7,
  collaborator: 5,
  self: 2
};

const SEVERITY_SCORE = {
  critical: 35,
  high: 22,
  medium: 12,
  low: 5
};

const stableStringify = value => {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }

  return JSON.stringify(value);
};

const digest = value => crypto.createHash("sha256").update(value).digest("hex");

const signLedgerEvent = (event, signingKey) => crypto
  .createHmac("sha256", signingKey)
  .update(stableStringify(event))
  .digest("hex");

const list = value => Array.isArray(value) ? value : [];

const addFinding = (findings, severity, code, message, action) => {
  findings.push({
    severity,
    code,
    score: SEVERITY_SCORE[severity],
    message,
    action
  });
};

const contributionKey = contribution => [
  contribution.contributorId,
  contribution.projectId,
  contribution.artifactId,
  contribution.role
].join(":");

const evidenceCount = contribution => list(contribution.evidence).length;

const attestationStrength = contribution => list(contribution.attestations)
  .reduce((total, attestation) => total + (ROLE_SCORE[attestation.attestorRole] ?? 0), 0);

const hasConflict = (contribution, knownConflicts) => knownConflicts
  .some(conflict => conflict.contributorId === contribution.contributorId
    && conflict.attestorId === contribution.attestorId);

const buildContributionFindings = (contribution, duplicateCount, knownConflicts) => {
  const findings = [];

  if (!CREDIT_ROLES.has(contribution.role)) {
    addFinding(
      findings,
      "critical",
      "unknown_credit_role",
      `${contribution.id} uses unsupported credit role ${contribution.role}.`,
      "Map the contribution to a supported CRediT role before profile display."
    );
  }

  if (!contribution.timestamp) {
    addFinding(
      findings,
      "medium",
      "timestamp_missing",
      `${contribution.id} is missing a timestamp.`,
      "Record the timestamp so project timelines remain auditable."
    );
  }

  if (evidenceCount(contribution) === 0) {
    addFinding(
      findings,
      "high",
      "evidence_missing",
      `${contribution.id} has no artifact, commit, review, or upload evidence.`,
      "Attach at least one evidence record."
    );
  }

  if (attestationStrength(contribution) < 7) {
    addFinding(
      findings,
      "medium",
      "attestation_weak",
      `${contribution.id} needs stronger independent attestation.`,
      "Ask a project lead or reviewer to attest the contribution."
    );
  }

  if (list(contribution.disputes).some(dispute => dispute.status !== "resolved")) {
    addFinding(
      findings,
      "critical",
      "active_credit_dispute",
      `${contribution.id} has an unresolved credit dispute.`,
      "Route the dispute to moderation before reputation credit is granted."
    );
  }

  if (duplicateCount > 1) {
    addFinding(
      findings,
      "high",
      "duplicate_credit_claim",
      `${contribution.id} overlaps another claim for the same contributor, artifact, project, and role.`,
      "Merge or reject duplicate credit claims."
    );
  }

  if (hasConflict(contribution, knownConflicts)) {
    addFinding(
      findings,
      "medium",
      "attestor_conflict",
      `${contribution.id} includes an attestor conflict.`,
      "Request an independent attestation."
    );
  }

  return findings.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
};

const decideCreditState = findings => {
  if (findings.some(finding => finding.code === "active_credit_dispute")) {
    return "disputed";
  }

  if (findings.some(finding => finding.severity === "critical" || finding.severity === "high")) {
    return "needs_review";
  }

  return "verified";
};

const reputationDelta = (state, findings, contribution) => {
  if (state === "disputed") {
    return 0;
  }

  const base = state === "verified" ? 12 : 4;
  const roleBonus = contribution.role === "software" || contribution.role === "validation" ? 3 : 1;
  const penalty = findings.reduce((total, finding) => total + Math.min(6, finding.score / 6), 0);
  return Math.max(0, Math.round(base + roleBonus - penalty));
};

const buildCreditRecord = (contribution, duplicateCount, knownConflicts, signingKey) => {
  const findings = buildContributionFindings(contribution, duplicateCount, knownConflicts);
  const state = decideCreditState(findings);
  const event = {
    type: "community.credit_attested",
    contributionId: contribution.id,
    contributorId: contribution.contributorId,
    projectId: contribution.projectId,
    artifactId: contribution.artifactId,
    role: contribution.role,
    state,
    reputationDelta: reputationDelta(state, findings, contribution),
    findingCount: findings.length
  };

  return {
    contributionId: contribution.id,
    contributorId: contribution.contributorId,
    contributorName: contribution.contributorName,
    projectId: contribution.projectId,
    artifactId: contribution.artifactId,
    role: contribution.role,
    state,
    evidenceDigest: digest(stableStringify(contribution.evidence ?? [])),
    attestationStrength: attestationStrength(contribution),
    reputationDelta: event.reputationDelta,
    findings,
    event: {
      ...event,
      signature: signLedgerEvent(event, signingKey)
    }
  };
};

const buildDashboard = records => {
  const dashboard = {
    totalCredits: records.length,
    verified: 0,
    needsReview: 0,
    disputed: 0,
    reputationReleased: 0,
    moderationQueue: 0
  };

  for (const record of records) {
    dashboard.verified += record.state === "verified" ? 1 : 0;
    dashboard.needsReview += record.state === "needs_review" ? 1 : 0;
    dashboard.disputed += record.state === "disputed" ? 1 : 0;
    dashboard.reputationReleased += record.reputationDelta;
    dashboard.moderationQueue += record.state === "verified" ? 0 : 1;
  }

  return dashboard;
};

const buildContributorProfiles = records => {
  const profiles = new Map();

  for (const record of records) {
    const profile = profiles.get(record.contributorId) ?? {
      contributorId: record.contributorId,
      contributorName: record.contributorName,
      verifiedCredits: 0,
      pendingCredits: 0,
      disputedCredits: 0,
      reputationDelta: 0,
      roles: {}
    };

    profile.verifiedCredits += record.state === "verified" ? 1 : 0;
    profile.pendingCredits += record.state === "needs_review" ? 1 : 0;
    profile.disputedCredits += record.state === "disputed" ? 1 : 0;
    profile.reputationDelta += record.reputationDelta;
    profile.roles[record.role] = (profile.roles[record.role] ?? 0) + 1;
    profiles.set(record.contributorId, profile);
  }

  return [...profiles.values()].sort((a, b) => b.reputationDelta - a.reputationDelta || a.contributorName.localeCompare(b.contributorName));
};

export const evaluateCreditLedger = input => {
  const signingKey = input.signingKey ?? "local-credit-key";
  const duplicateCounts = new Map();

  for (const contribution of list(input.contributions)) {
    const key = contributionKey(contribution);
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
  }

  const records = list(input.contributions)
    .map(contribution => buildCreditRecord(
      contribution,
      duplicateCounts.get(contributionKey(contribution)) ?? 0,
      list(input.knownConflicts),
      signingKey
    ))
    .sort((a, b) => {
      const stateRank = {disputed: 0, needs_review: 1, verified: 2};
      return stateRank[a.state] - stateRank[b.state] || a.contributionId.localeCompare(b.contributionId);
    });

  const manifest = {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    projectCount: new Set(records.map(record => record.projectId)).size,
    creditCount: records.length,
    recordDigests: records.map(record => digest(stableStringify({
      contributionId: record.contributionId,
      state: record.state,
      findings: record.findings.map(finding => finding.code)
    })))
  };

  return {
    dashboard: buildDashboard(records),
    records,
    profiles: buildContributorProfiles(records),
    manifest: {
      ...manifest,
      digest: digest(stableStringify(manifest))
    }
  };
};

export const renderCreditReport = result => {
  const lines = [
    "Credit attestation ledger",
    `Credits: ${result.dashboard.totalCredits}`,
    `Verified: ${result.dashboard.verified}`,
    `Needs review: ${result.dashboard.needsReview}`,
    `Disputed: ${result.dashboard.disputed}`,
    `Moderation queue: ${result.dashboard.moderationQueue}`,
    "",
    "Credit queue:"
  ];

  for (const record of result.records) {
    lines.push(`- ${record.contributionId} (${record.contributorName}): ${record.role}, ${record.state}, reputation +${record.reputationDelta}`);
    for (const finding of record.findings.slice(0, 2)) {
      lines.push(`  - ${finding.severity}: ${finding.message}`);
    }
  }

  lines.push("");
  lines.push(`Manifest digest: ${result.manifest.digest}`);
  return lines.join("\n");
};

export const readCreditInput = filePath => JSON.parse(fs.readFileSync(filePath, "utf8"));
