import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateStatisticalConsistency,
  renderStatisticalConsistencyReport
} from "../src/statistical-consistency-checker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inputPath = path.join(__dirname, "..", "data", "sample-statistics-input.json");
const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));

const result = evaluateStatisticalConsistency(input);
console.log(renderStatisticalConsistencyReport(result));
