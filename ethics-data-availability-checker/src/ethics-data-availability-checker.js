import { createHmac, createHash } from "node:crypto";

const SEVERITY_WEIGHT = {
  high: 30,
  medium: 15,
  low: 5
};

const STATUS_RANK = {
  ready: 0,
  review: 1,
  blocked: 2
};

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digest(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function signEvent(event, signingKey) {
  return createHmac("sha256", signingKey).update(stableStringify(event)).digest("hex");
}

function parseDateLike(value) {
  if (!value) {
    return null;
  }
  const text = String(value);
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00Z`)
    : new Date(hasTimezone ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntil(dateString, generatedAt) {
  const target = parseDateLike(dateString);
  if (!target) {
    return null;
  }
  const generated = new Date(generatedAt);
  return Math.ceil((target.getTime() - generated.getTime()) / 86_400_000);
}

function addFinding(findings, code, severity, message, owner, action) {
  findings.push({
    code,
    severity,
    weight: SEVERITY_WEIGHT[severity],
    message,
    owner,
    action
  });
}

function worstStatus(items) {
  return items.reduce((status, item) => {
    if (STATUS_RANK[item.status] > STATUS_RANK[status]) {
      return item.status;
    }
    return status;
  }, "ready");
}

function buildEthicsCheck(input) {
  const ethics = input.ethics || {};
  const findings = [];
  const approval = ethics.approval || {};
  const consent = ethics.consent || {};

  if (ethics.humanSubjects && approval.status !== "approved") {
    addFinding(
      findings,
      "approval_missing",
      "high",
      "Human-subjects work needs approved review before release.",
      "ethics_board",
      "Attach the approval record or hold submission."
    );
  }

  const expiryDays = daysUntil(approval.expiresAt, input.generatedAt);
  if (approval.status === "approved" && approval.expiresAt && expiryDays === null) {
    addFinding(
      findings,
      "approval_expiry_invalid",
      "medium",
      "Approval expiry date cannot be parsed.",
      "ethics_board",
      "Replace the expiry value with an ISO date or timestamp."
    );
  } else if (approval.status === "approved" && expiryDays !== null && expiryDays < 0) {
    addFinding(
      findings,
      "approval_expired",
      "high",
      `Approval expired ${Math.abs(expiryDays)} days ago.`,
      "ethics_board",
      "Renew the approval before release."
    );
  } else if (approval.status === "approved" && expiryDays !== null && expiryDays <= 30) {
    addFinding(
      findings,
      "approval_expiring",
      "medium",
      `Approval expires in ${expiryDays} days.`,
      "ethics_board",
      "Confirm renewal timing before publication."
    );
  }

  if (ethics.humanSubjects && consent.status !== "complete") {
    addFinding(
      findings,
      "consent_incomplete",
      "high",
      "Consent coverage is incomplete for participant data.",
      "study_team",
      "Resolve consent gaps or remove affected records."
    );
  }

  if (consent.scope === "internal_only" && input.dataAvailability?.repository?.visibility === "public") {
    addFinding(
      findings,
      "consent_scope_conflict",
      "high",
      "Consent scope does not allow public data release.",
      "data_steward",
      "Use controlled access or update the data package."
    );
  }

  if (ethics.vulnerablePopulation && !ethics.safeguards?.length) {
    addFinding(
      findings,
      "vulnerable_group_safeguards_missing",
      "medium",
      "Vulnerable group safeguards are not documented.",
      "study_team",
      "Add safeguard notes for reviewer signoff."
    );
  }

  if (ethics.crossBorderTransfer && !ethics.transferBasis) {
    addFinding(
      findings,
      "transfer_basis_missing",
      "medium",
      "Cross-border participant data transfer needs a legal basis.",
      "data_steward",
      "Record the transfer basis or restrict export."
    );
  }

  return {
    id: "ethics",
    status: findings.some((finding) => finding.severity === "high") ? "blocked" : findings.length ? "review" : "ready",
    findings
  };
}

function buildDataCheck(input) {
  const data = input.dataAvailability || {};
  const repository = data.repository || {};
  const findings = [];

  if (!data.statement || data.statement.trim().length < 30) {
    addFinding(
      findings,
      "statement_too_short",
      "medium",
      "Data availability statement is missing or too short.",
      "corresponding_author",
      "Add repository, accession, restrictions, and reuse terms."
    );
  }

  if (data.sensitiveData && repository.visibility === "public") {
    addFinding(
      findings,
      "sensitive_data_public",
      "high",
      "Sensitive data is marked for public release.",
      "data_steward",
      "Move the data to controlled access or publish a redacted package."
    );
  }

  if (data.sensitiveData && !data.accessCommittee) {
    addFinding(
      findings,
      "access_committee_missing",
      "medium",
      "Controlled data needs an access committee or approval path.",
      "data_steward",
      "Name the access committee and request process."
    );
  }

  if (!repository.url && !data.accession) {
    addFinding(
      findings,
      "repository_missing",
      "medium",
      "No repository URL or accession is recorded.",
      "data_steward",
      "Add a persistent repository location."
    );
  }

  if (!data.license) {
    addFinding(
      findings,
      "license_missing",
      "low",
      "Reuse license is not listed.",
      "data_steward",
      "Add license terms for data reuse."
    );
  }

  if (data.embargoUntil && !data.embargoReason) {
    addFinding(
      findings,
      "embargo_reason_missing",
      "medium",
      "Embargo date is set without a reviewer-facing reason.",
      "corresponding_author",
      "Explain the embargo and release trigger."
    );
  }

  return {
    id: "data",
    status: findings.some((finding) => finding.severity === "high") ? "blocked" : findings.length ? "review" : "ready",
    findings
  };
}

function buildCodeCheck(input) {
  const code = input.codeAvailability || {};
  const findings = [];

  if (!code.repository?.url) {
    addFinding(
      findings,
      "code_repository_missing",
      "medium",
      "Code repository is missing.",
      "corresponding_author",
      "Add a repository link or explain why code cannot be shared."
    );
  }

  if (code.repository?.url && !code.repository.commit) {
    addFinding(
      findings,
      "commit_missing",
      "medium",
      "Code repository is not pinned to a commit.",
      "corresponding_author",
      "Add an immutable commit or release tag."
    );
  }

  if (!code.environment) {
    addFinding(
      findings,
      "environment_missing",
      "medium",
      "Runtime environment is not described.",
      "reproducibility_reviewer",
      "Add Dockerfile, lockfile, or environment file details."
    );
  }

  if (!code.reproductionCommand) {
    addFinding(
      findings,
      "reproduction_command_missing",
      "low",
      "Reproduction command is not recorded.",
      "reproducibility_reviewer",
      "Add the command used to rebuild the reported outputs."
    );
  }

  return {
    id: "code",
    status: findings.some((finding) => finding.severity === "high") ? "blocked" : findings.length ? "review" : "ready",
    findings
  };
}

function buildClaimChecks(input) {
  const artifactIds = new Set((input.artifacts || []).map((artifact) => artifact.id));
  return (input.claims || []).map((claim) => {
    const findings = [];
    const linkedArtifacts = claim.evidenceArtifactIds || [];

    if (claim.requiresData && linkedArtifacts.length === 0) {
      addFinding(
        findings,
        "claim_data_evidence_missing",
        "high",
        `Claim ${claim.id} needs linked data evidence.`,
        "corresponding_author",
        "Link a dataset, figure source, or analysis output."
      );
    }

    const missingArtifacts = linkedArtifacts.filter((artifactId) => !artifactIds.has(artifactId));
    if (missingArtifacts.length) {
      addFinding(
        findings,
        "claim_artifact_not_found",
        "high",
        `Claim ${claim.id} references missing artifacts: ${missingArtifacts.join(", ")}.`,
        "corresponding_author",
        "Attach the missing artifacts or update the evidence links."
      );
    }

    if (claim.requiresEthics && !input.ethics?.approval?.protocolId) {
      addFinding(
        findings,
        "claim_ethics_protocol_missing",
        "high",
        `Claim ${claim.id} needs an ethics protocol reference.`,
        "ethics_board",
        "Add the protocol id that covers this claim."
      );
    }

    return {
      id: claim.id,
      status: findings.some((finding) => finding.severity === "high") ? "blocked" : findings.length ? "review" : "ready",
      findings
    };
  });
}

function buildReviewerActions(checks) {
  return checks
    .flatMap((check) => check.findings.map((finding) => ({
      checkId: check.id,
      code: finding.code,
      severity: finding.severity,
      owner: finding.owner,
      action: finding.action
    })))
    .sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] || a.code.localeCompare(b.code));
}

function buildAuditEvents(result, input) {
  const baseEvents = [
    {
      type: "ethics_data_readiness_evaluated",
      projectId: input.project?.id,
      status: result.status,
      riskScore: result.riskScore,
      at: input.generatedAt
    },
    {
      type: "reviewer_actions_created",
      projectId: input.project?.id,
      actionCount: result.reviewerActions.length,
      at: input.generatedAt
    }
  ];

  return baseEvents.map((event) => ({
    ...event,
    signature: signEvent(event, input.signingKey)
  }));
}

export function evaluateEthicsDataAvailability(input) {
  if (!input?.generatedAt || Number.isNaN(new Date(input.generatedAt).getTime())) {
    throw new Error("A valid generatedAt timestamp is required.");
  }
  if (!input.signingKey || input.signingKey.length < 8) {
    throw new Error("A signingKey of at least 8 characters is required.");
  }

  const primaryChecks = [buildEthicsCheck(input), buildDataCheck(input), buildCodeCheck(input)];
  const claimChecks = buildClaimChecks(input);
  const checks = [...primaryChecks, ...claimChecks];
  const status = worstStatus(checks);
  const reviewerActions = buildReviewerActions(checks);
  const riskScore = Math.min(
    100,
    checks.flatMap((check) => check.findings).reduce((total, finding) => total + finding.weight, 0)
  );

  const result = {
    projectId: input.project?.id,
    projectTitle: input.project?.title,
    generatedAt: input.generatedAt,
    status,
    riskScore,
    dashboard: {
      ready: checks.filter((check) => check.status === "ready").length,
      review: checks.filter((check) => check.status === "review").length,
      blocked: checks.filter((check) => check.status === "blocked").length,
      reviewerActions: reviewerActions.length
    },
    checks,
    reviewerActions
  };

  result.manifestDigest = digest({
    projectId: result.projectId,
    generatedAt: result.generatedAt,
    checks: result.checks,
    reviewerActions: result.reviewerActions
  });
  result.auditEvents = buildAuditEvents(result, input);
  return result;
}

export function renderEthicsDataAvailabilityReport(result) {
  const lines = [
    "Ethics + Data Availability",
    `${result.projectTitle || result.projectId}: ${result.status} (${result.riskScore}/100)`,
    `Checks ready/review/blocked: ${result.dashboard.ready}/${result.dashboard.review}/${result.dashboard.blocked}`,
    `Manifest: ${result.manifestDigest.slice(0, 16)}`,
    "",
    "Reviewer actions:"
  ];

  for (const action of result.reviewerActions.slice(0, 8)) {
    lines.push(`- ${action.severity} ${action.code}: ${action.action}`);
  }

  if (result.reviewerActions.length === 0) {
    lines.push("- none");
  }

  return lines.join("\n");
}
