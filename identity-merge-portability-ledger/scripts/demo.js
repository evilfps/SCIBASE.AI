import { readFile } from "node:fs/promises";
import {
  evaluateIdentityPortability,
  renderIdentityPortabilityReport
} from "../src/identity-merge-portability-ledger.js";

const samplePath = new URL("../data/sample-identity-input.json", import.meta.url);
const input = JSON.parse(await readFile(samplePath, "utf8"));
const result = evaluateIdentityPortability(input);

console.log(renderIdentityPortabilityReport(result));
