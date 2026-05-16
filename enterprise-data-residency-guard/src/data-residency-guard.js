import crypto from "node:crypto";

const DECISION_RANK = {
  approved: 0,
  review: 1,
  blocked: 2
};

const CLASSIFICATION_LABELS = {
  "public-metadata": "Public metadata",
  "unpublished-manuscript": "Unpublished manuscript",
  "controlled-human-data": "Controlled human-subject data",
  phi: "Protected health information",
  "grant-report": "Grant and funder report",
  "embargoed-preprint": "Embargoed preprint"
};

function isoDateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function stableDigest(value) {
  return crypto
    .createHash("sha256")
    .update(stableStringify(value))
    .digest("hex");
}

function stableDigestDeep(value) {
  return crypto
    .createHash("sha256")
    .update(stableStringify(value))
    .digest("hex");
}

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

function raiseDecision(current, next) {
  return DECISION_RANK[next] > DECISION_RANK[current] ? next : current;
}

function requireRecord(map, id, type) {
  const record = map.get(id);
  if (!record) {
    throw new Error(`Missing ${type}: ${id}`);
  }
  return record;
}

function evaluateTransfer(record, tenant, destination, generatedAt) {
  const findings = [];
  let decision = "approved";
  const crossBorder = record.sourceRegion !== destination.region;
  const inAllowedRegion = tenant.allowedRegions.includes(destination.region);

  if (!inAllowedRegion) {
    decision = raiseDecision(decision, "review");
    findings.push({
      code: "REGION_OUTSIDE_POLICY",
      severity: "high",
      message: `${destination.region} is outside ${tenant.name} allowed regions`,
      evidence: {
        allowedRegions: tenant.allowedRegions,
        destinationRegion: destination.region
      }
    });
  }

  if (crossBorder && tenant.policy.requiresDpaForCrossBorder && !destination.hasDpa) {
    decision = raiseDecision(decision, "blocked");
    findings.push({
      code: "MISSING_DPA",
      severity: "critical",
      message: "Cross-border transfer lacks a destination DPA",
      evidence: {
        sourceRegion: record.sourceRegion,
        destinationRegion: destination.region,
        destination: destination.name
      }
    });
  }

  if (crossBorder && tenant.policy.requiresSccForNonAdequateRegion && !destination.adequacy) {
    decision = raiseDecision(decision, "blocked");
    findings.push({
      code: "NO_ADEQUACY_OR_SCC",
      severity: "critical",
      message: "Destination has no adequacy decision and no SCC evidence",
      evidence: {
        regimes: tenant.regimes,
        destinationRegion: destination.region
      }
    });
  }

  if (tenant.policy.blockedClassifications.includes(record.classification)) {
    decision = raiseDecision(decision, "blocked");
    findings.push({
      code: "BLOCKED_CLASSIFICATION",
      severity: "critical",
      message: `${CLASSIFICATION_LABELS[record.classification]} cannot leave tenant policy boundary`,
      evidence: {
        classification: record.classification,
        destination: destination.name
      }
    });
  }

  if (record.containsHumanSubjects && !record.deidentified) {
    const severity = record.classification === "phi" ? "critical" : "high";
    decision = raiseDecision(decision, tenant.policy.requiresHumanReviewForSensitiveData ? "review" : decision);
    findings.push({
      code: "HUMAN_SUBJECT_REVIEW",
      severity,
      message: "Human-subject material needs de-identification or reviewer approval",
      evidence: {
        containsHumanSubjects: true,
        deidentified: false
      }
    });
  }

  if (record.embargoUntil && tenant.policy.embargoExportsRequireRelease) {
    const embargoDate = new Date(`${record.embargoUntil}T00:00:00.000Z`);
    const generatedDate = new Date(generatedAt);
    if (embargoDate > generatedDate) {
      decision = raiseDecision(decision, "blocked");
      findings.push({
        code: "ACTIVE_EMBARGO",
        severity: "critical",
        message: `Embargo active until ${record.embargoUntil}`,
        evidence: {
          embargoUntil: record.embargoUntil,
          generatedAt: isoDateOnly(generatedAt)
        }
      });
    }
  }

  if (decision === "approved" && crossBorder) {
    findings.push({
      code: "CROSS_BORDER_APPROVED",
      severity: "info",
      message: "Cross-border transfer has required safeguards",
      evidence: {
        hasDpa: destination.hasDpa,
        adequacy: destination.adequacy
      }
    });
  }

  return {
    id: record.id,
    title: record.title,
    tenantId: tenant.id,
    tenantName: tenant.name,
    regimes: tenant.regimes,
    workflow: record.workflow,
    classification: record.classification,
    sourceRegion: record.sourceRegion,
    destination: {
      id: destination.id,
      name: destination.name,
      type: destination.type,
      region: destination.region
    },
    crossBorder,
    decision,
    findings,
    digest: stableDigestDeep({
      recordId: record.id,
      tenantId: tenant.id,
      destinationId: destination.id,
      decision,
      findings
    })
  };
}

