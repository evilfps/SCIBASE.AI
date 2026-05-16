import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { evaluateRenewalPortfolio, renderRenewalReport } from "../src/revenue-renewal-true-up.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const dataPath = join(currentDir, "../data/sample-renewal-input.json");
const input = JSON.parse(await readFile(dataPath, "utf8"));
const result = evaluateRenewalPortfolio(input, {
  signingKey: "local-renewal-demo-key"
});

console.log(renderRenewalReport(result));
