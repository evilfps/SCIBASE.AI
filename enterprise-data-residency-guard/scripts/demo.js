import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateResidency, renderTextReport } from "../src/data-residency-guard.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(moduleDir, "..");
const inputPath = path.join(rootDir, "data", "sample-residency-input.json");
const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));

const report = evaluateResidency(input);
console.log(renderTextReport(report));
