import crypto from "node:crypto";
import fs from "node:fs";

const SEVERITY_WEIGHT = {
  critical: 35,
  high: 22,
  medium: 12,
  low: 5
};

const DECISION_RANK = {
  reproducible: 0,
  review: 1,
  blocked: 2
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

const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");

const signEvent = (event, signingKey) => crypto
  .createHmac("sha256", signingKey)
  .update(stableStringify(event))
  .digest("hex");

const normalizeArray = value => Array.isArray(value) ? value : [];

const addFinding = (findings, code, severity, message, action) => {
  findings.push({
    code,
    severity,
    weight: SEVERITY_WEIGHT[severity],
    message,
    action
  });
};

const countMissingHashes = artifacts => normalizeArray(artifacts)
  .filter(artifact => !artifact.sha256 || artifact.sha256.length < 32)
  .length;

const countFailedChecks = rerun => normalizeArray(rerun?.checks)
  .filter(check => check.status !== "pass")
  .length;

const maxMetricDrift = rerun => normalizeArray(rerun?.metrics)
  .reduce((maximum, metric) => Math.max(maximum, Math.abs(metric.driftPercent ?? 0)), 0);

const hasRestrictedDataGap = submission => normalizeArray(submission.datasets)
  .some(dataset => dataset.access === "restricted" && !dataset.ndaConfirmed);

const hasDependencyPins = environment => normalizeArray(environment?.dependencies)
  .every(dependency => Boolean(dependency.version) && !/[x*]/i.test(dependency.version));

const scoreSubmission = findings => Math.max(
  0,
  100 - findings.reduce((total, finding) => total + finding.weight, 0)
);

const decideSubmission = (score, findings) => {
  if (findings.some(finding => finding.severity === "critical")) {
    return "blocked";
  }

  if (score < 75 || findings.some(finding => finding.severity === "high")) {
    return "review";
  }

  return "reproducible";
};

const payoutGateForDecision = decision => {
  if (decision === "reproducible") {
    return "release";
  }

  if (decision === "review") {
    return "hold_for_reviewer";
  }

  return "block_until_fixed";
};

const buildSubmissionFindings = (challenge, submission) => {
  const findings = [];
  const expectedDeliverables = normalizeArray(challenge.requiredDeliverables);
  const deliveredTypes = new Set(normalizeArray(submission.artifacts).map(artifact => artifact.type));

  for (const deliverable of expectedDeliverables) {
    if (!deliveredTypes.has(deliverable)) {
      addFinding(
        findings,
        "missing_deliverable",
        "critical",
        `${submission.id} is missing required deliverable ${deliverable}.`,
        "Attach the missing deliverable before reward review."
      );
    }
  }

  const missingHashes = countMissingHashes(submission.artifacts);
  if (missingHashes > 0) {
    addFinding(
      findings,
      "artifact_hash_missing",
      "high",
      `${missingHashes} artifact record is missing a usable SHA-256 hash.`,
      "Regenerate the manifest with hashes for every uploaded artifact."
    );
  }

  if (!submission.environment?.containerDigest) {
    addFinding(
      findings,
      "container_digest_missing",
      "medium",
      "The runtime container digest is missing.",
      "Pin the execution image by digest."
    );
  }

  if (!submission.environment?.lockfilePresent) {
    addFinding(
      findings,
      "lockfile_missing",
      "medium",
      "The dependency lockfile is missing.",
      "Commit the package lockfile used for the submitted run."
    );
  }

  if (!hasDependencyPins(submission.environment)) {
    addFinding(
      findings,
      "dependency_unpinned",
      "medium",
      "One or more dependencies are not pinned to exact versions.",
      "Pin dependency versions before final arbitration."
    );
  }

  if (!submission.reproduction?.seed) {
    addFinding(
      findings,
      "seed_missing",
      "low",
      "No deterministic seed is declared for the rerun.",
      "Record the seed or explain why the run is non-deterministic."
    );
  }

  const failedChecks = countFailedChecks(submission.reproduction);
  if (failedChecks > 0) {
    addFinding(
      findings,
      "rerun_check_failed",
      "high",
      `${failedChecks} rerun check did not pass.`,
      "Fix the rerun failure or provide reviewer evidence."
    );
  }

  const maxDrift = maxMetricDrift(submission.reproduction);
  const allowedDrift = challenge.acceptance?.maxMetricDriftPercent ?? 2;
  if (maxDrift > allowedDrift) {
    addFinding(
      findings,
      "metric_drift_exceeded",
      "high",
      `Maximum metric drift is ${maxDrift}% with a ${allowedDrift}% limit.`,
      "Reproduce the result within the declared drift threshold."
    );
  }

  if (hasRestrictedDataGap(submission)) {
    addFinding(
      findings,
      "restricted_data_without_nda",
      "critical",
      "Restricted data is referenced without confirmed NDA coverage.",
      "Confirm NDA coverage or remove restricted data from the package."
    );
  }

  if (submission.notebook?.executedCleanly === false) {
    addFinding(
      findings,
      "notebook_execution_dirty",
      "medium",
      "Notebook execution did not complete cleanly from a fresh kernel.",
      "Rerun the notebook from a fresh kernel and update outputs."
    );
  }

  return findings.sort((a, b) => b.weight - a.weight || a.code.localeCompare(b.code));
};

const auditSubmission = (challenge, submission, signingKey) => {
  const findings = buildSubmissionFindings(challenge, submission);
  const score = scoreSubmission(findings);
  const decision = decideSubmission(score, findings);
  const payoutGate = payoutGateForDecision(decision);
  const manifest = {
    submissionId: submission.id,
    challengeId: challenge.id,
    score,
    decision,
    payoutGate,
    artifactDigest: sha256(stableStringify(submission.artifacts ?? [])),
    environmentDigest: sha256(stableStringify(submission.environment ?? {})),
    reproductionDigest: sha256(stableStringify(submission.reproduction ?? {})),
    findingCodes: findings.map(finding => finding.code)
  };
  const event = {
    type: "submission.reproducibility_audited",
    challengeId: challenge.id,
    submissionId: submission.id,
    team: submission.team,
    decision,
    payoutGate,
    score,
    findingCount: findings.length
  };

  return {
    ...manifest,
    team: submission.team,
    findings,
    event: {
      ...event,
      signature: signEvent(event, signingKey)
    }
  };
};

const buildDashboard = audits => {
  const initial = {
    totalSubmissions: audits.length,
    reproducible: 0,
    review: 0,
    blocked: 0,
    payoutRelease: 0,
    payoutHold: 0,
    averageScore: 0,
    criticalFindings: 0
  };

  const summary = audits.reduce((dashboard, audit) => {
    dashboard[audit.decision] += 1;
    dashboard.payoutRelease += audit.payoutGate === "release" ? 1 : 0;
    dashboard.payoutHold += audit.payoutGate !== "release" ? 1 : 0;
    dashboard.averageScore += audit.score;
    dashboard.criticalFindings += audit.findings.filter(finding => finding.severity === "critical").length;
    return dashboard;
  }, initial);

  summary.averageScore = audits.length === 0 ? 0 : Math.round(summary.averageScore / audits.length);
  return summary;
};

const sortAudits = audits => [...audits].sort((a, b) => (
  DECISION_RANK[b.decision] - DECISION_RANK[a.decision]
  || a.score - b.score
  || a.submissionId.localeCompare(b.submissionId)
));

export const evaluateReproducibilityAudit = input => {
  const signingKey = input.signingKey ?? "local-review-key";
  const challenge = input.challenge ?? {};
  const audits = normalizeArray(input.submissions)
    .map(submission => auditSubmission(challenge, submission, signingKey));

  const dashboard = buildDashboard(audits);
  const manifest = {
    challengeId: challenge.id,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    submissionCount: audits.length,
    dashboard,
    orderedSubmissionIds: sortAudits(audits).map(audit => audit.submissionId)
  };

  return {
    challenge,
    dashboard,
    audits: sortAudits(audits),
    manifest: {
      ...manifest,
      digest: sha256(stableStringify(manifest))
    }
  };
};

export const renderAuditReport = auditResult => {
  const lines = [
    `Reproducibility audit: ${auditResult.challenge.title}`,
    `Challenge: ${auditResult.challenge.id}`,
    `Submissions: ${auditResult.dashboard.totalSubmissions}`,
    `Ready: ${auditResult.dashboard.reproducible}`,
    `Review: ${auditResult.dashboard.review}`,
    `Blocked: ${auditResult.dashboard.blocked}`,
    `Average score: ${auditResult.dashboard.averageScore}`,
    "",
    "Submission queue:"
  ];

  for (const audit of auditResult.audits) {
    lines.push(`- ${audit.submissionId} (${audit.team}): ${audit.decision}, score ${audit.score}, gate ${audit.payoutGate}`);
    for (const finding of audit.findings.slice(0, 3)) {
      lines.push(`  - ${finding.severity}: ${finding.message}`);
    }
  }

  lines.push("");
  lines.push(`Manifest digest: ${auditResult.manifest.digest}`);
  return lines.join("\n");
};

export const readAuditInput = filePath => JSON.parse(fs.readFileSync(filePath, "utf8"));
