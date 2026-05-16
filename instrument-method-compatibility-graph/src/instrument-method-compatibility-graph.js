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

const DAY_MS = 24 * 60 * 60 * 1000;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
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

function parseDate(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
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

function digest(value, length = 16) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, length);
}

function indexById(items) {
  return new Map(
    asArray(items)
      .map(asObject)
      .map((item) => [item.id, item])
      .filter(([id]) => Boolean(id))
  );
}

function normalizedSet(values) {
  return new Set(asArray(values).map(normalize).filter(Boolean));
}

function intersects(left, right) {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }
  return false;
}

function addFinding(findings, experiment, severity, code, message, action, metadata = {}) {
  findings.push({
    experimentId: experiment.id ?? "unlabeled-experiment",
    severity,
    code,
    message,
    action,
    ...metadata
  });
}

function addNodeMissing(findings, experiment, type, id) {
  addFinding(
    findings,
    experiment,
    "high",
    `${type}_node_missing`,
    `The ${type} node ${id ?? "unknown"} is not present in the graph.`,
    `Add the ${type} node or remove the stale experiment edge.`,
    { nodeType: type, nodeId: id }
  );
}

function calibrationAgeDays(instrument, generatedAt) {
  const generatedDate = parseDate(generatedAt);
  const calibrationDate = parseDate(instrument.calibrationDate);
  if (!generatedDate || !calibrationDate) {
    return null;
  }

  return Math.floor((generatedDate.getTime() - calibrationDate.getTime()) / DAY_MS);
}

function bestEvidence(evidenceItems) {
  const evidence = asArray(evidenceItems)
    .map(asObject)
    .map((evidence) => ({
      id: evidence.id,
      status: normalize(evidence.status),
      quality: parseNumber(evidence.quality) ?? 0,
      type: normalize(evidence.type)
    }));
  const ready = evidence.filter((item) => item.status === "ready");
  const ranked = (ready.length > 0 ? ready : evidence).sort((left, right) => right.quality - left.quality);

  return ranked[0] ?? null;
}

function checkCompatibility(experiment, context, findings) {
  const { instruments, methods, datasets, generatedAt } = context;
  const instrument = instruments.get(experiment.instrumentId);
  const method = methods.get(experiment.methodId);
  const dataset = datasets.get(experiment.datasetId);
  const startCount = findings.length;

  if (!instrument) {
    addNodeMissing(findings, experiment, "instrument", experiment.instrumentId);
  }

  if (!method) {
    addNodeMissing(findings, experiment, "method", experiment.methodId);
  }

  if (!dataset) {
    addNodeMissing(findings, experiment, "dataset", experiment.datasetId);
  }

  if (!instrument || !method || !dataset) {
    return null;
  }

  if (normalize(method.status) === "deprecated") {
    addFinding(
      findings,
      experiment,
      "high",
      "method_deprecated",
      `${method.name ?? method.id} is deprecated for new graph recommendations.`,
      "Pick a supported method or add curator approval for legacy use.",
      { methodId: method.id }
    );
  }

  const supportedMethods = normalizedSet(instrument.supportedMethodIds);
  if (supportedMethods.size > 0 && !supportedMethods.has(normalize(method.id))) {
    addFinding(
      findings,
      experiment,
      "medium",
      "instrument_method_not_listed",
      `${instrument.name ?? instrument.id} does not list ${method.name ?? method.id} as a supported method.`,
      "Confirm the instrument-method edge or choose a supported instrument.",
      { instrumentId: instrument.id, methodId: method.id }
    );
  }

  const instrumentModalities = normalizedSet(instrument.modalities);
  const methodModalities = normalizedSet(method.requiredModalities);
  const datasetModality = normalize(dataset.modality);
  if (methodModalities.size > 0 && (!datasetModality || !methodModalities.has(datasetModality))) {
    addFinding(
      findings,
      experiment,
      "high",
      "dataset_method_modality_mismatch",
      datasetModality
        ? `${dataset.name ?? dataset.id} uses ${dataset.modality}, which does not match the method requirements.`
        : `${dataset.name ?? dataset.id} is missing a modality required by ${method.name ?? method.id}.`,
      "Use a compatible dataset or change the method assignment.",
      { datasetId: dataset.id, methodId: method.id, datasetModality: datasetModality || null }
    );
  }

  if (instrumentModalities.size > 0 && datasetModality && !instrumentModalities.has(datasetModality)) {
    addFinding(
      findings,
      experiment,
      "high",
      "instrument_dataset_modality_mismatch",
      `${instrument.name ?? instrument.id} does not support ${dataset.modality} data.`,
      "Route the dataset to an instrument that supports this modality.",
      { instrumentId: instrument.id, datasetId: dataset.id }
    );
  }

  const acceptedOutputs = normalizedSet(method.acceptedOutputs);
  const datasetFormat = normalize(dataset.format);
  if (acceptedOutputs.size > 0 && (!datasetFormat || !acceptedOutputs.has(datasetFormat))) {
    addFinding(
      findings,
      experiment,
      "medium",
      "dataset_format_not_accepted",
      datasetFormat
        ? `${dataset.format} is not listed as an accepted output for ${method.name ?? method.id}.`
        : `${dataset.name ?? dataset.id} is missing an output format required by ${method.name ?? method.id}.`,
      "Add a conversion step or pick a method that accepts the dataset format.",
      { datasetId: dataset.id, methodId: method.id, datasetFormat: datasetFormat || null }
    );
  }

  const resolution = parseNumber(dataset.resolutionMicrons);
  const minResolution = parseNumber(method.maxResolutionMicrons);
  if (resolution !== null && minResolution !== null && resolution > minResolution) {
    addFinding(
      findings,
      experiment,
      "medium",
      "resolution_too_coarse",
      `Dataset resolution ${resolution}um is coarser than the method limit ${minResolution}um.`,
      "Attach a higher-resolution dataset or document the method exception.",
      { datasetId: dataset.id, methodId: method.id }
    );
  }

  const maxCalibrationAgeDays = parseNumber(method.maxCalibrationAgeDays);
  const ageDays = calibrationAgeDays(instrument, generatedAt);
  if (maxCalibrationAgeDays !== null && (ageDays === null || ageDays > maxCalibrationAgeDays)) {
    addFinding(
      findings,
      experiment,
      "medium",
      "calibration_out_of_window",
      `${instrument.name ?? instrument.id} calibration is missing or older than ${maxCalibrationAgeDays} days.`,
      "Attach fresh calibration evidence before using this edge in recommendations.",
      { instrumentId: instrument.id, ageDays }
    );
  }

  const evidence = bestEvidence(experiment.evidence);
  if (!evidence || evidence.status !== "ready" || evidence.quality < 0.7) {
    addFinding(
      findings,
      experiment,
      "medium",
      "compatibility_evidence_weak",
      "The compatibility edge has weak or non-ready evidence.",
      "Add validation evidence before surfacing the relationship to researchers.",
      { evidenceId: evidence?.id }
    );
  }

  const added = findings.slice(startCount);
  const status = added.some((finding) => finding.severity === "high")
    ? "blocked"
    : added.some((finding) => finding.severity === "medium")
      ? "review"
      : "ready";

  return {
    id: `${instrument.id}:${method.id}:${dataset.id}`,
    type: "instrument_method_dataset",
    status,
    from: instrument.id,
    through: method.id,
    to: dataset.id,
    evidenceQuality: evidence?.quality ?? 0,
    findingCodes: added.map((finding) => finding.code)
  };
}

