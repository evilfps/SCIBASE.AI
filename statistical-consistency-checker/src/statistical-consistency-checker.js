import crypto from "node:crypto";

const SEVERITY_WEIGHT = {
  high: 18,
  medium: 9,
  low: 4
};

const SEVERITY_RANK = {
  high: 0,
  medium: 1,
  low: 2
};

const DEFAULT_ALPHA = 0.05;
const MIN_TOTAL_SAMPLE_SIZE = 30;
const MIN_GROUP_SAMPLE_SIZE = 10;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeUnit(value) {
  return normalizeText(value).replace(/[._-]+/g, " ");
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

function shortDigest(value, length = 16) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, length);
}

function normalizeSeverity(severity) {
  return severity === "high" || severity === "medium" || severity === "low" ? severity : "low";
}

function availableArtifactIds(artifacts) {
  return new Set(
    asArray(artifacts)
      .filter((artifact) => artifact && artifact.available !== false)
      .map((artifact) => artifact.id)
      .filter(Boolean)
  );
}

function addFinding(findings, analysis, severity, code, message, action, metadata = {}) {
  findings.push({
    analysisId: analysis.id ?? "unlabeled-analysis",
    severity: normalizeSeverity(severity),
    code,
    message,
    action,
    ...metadata
  });
}

function alphaForAnalysis(analysis) {
  const rawAlpha = analysis.alpha;
  if (rawAlpha === undefined || rawAlpha === null || rawAlpha === "") {
    return DEFAULT_ALPHA;
  }

  const alpha = parseNumber(rawAlpha);
  return alpha !== null && alpha > 0 && alpha < 1 ? alpha : DEFAULT_ALPHA;
}

function confidenceInterval(analysis) {
  const values = asArray(analysis.confidenceInterval);
  if (values.length !== 2) {
    return null;
  }

  const lower = parseNumber(values[0]);
  const upper = parseNumber(values[1]);
  if (lower === null || upper === null || lower > upper) {
    return null;
  }

  return { lower, upper };
}

function comparisonCount(analysis) {
  const multipleComparisons = asObject(analysis.multipleComparisons);
  const explicitTests = parseNumber(multipleComparisons.tests ?? analysis.comparisonCount);
  const families = asArray(multipleComparisons.families);

  if (explicitTests !== null && explicitTests > 0) {
    return Math.floor(explicitTests);
  }

  if (families.length > 0) {
    return families.length;
  }

  return 1;
}

function hasCorrection(analysis) {
  const correction = normalizeText(asObject(analysis.multipleComparisons).correction);
  return correction !== "" && correction !== "none" && correction !== "not reported";
}

function checkAlpha(analysis, findings) {
  const rawAlpha = analysis.alpha;
  if (rawAlpha === undefined || rawAlpha === null || rawAlpha === "") {
    return;
  }

  const alpha = parseNumber(rawAlpha);
  if (alpha === null || alpha <= 0 || alpha >= 1) {
    addFinding(
      findings,
      analysis,
      "high",
      "invalid_alpha",
      "The alpha threshold is missing or outside the 0..1 range.",
      "Correct the alpha threshold before interpreting significance."
    );
  }
}

function checkPValueConsistency(analysis, findings) {
  const alpha = alphaForAnalysis(analysis);
  const pValue = parseNumber(analysis.pValue);
  const reportedSignificant = analysis.reportedSignificant;

  if (pValue === null || pValue < 0 || pValue > 1) {
    addFinding(
      findings,
      analysis,
      "high",
      "invalid_p_value",
      "The reported p-value is missing or outside the 0..1 range.",
      "Correct the p-value or mark the analysis as pending."
    );
    return;
  }

  if (typeof reportedSignificant === "boolean") {
    const expectedSignificant = pValue <= alpha;
    if (reportedSignificant !== expectedSignificant) {
      addFinding(
        findings,
        analysis,
        "medium",
        "significance_label_mismatch",
        `The significance label does not match p=${pValue} at alpha=${alpha}.`,
        "Update the significance label or explain the threshold used."
      );
    }
  }
}

