import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateInstrumentMethodCompatibility,
  renderInstrumentMethodCompatibilityReport
} from "../src/instrument-method-compatibility-graph.js";

function basePacket(overrides = {}) {
  return {
    generatedAt: "2026-05-16T17:10:00Z",
    project: {
      id: "project-1",
      title: "Clean Graph"
    },
    instruments: [
      {
        id: "inst-a",
        name: "Instrument A",
        modalities: ["imaging"],
        supportedMethodIds: ["method-a"],
        calibrationDate: "2026-05-01T00:00:00Z"
      }
    ],
    methods: [
      {
        id: "method-a",
        name: "Method A",
        status: "active",
        requiredModalities: ["imaging"],
        acceptedOutputs: ["ome-tiff"],
        maxResolutionMicrons: 1,
        maxCalibrationAgeDays: 60
      }
    ],
    datasets: [
      {
        id: "data-a",
        name: "Dataset A",
        modality: "imaging",
        format: "ome-tiff",
        resolutionMicrons: 0.5
      }
    ],
    experiments: [
      {
        id: "exp-a",
        instrumentId: "inst-a",
        methodId: "method-a",
        datasetId: "data-a",
        evidence: [{ id: "ev-a", type: "validation", status: "ready", quality: 0.9 }]
      }
    ],
    ...overrides
  };
}

test("allows a clean compatible graph edge", () => {
  const result = evaluateInstrumentMethodCompatibility(basePacket());

  assert.equal(result.status, "ready");
  assert.equal(result.score, 100);
  assert.equal(result.compatibilityEdges[0].status, "ready");
  assert.equal(result.curatorActions.length, 0);
});

test("requires generatedAt", () => {
  assert.throws(() => evaluateInstrumentMethodCompatibility({}), /generatedAt is required/);
});

test("blocks missing graph nodes", () => {
  const result = evaluateInstrumentMethodCompatibility(
    basePacket({
      experiments: [
        {
          id: "exp-missing",
          instrumentId: "inst-missing",
          methodId: "method-a",
          datasetId: "data-a",
          evidence: []
        }
      ]
    })
  );

  assert.equal(result.status, "blocked");
  assert(result.findings.some((finding) => finding.code === "instrument_node_missing"));
});

test("ignores malformed graph nodes instead of throwing", () => {
  const result = evaluateInstrumentMethodCompatibility(
    basePacket({
      instruments: [null, "bad-node", ...basePacket().instruments]
    })
  );

  assert.equal(result.compatibilityEdges.length, 1);
  assert.equal(result.status, "ready");
});

test("blocks dataset and method modality mismatches", () => {
  const result = evaluateInstrumentMethodCompatibility(
    basePacket({
      datasets: [{ ...basePacket().datasets[0], modality: "single-cell" }]
    })
  );

  assert(result.findings.some((finding) => finding.code === "dataset_method_modality_mismatch"));
  assert(result.findings.some((finding) => finding.code === "instrument_dataset_modality_mismatch"));
});

test("flags missing dataset modality with a readable finding", () => {
  const dataset = { ...basePacket().datasets[0] };
  delete dataset.modality;
  const result = evaluateInstrumentMethodCompatibility(
    basePacket({
      datasets: [dataset]
    })
  );
  const finding = result.findings.find((finding) => finding.code === "dataset_method_modality_mismatch");

  assert(finding);
  assert.match(finding.message, /missing a modality/);
  assert(!finding.message.includes("undefined"));
});

test("flags deprecated methods", () => {
  const result = evaluateInstrumentMethodCompatibility(
    basePacket({
      methods: [{ ...basePacket().methods[0], status: "deprecated" }]
    })
  );

  assert.equal(result.status, "blocked");
  assert(result.findings.some((finding) => finding.code === "method_deprecated"));
});

test("flags instruments that do not list a method", () => {
  const result = evaluateInstrumentMethodCompatibility(
    basePacket({
      instruments: [{ ...basePacket().instruments[0], supportedMethodIds: ["other-method"] }]
    })
  );

  assert(result.findings.some((finding) => finding.code === "instrument_method_not_listed"));
});

test("sets overall status to review for medium findings", () => {
  const result = evaluateInstrumentMethodCompatibility(
    basePacket({
      instruments: [{ ...basePacket().instruments[0], supportedMethodIds: ["other-method"] }]
    })
  );

  assert.equal(result.status, "review");
  assert.equal(result.compatibilityEdges[0].status, "review");
});

test("flags dataset formats that are not accepted by the method", () => {
  const result = evaluateInstrumentMethodCompatibility(
    basePacket({
      datasets: [{ ...basePacket().datasets[0], format: "csv" }]
    })
  );

  assert(result.findings.some((finding) => finding.code === "dataset_format_not_accepted"));
});

test("flags missing dataset formats when the method requires accepted outputs", () => {
  const dataset = { ...basePacket().datasets[0] };
  delete dataset.format;
  const result = evaluateInstrumentMethodCompatibility(
    basePacket({
      datasets: [dataset]
    })
  );

  assert(result.findings.some((finding) => finding.code === "dataset_format_not_accepted"));
  assert.equal(result.compatibilityEdges[0].status, "review");
});

test("flags coarse resolution", () => {
  const result = evaluateInstrumentMethodCompatibility(
    basePacket({
      datasets: [{ ...basePacket().datasets[0], resolutionMicrons: 4 }]
    })
  );

  assert(result.findings.some((finding) => finding.code === "resolution_too_coarse"));
});