function buildEntityPages(instruments, methods, datasets, edges) {
  const pages = [];

  for (const instrument of instruments.values()) {
    const instrumentEdges = edges.filter((edge) => edge.from === instrument.id);
    pages.push({
      id: instrument.id,
      type: "instrument",
      title: instrument.name ?? instrument.id,
      methods: [...new Set(instrumentEdges.map((edge) => edge.through))],
      datasets: [...new Set(instrumentEdges.map((edge) => edge.to))],
      readyEdges: instrumentEdges.filter((edge) => edge.status === "ready").length,
      reviewEdges: instrumentEdges.filter((edge) => edge.status !== "ready").length
    });
  }

  for (const method of methods.values()) {
    const methodEdges = edges.filter((edge) => edge.through === method.id);
    pages.push({
      id: method.id,
      type: "method",
      title: method.name ?? method.id,
      instruments: [...new Set(methodEdges.map((edge) => edge.from))],
      datasets: [...new Set(methodEdges.map((edge) => edge.to))]
    });
  }

  for (const dataset of datasets.values()) {
    const datasetEdges = edges.filter((edge) => edge.to === dataset.id);
    pages.push({
      id: dataset.id,
      type: "dataset",
      title: dataset.name ?? dataset.id,
      modality: dataset.modality,
      linkedMethods: [...new Set(datasetEdges.map((edge) => edge.through))]
    });
  }

  return pages;
}