function checkConfidenceInterval(analysis, findings) {
  const interval = confidenceInterval(analysis);
  const pValue = parseNumber(analysis.pValue);
  const effectSize = parseNumber(analysis.effectSize);
  const alpha = alphaForAnalysis(analysis);
  const nullValue = parseNumber(analysis.nullValue) ?? 0;

  if (!interval) {
    addFinding(
      findings,
      analysis,
      "medium",
      "confidence_interval_missing",
      "The confidence interval is missing or invalid.",
      "Add a two-sided confidence interval for the reported effect."
    );
    return;
  }

  if (effectSize !== null && (effectSize < interval.lower || effectSize > interval.upper)) {
    addFinding(
      findings,
      analysis,
      "high",
      "effect_outside_ci",
      "The reported effect size is outside its confidence interval.",
      "Recalculate the effect size or the interval before submission."
    );
  }

  if (pValue !== null && pValue >= 0 && pValue <= 1) {
    const crossesNull = interval.lower <= nullValue && interval.upper >= nullValue;
    if (pValue <= alpha && crossesNull) {
      addFinding(
        findings,
        analysis,
        "high",
        "significant_p_value_ci_crosses_null",
        "The p-value is significant but the interval still crosses the null value.",
        "Recheck the model, confidence level, and reported interval."
      );
    }

    if (pValue > alpha && !crossesNull) {
      addFinding(
        findings,
        analysis,
        "medium",
        "nonsignificant_p_value_ci_excludes_null",
        "The p-value is not significant but the interval excludes the null value.",
        "Align the p-value, interval, and hypothesis test."
      );
    }
  }

  const direction = normalizeText(analysis.direction);
  if (direction === "positive" && interval.upper < 0) {
    addFinding(
      findings,
      analysis,
      "medium",
      "direction_interval_mismatch",
      "The direction is labeled positive but the interval is negative.",
      "Fix the direction label or review the sign convention."
    );
  }

  if (direction === "negative" && interval.lower > 0) {
    addFinding(
      findings,
      analysis,
      "medium",
      "direction_interval_mismatch",
      "The direction is labeled negative but the interval is positive.",
      "Fix the direction label or review the sign convention."
    );
  }
}

function checkSamples(analysis, findings) {
  const sampleSize = parseNumber(analysis.sampleSize);
  const groups = asArray(analysis.groups);

  if (sampleSize === null || sampleSize < MIN_TOTAL_SAMPLE_SIZE) {
    addFinding(
      findings,
      analysis,
      "medium",
      "sample_size_needs_review",
      "The analysis has no sample size or a small total sample size.",
      "Add power evidence or mark this as exploratory."
    );
  }

  for (const group of groups) {
    const groupN = parseNumber(group?.n);
    if (groupN !== null && groupN < MIN_GROUP_SAMPLE_SIZE) {
      addFinding(
        findings,
        analysis,
        "low",
        "small_group_size",
        `Group ${group.name ?? "unnamed"} has fewer than ${MIN_GROUP_SAMPLE_SIZE} observations.`,
        "Confirm the group is not over-interpreted."
      );
    }
  }
}

function checkMultipleComparisons(analysis, findings) {
  const tests = comparisonCount(analysis);
  if (tests > 1 && !hasCorrection(analysis)) {
    addFinding(
      findings,
      analysis,
      "medium",
      "multiple_comparisons_uncorrected",
      `${tests} comparisons are reported without a correction method.`,
      "Add a correction method or justify the family-wise testing plan."
    );
  }
}

function checkUnits(analysis, findings) {
  for (const unit of asArray(analysis.units)) {
    const expected = normalizeUnit(unit?.expected);
    const observed = normalizeUnit(unit?.observed);
    if (expected && observed && expected !== observed) {
      addFinding(
        findings,
        analysis,
        "medium",
        "unit_mismatch",
        `${unit.variable ?? "A variable"} is reported as ${unit.observed}, expected ${unit.expected}.`,
        "Fix the unit label or add a conversion note."
      );
    }
  }
}