function summarizeDashboard(results) {
  const metrics = {
    total: results.length,
    approved: 0,
    review: 0,
    blocked: 0,
    crossBorder: 0,
    criticalFindings: 0
  };
  const byRegime = {};
  const byDestinationType = {};

  for (const result of results) {
    metrics[result.decision] += 1;
    if (result.crossBorder) {
      metrics.crossBorder += 1;
    }
    metrics.criticalFindings += result.findings.filter((finding) => finding.severity === "critical").length;
    byDestinationType[result.destination.type] = (byDestinationType[result.destination.type] ?? 0) + 1;
    for (const regime of result.regimes) {
      byRegime[regime] = (byRegime[regime] ?? 0) + 1;
    }
  }

  return {
    metrics,
    byRegime,
    byDestinationType,
    queue: results
      .filter((result) => result.decision !== "approved")
      .map((result) => ({
        id: result.id,
        tenantName: result.tenantName,
        decision: result.decision,
        topFinding: result.findings[0]?.code ?? "NONE"
      }))
  };
}

function buildWebhookEvents(results, generatedAt) {
  return results.map((result) => {
    const payload = {
      event: `scibase.residency.${result.decision}`,
      generatedAt,
      recordId: result.id,
      tenantId: result.tenantId,
      destinationId: result.destination.id,
      decision: result.decision,
      digest: result.digest
    };

    return {
      ...payload,
      signature: `sha256=${stableDigest(payload)}`
    };
  });
}

function buildExportManifest(results, generatedAt) {
  return {
    generatedAt,
    packageId: `residency-${stableDigestDeep(results).slice(0, 12)}`,
    entries: results.map((result) => ({
      recordId: result.id,
      workflow: result.workflow,
      destination: result.destination.name,
      residencyRoute: `${result.sourceRegion}->${result.destination.region}`,
      decision: result.decision,
      findingCodes: result.findings.map((finding) => finding.code),
      evidenceDigest: result.digest
    }))
  };
}

export function evaluateResidency(input) {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const tenants = new Map(input.tenants.map((tenant) => [tenant.id, tenant]));
  const destinations = new Map(input.destinations.map((destination) => [destination.id, destination]));

  const results = input.records.map((record) => {
    const tenant = requireRecord(tenants, record.tenantId, "tenant");
    const destination = requireRecord(destinations, record.destinationId, "destination");
    return evaluateTransfer(record, tenant, destination, generatedAt);
  });

  const dashboard = summarizeDashboard(results);
  const webhookEvents = buildWebhookEvents(results, generatedAt);
  const exportManifest = buildExportManifest(results, generatedAt);

  return {
    generatedAt,
    results,
    dashboard,
    webhookEvents,
    exportManifest,
    auditDigest: stableDigestDeep({
      generatedAt,
      results,
      dashboard,
      exportManifest
    })
  };
}

export function renderTextReport(report) {
  const lines = [
    "SCIBASE data residency guard",
    `Generated: ${report.generatedAt}`,
    `Transfers: ${report.dashboard.metrics.total}`,
    `Approved: ${report.dashboard.metrics.approved}`,
    `Review: ${report.dashboard.metrics.review}`,
    `Blocked: ${report.dashboard.metrics.blocked}`,
    `Cross-border: ${report.dashboard.metrics.crossBorder}`,
    `Critical findings: ${report.dashboard.metrics.criticalFindings}`,
    "",
    "Decision queue:"
  ];

  for (const item of report.dashboard.queue) {
    lines.push(`- ${item.id}: ${item.decision} (${item.topFinding})`);
  }

  lines.push("");
  lines.push(`Audit digest: ${report.auditDigest}`);
  return lines.join("\n");
}
