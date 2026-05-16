import { createHash, createHmac } from "node:crypto";

const DEFAULT_POLICY = {
  signingKey: "scibase-local-demo-signing-key",
  verifiedEvidenceMinimum: 1,
  privateExportRequiresMfa: true,
  thirdPartyPrivateExportRequiresReview: true,
  conflictProviderWeights: {
    orcid: 40,
    saml: 35,
    github: 20,
    google: 15,
    linkedin: 15,
    email: 10
  }
};

export function evaluateIdentityPortability(input) {
  const policy = { ...DEFAULT_POLICY, ...(input.policy ?? {}) };
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const accounts = input.accounts ?? [];
  const projects = input.projects ?? [];
  const accountIndex = new Map(accounts.map((account) => [account.id, account]));
  const providerIndex = buildProviderIndex(accounts);

  const mergeDecisions = (input.mergeRequests ?? []).map((request) =>
    evaluateMergeRequest({ request, accountIndex, providerIndex, projects, policy })
  );
  const exportPackages = (input.profileExports ?? []).map((request) =>
    evaluateProfileExport({ request, accountIndex, projects, policy })
  );

  const auditEvents = [
    ...mergeDecisions.map((decision) =>
      signEvent(
        {
          type: `identity_merge.${decision.status}`,
          subjectId: decision.requestId,
          accountIds: decision.accountIds,
          findingCount: decision.findings.length,
          actionCount: decision.actions.length
        },
        generatedAt,
        policy.signingKey
      )
    ),
    ...exportPackages.map((exportPackage) =>
      signEvent(
        {
          type: `profile_export.${exportPackage.status}`,
          subjectId: exportPackage.requestId,
          accountId: exportPackage.accountId,
          redactionCount: exportPackage.redactions.length,
          projectCount: exportPackage.projects.length
        },
        generatedAt,
        policy.signingKey
      )
    )
  ];

  const dashboard = buildDashboard(mergeDecisions, exportPackages, auditEvents);
  const manifestDigest = digest({
    generatedAt,
    dashboard,
    mergeDecisions: mergeDecisions.map(stripVolatileFields),
    exportPackages: exportPackages.map(stripVolatileFields),
    auditEvents
  });

  return {
    generatedAt,
    dashboard: {
      ...dashboard,
      manifestDigest
    },
    mergeDecisions,
    exportPackages,
    auditEvents,
    manifestDigest
  };
}

export function renderIdentityPortabilityReport(result) {
  const lines = [
    "SCIBASE Identity Merge + Profile Export",
    `Generated: ${result.generatedAt}`,
    "",
    "Dashboard",
    `- Merge requests: ${result.dashboard.mergeRequests}`,
    `- Auto merge: ${result.dashboard.autoMerge}`,
    `- Reviewer hold: ${result.dashboard.reviewerHold}`,
    `- Blocked: ${result.dashboard.blocked}`,
    `- Exports ready: ${result.dashboard.exportsReady}`,
    `- Exports held: ${result.dashboard.exportsHeld}`,
    `- Project role transfers: ${result.dashboard.projectRoleTransfers}`,
    `- Manifest: ${result.manifestDigest}`,
    "",
    "Merge queue"
  ];

  for (const decision of result.mergeDecisions) {
    lines.push(
      `- ${decision.requestId}: ${decision.status} for ${decision.accountIds.join(", ")}`
    );
    for (const finding of decision.findings) {
      lines.push(`  ${finding.severity}: ${finding.message}`);
    }
    for (const action of decision.actions) {
      lines.push(`  action: ${action.message}`);
    }
  }

  lines.push("", "Exports");
  for (const exportPackage of result.exportPackages) {
    lines.push(
      `- ${exportPackage.requestId}: ${exportPackage.status} ${exportPackage.accountId} ${exportPackage.format}`
    );
    if (exportPackage.redactions.length > 0) {
      lines.push(`  redacted: ${exportPackage.redactions.join(", ")}`);
    }
    lines.push(`  digest: ${exportPackage.exportDigest}`);
  }

  return lines.join("\n");
}

