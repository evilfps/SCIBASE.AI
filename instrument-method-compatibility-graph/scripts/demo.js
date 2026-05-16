import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateInstrumentMethodCompatibility,
  renderInstrumentMethodCompatibilityReport
} from "../src/instrument-method-compatibility-graph.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inputPath = path.join(__dirname, "..", "data", "sample-graph-input.json");
const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));

const result = evaluateInstrumentMethodCompatibility(input);
console.log(renderInstrumentMethodCompatibilityReport(result));