function checkArtifacts(analysis, artifacts, findings) {
  const ids = availableArtifactIds(artifacts);
  const requiredIds = [
    ["data", analysis.dataArtifactId],
    ["code", analysis.codeArtifactId]
  ];

  for (const [kind, id] of requiredIds) {
    if (!id) {
      addFinding(
        findings,
        analysis,
        "low",
        `${kind}_artifact_not_linked`,
        `The ${kind} artifact is not linked to this analysis.`,
        `Attach the ${kind} artifact before final review.`
      );
      continue;
    }

    if (!ids.has(id)) {
      addFinding(
        findings,
        analysis,
        "high",
        `${kind}_artifact_not_found`,
        `The linked ${kind} artifact ${id} is unavailable.`,
        `Attach ${id} or update the analysis artifact link.`,
        { artifactId: id, artifactKind: kind }
      );
    }
  }
}

function checkPreregistration(analysis, findings) {
  if (analysis.primaryOutcome === true && analysis.preregistered !== true) {
    addFinding(
      findings,
      analysis,
      "medium",
      "primary_outcome_not_preregistered",
      "A primary outcome is not marked as preregistered.",
      "Add registration evidence or mark this as post hoc."
    );
  }
}

function statusFromFindings(score, findings) {
  if (findings.some((finding) => finding.severity === "high")) {
    return "blocked";
  }

  if (score >= 80) {
    return "ready";
  }

  if (score >= 55) {
    return "review";
  }

  return "blocked";
}

function severityCounts(findings) {
  return findings.reduce(
    (counts, finding) => {
      counts[finding.severity] += 1;
      return counts;
    },
    { high: 0, medium: 0, low: 0 }
  );
}

function sortedReviewerActions(findings) {
  return [...findings]
    .filter((finding) => finding.severity !== "low")
    .sort(
      (left, right) =>
        SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] || left.code.localeCompare(right.code)
    )
    .map((finding) => ({
      severity: finding.severity,
      code: finding.code,
      analysisId: finding.analysisId,
      artifactId: finding.artifactId,
      action: finding.action
    }));
}

export function evaluateStatisticalConsistency(input) {
  const packet = asObject(input);
  const manuscript = asObject(packet.manuscript);
  const analyses = asArray(packet.analyses);
  const artifacts = asArray(packet.artifacts);
  const findings = [];

  if (!packet.generatedAt) {
    throw new Error("generatedAt is required");
  }

  if (analyses.length === 0) {
    addFinding(
      findings,
      { id: "packet" },
      "high",
      "analysis_set_empty",
      "No statistical analyses were provided.",
      "Add at least one analysis record before review."
    );
  }

  for (const analysis of analyses.map(asObject)) {
    checkAlpha(analysis, findings);
    checkPValueConsistency(analysis, findings);
    checkConfidenceInterval(analysis, findings);
    checkSamples(analysis, findings);
    checkMultipleComparisons(analysis, findings);
    checkUnits(analysis, findings);
    checkArtifacts(analysis, artifacts, findings);
    checkPreregistration(analysis, findings);
  }

  const penalty = findings.reduce((total, finding) => total + SEVERITY_WEIGHT[finding.severity], 0);
  const score = Math.max(0, 100 - penalty);
  const counts = severityCounts(findings);
  const manifestDigest = shortDigest({
    manuscript,
    analyses,
    artifacts,
    generatedAt: packet.generatedAt
  });
  const findingsDigest = shortDigest(findings);

  return {
    manuscriptId: manuscript.id ?? "unlabeled-manuscript",
    title: manuscript.title ?? "Untitled manuscript",
    status: statusFromFindings(score, findings),
    score,
    counts,
    findings,
    reviewerActions: sortedReviewerActions(findings),
    auditEvents: [
      {
        type: "statistical_consistency_evaluated",
        at: packet.generatedAt,
        analyses: analyses.length,
        findings: findings.length,
        findingsDigest
      }
    ],
    manifestDigest,
    findingsDigest
  };
}

export function renderStatisticalConsistencyReport(result) {
  const lines = [
    "Statistical Consistency Check",
    `${result.title}: ${result.status} (${result.score}/100)`,
    `Findings high/medium/low: ${result.counts.high}/${result.counts.medium}/${result.counts.low}`,
    `Manifest: ${result.manifestDigest}`,
    "",
    "Reviewer actions:"
  ];

  if (result.reviewerActions.length === 0) {
    lines.push("- none");
  } else {
    for (const action of result.reviewerActions) {
      lines.push(`- ${action.severity} ${action.code}: ${action.action}`);
    }
  }

  return lines.join("\n");
}