function evaluateMergeRequest({ request, accountIndex, providerIndex, projects, policy }) {
  const accountIds = [request.primaryAccountId, ...(request.duplicateAccountIds ?? [])];
  const accounts = accountIds.map((id) => accountIndex.get(id)).filter(Boolean);
  const findings = [];
  const actions = [];

  for (const accountId of accountIds) {
    if (!accountIndex.has(accountId)) {
      findings.push({
        code: "missing_account",
        severity: "high",
        weight: 50,
        message: `Account ${accountId} is missing from the merge set.`
      });
    }
  }

  const candidateSet = new Set(accountIds);
  const verifiedEvidence = (request.evidence ?? []).filter((item) => item.verified);
  if (verifiedEvidence.length < policy.verifiedEvidenceMinimum) {
    findings.push({
      code: "weak_identity_evidence",
      severity: "medium",
      weight: 20,
      message: "Merge needs at least one verified provider match."
    });
  }

  for (const account of accounts) {
    for (const linkedIdentity of extractLinkedIdentities(account)) {
      const providerKey = providerKeyFor(linkedIdentity);
      const matches = providerIndex.get(providerKey) ?? [];
      const outsideMatches = matches.filter((match) => !candidateSet.has(match.accountId));
      if (linkedIdentity.verified && outsideMatches.length > 0) {
        findings.push({
          code: "provider_claim_conflict",
          severity: "high",
          weight: policy.conflictProviderWeights[linkedIdentity.provider] ?? 25,
          message: `${linkedIdentity.provider} identity is already linked outside the merge set.`,
          provider: linkedIdentity.provider,
          outsideAccountIds: outsideMatches.map((match) => match.accountId)
        });
      }
    }
  }

  const institutions = new Set(accounts.map((account) => account.institution).filter(Boolean));
  if (institutions.size > 1 && request.reason !== "institution_transfer") {
    findings.push({
      code: "institution_mismatch",
      severity: "medium",
      weight: 12,
      message: "Accounts belong to different institutions and need reviewer confirmation."
    });
  }

  for (const project of projects) {
    const duplicateOwner = (request.duplicateAccountIds ?? []).find((id) => project.ownerId === id);
    if (duplicateOwner) {
      actions.push({
        code: "transfer_project_owner",
        projectId: project.id,
        message: `Transfer owner on ${project.id} from ${duplicateOwner} to ${request.primaryAccountId}.`
      });
    }

    const duplicateRoles = Object.entries(project.roles ?? {}).filter(([accountId]) =>
      (request.duplicateAccountIds ?? []).includes(accountId)
    );
    for (const [accountId, role] of duplicateRoles) {
      actions.push({
        code: "merge_project_role",
        projectId: project.id,
        fromAccountId: accountId,
        toAccountId: request.primaryAccountId,
        role,
        message: `Move ${role} role on ${project.id} to ${request.primaryAccountId}.`
      });
    }

    for (const grant of project.objectGrants ?? []) {
      if ((request.duplicateAccountIds ?? []).includes(grant.accountId)) {
        actions.push({
          code: "repoint_object_grant",
          projectId: project.id,
          objectId: grant.objectId,
          fromAccountId: grant.accountId,
          toAccountId: request.primaryAccountId,
          message: `Repoint ${grant.objectId} grant to merged account.`
        });
      }
    }
  }

  const score = findings.reduce((total, finding) => total + finding.weight, 0);
  const status = chooseMergeStatus(findings);

  return {
    requestId: request.id,
    status,
    accountIds,
    requestedBy: request.requestedBy,
    verifiedEvidenceCount: verifiedEvidence.length,
    riskScore: score,
    findings,
    actions,
    decisionDigest: digest({ request, findings, actions, status, score })
  };
}