function buildRecommendations(instruments, methods, datasets, edges) {
  const recommendations = [];
  const readyTriples = new Set(edges.filter((edge) => edge.status === "ready").map((edge) => edge.id));

  for (const instrument of instruments.values()) {
    const supportedMethods = normalizedSet(instrument.supportedMethodIds);
    const instrumentModalities = normalizedSet(instrument.modalities);

    for (const method of methods.values()) {
      if (normalize(method.status) === "deprecated") {
        continue;
      }

      if (supportedMethods.size > 0 && !supportedMethods.has(normalize(method.id))) {
        continue;
      }

      const methodModalities = normalizedSet(method.requiredModalities);
      if (methodModalities.size > 0 && instrumentModalities.size > 0 && !intersects(methodModalities, instrumentModalities)) {
        continue;
      }

      const candidateDatasets = [...datasets.values()].filter((dataset) => {
        const modality = normalize(dataset.modality);
        const format = normalize(dataset.format);
        const acceptedOutputs = normalizedSet(method.acceptedOutputs);
        const edgeId = `${instrument.id}:${method.id}:${dataset.id}`;
        const matchesInstrumentModality =
          instrumentModalities.size === 0 || Boolean(modality && instrumentModalities.has(modality));
        const matchesMethodModality =
          methodModalities.size === 0 || Boolean(modality && methodModalities.has(modality));
        const matchesFormat = acceptedOutputs.size === 0 || Boolean(format && acceptedOutputs.has(format));
        return !readyTriples.has(edgeId) && matchesInstrumentModality && matchesMethodModality && matchesFormat;
      });

      if (candidateDatasets.length > 0) {
        recommendations.push({
          type: "candidate_edge",
          instrumentId: instrument.id,
          methodId: method.id,
          datasetIds: candidateDatasets.map((dataset) => dataset.id),
          reason: "Instrument, method, and dataset metadata share compatible modality/output requirements."
        });
      }
    }
  }

  return recommendations.slice(0, 8);
}

function statusFromFindings(score, findings) {
  if (findings.some((finding) => finding.severity === "high")) {
    return "blocked";
  }

  if (findings.some((finding) => finding.severity === "medium")) {
    return "review";
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

function curatorActions(findings) {
  return [...findings]
    .sort(
      (left, right) =>
        SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] || left.code.localeCompare(right.code)
    )
    .filter((finding) => finding.severity !== "low")
    .map((finding) => ({
      severity: finding.severity,
      code: finding.code,
      experimentId: finding.experimentId,
      nodeId: finding.nodeId,
      action: finding.action
    }));
}

export function evaluateInstrumentMethodCompatibility(input) {
  const packet = asObject(input);
  const project = asObject(packet.project);
  const instruments = indexById(packet.instruments);
  const methods = indexById(packet.methods);
  const datasets = indexById(packet.datasets);
  const experiments = asArray(packet.experiments).map(asObject);
  const findings = [];

  if (!packet.generatedAt) {
    throw new Error("generatedAt is required");
  }

  if (experiments.length === 0) {
    addFinding(
      findings,
      { id: "packet" },
      "high",
      "experiment_set_empty",
      "No experiment edges were supplied for graph compatibility review.",
      "Add experiment edges that connect instruments, methods, and datasets."
    );
  }

  const context = { instruments, methods, datasets, generatedAt: packet.generatedAt };
  const compatibilityEdges = experiments
    .map((experiment) => checkCompatibility(experiment, context, findings))
    .filter(Boolean);
  const entityPages = buildEntityPages(instruments, methods, datasets, compatibilityEdges);
  const recommendations = buildRecommendations(instruments, methods, datasets, compatibilityEdges);
  const penalty = findings.reduce((total, finding) => total + SEVERITY_WEIGHT[finding.severity], 0);
  const score = Math.max(0, 100 - penalty);
  const counts = severityCounts(findings);
  const manifestDigest = digest({
    project,
    instruments: [...instruments.values()],
    methods: [...methods.values()],
    datasets: [...datasets.values()],
    experiments,
    generatedAt: packet.generatedAt
  });

  return {
    projectId: project.id ?? "unlabeled-project",
    title: project.title ?? "Untitled project",
    status: statusFromFindings(score, findings),
    score,
    counts,
    findings,
    compatibilityEdges,
    entityPages,
    recommendations,
    graphQueries: [
      "instrument -> compatible methods -> datasets",
      "dataset -> candidate instruments",
      "method -> blocked experiments"
    ],
    curatorActions: curatorActions(findings),
    auditEvents: [
      {
        type: "instrument_method_compatibility_evaluated",
        at: packet.generatedAt,
        edges: compatibilityEdges.length,
        findings: findings.length,
        findingsDigest: digest(findings)
      }
    ],
    manifestDigest
  };
}

export function renderInstrumentMethodCompatibilityReport(result) {
  const readyEdges = result.compatibilityEdges.filter((edge) => edge.status === "ready").length;
  const reviewEdges = result.compatibilityEdges.length - readyEdges;
  const lines = [
    "Instrument Method Compatibility",
    `${result.title}: ${result.status} (${result.score}/100)`,
    `Edges ready/review: ${readyEdges}/${reviewEdges}`,
    `Findings high/medium/low: ${result.counts.high}/${result.counts.medium}/${result.counts.low}`,
    `Manifest: ${result.manifestDigest}`,
    "",
    "Curator actions:"
  ];

  if (result.curatorActions.length === 0) {
    lines.push("- none");
  } else {
    for (const action of result.curatorActions) {
      lines.push(`- ${action.severity} ${action.code}: ${action.action}`);
    }
  }

  return lines.join("\n");
}
