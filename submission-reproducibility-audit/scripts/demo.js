import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  evaluateReproducibilityAudit,
  readAuditInput,
  renderAuditReport
} from "../src/submission-reproducibility-audit.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const inputPath = path.join(directory, "..", "data", "sample-repro-input.json");
const input = readAuditInput(inputPath);
const result = evaluateReproducibilityAudit(input);

console.log(renderAuditReport(result));