function evaluateProfileExport({ request, accountIndex, projects, policy }) {
  const account = accountIndex.get(request.accountId);
  if (!account) {
    return {
      requestId: request.id,
      accountId: request.accountId,
      status: "blocked",
      format: request.format ?? "json",
      publicProfile: null,
      privateProfile: null,
      linkedIdentities: [],
      projects: [],
      redactions: ["account_not_found"],
      exportDigest: digest(request)
    };
  }

  const redactions = [];
  const includePrivate = Boolean(request.includePrivate);
  const requesterIsSubject = request.requestedBy === account.id;
  const privateAllowed =
    includePrivate &&
    requesterIsSubject &&
    (!policy.privateExportRequiresMfa || account.mfaEnabled === true);

  let status = "ready";
  if (includePrivate && !privateAllowed) {
    status = "review";
    if (!requesterIsSubject) redactions.push("third_party_private_fields");
    if (account.mfaEnabled !== true) redactions.push("private_fields_require_mfa");
  }
  if (policy.thirdPartyPrivateExportRequiresReview && includePrivate && !requesterIsSubject) {
    status = "review";
  }

  const publicProfile = {
    id: account.id,
    displayName: account.name,
    institution: account.institution,
    field: account.profile?.field,
    bio: account.privacyMode === "private" ? undefined : account.profile?.bio,
    keywords: account.profile?.keywords ?? [],
    reputation: account.reputation ?? {}
  };

  const privateProfile = privateAllowed
    ? {
        email: account.email,
        affiliations: account.profile?.affiliations ?? [],
        grants: account.profile?.grants ?? [],
        publications: account.profile?.publications ?? [],
        activity: account.profile?.activity ?? []
      }
    : null;

  if (!privateAllowed && includePrivate) {
    redactions.push("email", "affiliations", "grants", "publications", "activity");
  }

  const projectMemberships = projects
    .filter((project) => project.ownerId === account.id || project.roles?.[account.id])
    .map((project) => ({
      id: project.id,
      title: project.title,
      visibility: project.visibility,
      role: project.ownerId === account.id ? "owner" : project.roles[account.id],
      objectGrantCount: (project.objectGrants ?? []).filter((grant) => grant.accountId === account.id)
        .length
    }));

  const linkedIdentities = extractLinkedIdentities(account).map((identity) => ({
    provider: identity.provider,
    verified: identity.verified === true,
    subject: identity.verified ? maskSubject(identity.subject) : "unverified"
  }));

  const exportPayload = {
    accountId: account.id,
    publicProfile,
    privateProfile,
    linkedIdentities,
    projects: projectMemberships,
    redactions
  };

  return {
    requestId: request.id,
    accountId: account.id,
    status,
    format: request.format ?? "json",
    publicProfile,
    privateProfile,
    linkedIdentities,
    projects: projectMemberships,
    redactions: Array.from(new Set(redactions)),
    exportDigest: digest(exportPayload)
  };
}

function chooseMergeStatus(findings) {
  if (findings.some((finding) => finding.severity === "high")) return "blocked";
  if (findings.some((finding) => finding.severity === "medium")) return "reviewer_hold";
  return "auto_merge";
}

function buildProviderIndex(accounts) {
  const providerIndex = new Map();
  for (const account of accounts) {
    for (const identity of extractLinkedIdentities(account)) {
      const key = providerKeyFor(identity);
      if (!providerIndex.has(key)) providerIndex.set(key, []);
      providerIndex.get(key).push({
        accountId: account.id,
        provider: identity.provider,
        subject: identity.subject,
        verified: identity.verified === true
      });
    }
  }
  return providerIndex;
}

function extractLinkedIdentities(account) {
  const directIdentities = [
    account.email ? { provider: "email", subject: account.email, verified: true } : null,
    account.orcid ? { provider: "orcid", subject: account.orcid, verified: true } : null,
    account.samlSubject ? { provider: "saml", subject: account.samlSubject, verified: true } : null,
    account.github ? { provider: "github", subject: account.github, verified: true } : null
  ].filter(Boolean);

  return [
    ...directIdentities,
    ...(account.linkedAccounts ?? []).map((identity) => ({
      provider: String(identity.provider ?? "").toLowerCase(),
      subject: String(identity.subject ?? ""),
      verified: identity.verified === true
    }))
  ].filter((identity) => identity.provider && identity.subject);
}

function providerKeyFor(identity) {
  return `${identity.provider}:${String(identity.subject).trim().toLowerCase()}`;
}

function buildDashboard(mergeDecisions, exportPackages, auditEvents) {
  return {
    mergeRequests: mergeDecisions.length,
    autoMerge: mergeDecisions.filter((decision) => decision.status === "auto_merge").length,
    reviewerHold: mergeDecisions.filter((decision) => decision.status === "reviewer_hold").length,
    blocked: mergeDecisions.filter((decision) => decision.status === "blocked").length,
    exportsReady: exportPackages.filter((item) => item.status === "ready").length,
    exportsHeld: exportPackages.filter((item) => item.status !== "ready").length,
    projectRoleTransfers: mergeDecisions.flatMap((decision) =>
      decision.actions.filter((action) => action.code === "merge_project_role")
    ).length,
    auditEvents: auditEvents.length
  };
}

function stripVolatileFields(item) {
  const { decisionDigest, exportDigest, ...rest } = item;
  return rest;
}

function signEvent(payload, at, signingKey) {
  const eventPayload = {
    ...payload,
    at
  };
  const eventId = digest(eventPayload).slice(0, 16);
  const signature = createHmac("sha256", signingKey)
    .update(stableStringify(eventPayload))
    .digest("hex");

  return {
    id: eventId,
    ...eventPayload,
    signature
  };
}

function maskSubject(subject) {
  const value = String(subject);
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}

export function digest(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
