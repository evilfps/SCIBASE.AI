import { readFile } from "node:fs/promises";
import {
  evaluateEthicsDataAvailability,
  renderEthicsDataAvailabilityReport
} from "../src/ethics-data-availability-checker.js";

const samplePath = new URL("../data/sample-ethics-input.json", import.meta.url);
const input = JSON.parse(await readFile(samplePath, "utf8"));
const result = evaluateEthicsDataAvailability(input);

console.log(renderEthicsDataAvailabilityReport(result));