test("flags stale or missing calibration", () => {
  const result = evaluateInstrumentMethodCompatibility(
    basePacket({
      instruments: [{ ...basePacket().instruments[0], calibrationDate: "2025-01-01T00:00:00Z" }]
    })
  );

  assert(result.findings.some((finding) => finding.code === "calibration_out_of_window"));
});

test("flags weak compatibility evidence", () => {
  const result = evaluateInstrumentMethodCompatibility(
    basePacket({
      experiments: [
        {
          ...basePacket().experiments[0],
          evidence: [{ id: "ev-draft", type: "notebook", status: "draft", quality: 0.5 }]
        }
      ]
    })
  );

  assert(result.findings.some((finding) => finding.code === "compatibility_evidence_weak"));
});

test("ignores malformed evidence entries instead of throwing", () => {
  const result = evaluateInstrumentMethodCompatibility(
    basePacket({
      experiments: [
        {
          ...basePacket().experiments[0],
          evidence: [null, undefined, "bad-entry", { id: "ev-ready", status: "ready", quality: 0.8 }]
        }
      ]
    })
  );

  assert.equal(result.status, "ready");
  assert.equal(result.compatibilityEdges[0].evidenceQuality, 0.8);
});

test("uses ready evidence over higher-quality draft evidence", () => {
  const result = evaluateInstrumentMethodCompatibility(
    basePacket({
      experiments: [
        {
          ...basePacket().experiments[0],
          evidence: [
            { id: "ev-draft", type: "notebook", status: "draft", quality: 0.98 },
            { id: "ev-ready", type: "validation", status: "ready", quality: 0.82 }
          ]
        }
      ]
    })
  );

  assert.equal(result.compatibilityEdges[0].evidenceQuality, 0.82);
  assert(!result.findings.some((finding) => finding.code === "compatibility_evidence_weak"));
});

test("builds entity pages and recommendations", () => {
  const result = evaluateInstrumentMethodCompatibility(basePacket({ experiments: [] }));

  assert(result.entityPages.some((page) => page.type === "instrument"));
  assert(result.recommendations.some((recommendation) => recommendation.type === "candidate_edge"));
});

test("recommends extra compatible datasets for an existing instrument-method pair", () => {
  const result = evaluateInstrumentMethodCompatibility(
    basePacket({
      datasets: [
        ...basePacket().datasets,
        {
          id: "data-b",
          name: "Dataset B",
          modality: "imaging",
          format: "ome-tiff",
          resolutionMicrons: 0.7
        }
      ]
    })
  );

  assert(
    result.recommendations.some(
      (recommendation) => recommendation.instrumentId === "inst-a" && recommendation.datasetIds.includes("data-b")
    )
  );
  assert(
    !result.recommendations.some(
      (recommendation) => recommendation.instrumentId === "inst-a" && recommendation.datasetIds.includes("data-a")
    )
  );
});

test("does not recommend unsupported dataset modalities", () => {
  const result = evaluateInstrumentMethodCompatibility(
    basePacket({
      instruments: [{ ...basePacket().instruments[0], supportedMethodIds: ["method-a", "method-b"] }],
      methods: [
        ...basePacket().methods,
        {
          id: "method-b",
          name: "Method B",
          status: "active",
          requiredModalities: ["single-cell"],
          acceptedOutputs: ["fcs"]
        }
      ],
      datasets: [
        ...basePacket().datasets,
        {
          id: "data-flow",
          name: "Flow Dataset",
          modality: "single-cell",
          format: "fcs"
        }
      ],
      experiments: []
    })
  );

  assert(
    !result.recommendations.some(
      (recommendation) => recommendation.methodId === "method-b" && recommendation.datasetIds.includes("data-flow")
    )
  );
});

test("does not recommend datasets with missing required modality or format", () => {
  const result = evaluateInstrumentMethodCompatibility(
    basePacket({
      experiments: [],
      datasets: [
        {
          id: "data-no-modality",
          name: "No Modality",
          format: "ome-tiff"
        },
        {
          id: "data-no-format",
          name: "No Format",
          modality: "imaging"
        }
      ]
    })
  );

  assert.equal(result.recommendations.length, 0);
});

test("does not recommend deprecated methods", () => {
  const result = evaluateInstrumentMethodCompatibility(
    basePacket({
      experiments: [],
      methods: [{ ...basePacket().methods[0], status: "deprecated" }]
    })
  );

  assert.equal(result.recommendations.length, 0);
});

test("produces deterministic digests", () => {
  const first = evaluateInstrumentMethodCompatibility(basePacket());
  const second = evaluateInstrumentMethodCompatibility(basePacket());

  assert.equal(first.manifestDigest, second.manifestDigest);
  assert.equal(first.auditEvents[0].findingsDigest, second.auditEvents[0].findingsDigest);
});

test("renders a curator-friendly report", () => {
  const result = evaluateInstrumentMethodCompatibility(
    basePacket({
      methods: [{ ...basePacket().methods[0], status: "deprecated" }]
    })
  );
  const report = renderInstrumentMethodCompatibilityReport(result);

  assert.match(report, /Instrument Method Compatibility/);
  assert.match(report, /method_deprecated/);
  assert.match(report, /Manifest:/);
});
