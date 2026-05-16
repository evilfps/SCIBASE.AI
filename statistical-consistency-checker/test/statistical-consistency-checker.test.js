import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateStatisticalConsistency,
  renderStatisticalConsistencyReport
} from "../src/statistical-consistency-checker.js";

function basePacket(overrides = {}) {
  return {
    generatedAt: "2026-05-16T16:35:00Z",
    manuscript: {
      id: "ms-001",
      title: "Clean Trial"
    },
    artifacts: [
      { id: "data-1", type: "dataset", available: true },
      { id: "code-1", type: "script", available: true }
    ],
    analyses: [
      {
        id: "primary",
        pValue: 0.2,
        alpha: 0.05,
        reportedSignificant: false,
        effectSize: 0.1,
        confidenceInterval: [-0.2, 0.4],
        direction: "positive",
        sampleSize: 80,
        groups: [
          { name: "a", n: 40 },
          { name: "b", n: 40 }
        ],
        multipleComparisons: {
          tests: 1,
          correction: "not reported"
        },
        units: [{ variable: "score", expected: "points", observed: "points" }],
        primaryOutcome: false,
        preregistered: true,
        dataArtifactId: "data-1",
        codeArtifactId: "code-1"
      }
    ],
    ...overrides
  };
}

test("allows a clean packet", () => {
  const result = evaluateStatisticalConsistency(basePacket());

  assert.equal(result.status, "ready");
  assert.equal(result.score, 100);
  assert.deepEqual(result.counts, { high: 0, medium: 0, low: 0 });
  assert.equal(result.reviewerActions.length, 0);
});

test("blocks an effect size outside the confidence interval", () => {
  const input = basePacket({
    analyses: [
      {
        ...basePacket().analyses[0],
        effectSize: 1.2,
        confidenceInterval: [0.2, 0.8]
      }
    ]
  });

  const result = evaluateStatisticalConsistency(input);

  assert.equal(result.status, "blocked");
  assert(result.findings.some((finding) => finding.code === "effect_outside_ci"));
});

test("flags significant p-values whose interval crosses the null", () => {
  const input = basePacket({
    analyses: [
      {
        ...basePacket().analyses[0],
        pValue: 0.01,
        reportedSignificant: true,
        confidenceInterval: [-0.1, 0.5]
      }
    ]
  });

  const result = evaluateStatisticalConsistency(input);

  assert(result.findings.some((finding) => finding.code === "significant_p_value_ci_crosses_null"));
});

test("flags non-significant p-values whose interval excludes the null", () => {
  const input = basePacket({
    analyses: [
      {
        ...basePacket().analyses[0],
        pValue: 0.18,
        reportedSignificant: false,
        confidenceInterval: [0.1, 0.5]
      }
    ]
  });

  const result = evaluateStatisticalConsistency(input);

  assert(result.findings.some((finding) => finding.code === "nonsignificant_p_value_ci_excludes_null"));
});

test("flags invalid p-values", () => {
  const input = basePacket({
    analyses: [
      {
        ...basePacket().analyses[0],
        pValue: 1.4
      }
    ]
  });

  const result = evaluateStatisticalConsistency(input);

  assert.equal(result.status, "blocked");
  assert(result.findings.some((finding) => finding.code === "invalid_p_value"));
});

test("flags invalid alpha thresholds", () => {
  const input = basePacket({
    analyses: [
      {
        ...basePacket().analyses[0],
        alpha: 1.3
      }
    ]
  });

  const result = evaluateStatisticalConsistency(input);

  assert.equal(result.status, "blocked");
  assert(result.findings.some((finding) => finding.code === "invalid_alpha"));
});

test("flags significance labels that do not match alpha", () => {
  const input = basePacket({
    analyses: [
      {
        ...basePacket().analyses[0],
        pValue: 0.01,
        reportedSignificant: false,
        confidenceInterval: [0.1, 0.5]
      }
    ]
  });

  const result = evaluateStatisticalConsistency(input);

  assert(result.findings.some((finding) => finding.code === "significance_label_mismatch"));
});

test("flags multiple comparisons without correction", () => {
  const input = basePacket({
    analyses: [
      {
        ...basePacket().analyses[0],
        multipleComparisons: { tests: 4, correction: "none" }
      }
    ]
  });

  const result = evaluateStatisticalConsistency(input);

  assert(result.findings.some((finding) => finding.code === "multiple_comparisons_uncorrected"));
});

test("flags unit mismatches and missing artifacts", () => {
  const input = basePacket({
    artifacts: [{ id: "data-1", type: "dataset", available: true }],
    analyses: [
      {
        ...basePacket().analyses[0],
        units: [{ variable: "marker", expected: "ng/mL", observed: "pg/mL" }],
        codeArtifactId: "missing-code"
      }
    ]
  });

  const result = evaluateStatisticalConsistency(input);

  assert(result.findings.some((finding) => finding.code === "unit_mismatch"));
  const artifactFinding = result.findings.find((finding) => finding.code === "code_artifact_not_found");
  assert.equal(artifactFinding.artifactId, "missing-code");
});

test("requires generatedAt", () => {
  assert.throws(() => evaluateStatisticalConsistency({ analyses: [] }), /generatedAt is required/);
});

test("produces deterministic digests", () => {
  const first = evaluateStatisticalConsistency(basePacket());
  const second = evaluateStatisticalConsistency(basePacket());

  assert.equal(first.manifestDigest, second.manifestDigest);
  assert.equal(first.findingsDigest, second.findingsDigest);
});

test("sorts reviewer actions by severity", () => {
  const result = evaluateStatisticalConsistency(
    basePacket({
      analyses: [
        {
          ...basePacket().analyses[0],
          multipleComparisons: { tests: 4, correction: "none" },
          codeArtifactId: "missing-code"
        }
      ]
    })
  );

  assert.equal(result.reviewerActions[0].severity, "high");
  assert.equal(result.reviewerActions[0].code, "code_artifact_not_found");
});

test("renders a reviewer friendly report", () => {
  const result = evaluateStatisticalConsistency(
    basePacket({
      analyses: [
        {
          ...basePacket().analyses[0],
          pValue: "bad",
          confidenceInterval: [0.1, 0.2]
        }
      ]
    })
  );

  const report = renderStatisticalConsistencyReport(result);

  assert.match(report, /Statistical Consistency Check/);
  assert.match(report, /invalid_p_value/);
  assert.match(report, /Manifest:/);
});
