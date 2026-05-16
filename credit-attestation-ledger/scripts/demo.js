import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  evaluateCreditLedger,
  readCreditInput,
  renderCreditReport
} from "../src/credit-attestation-ledger.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const inputPath = path.join(directory, "..", "data", "sample-credit-input.json");
const result = evaluateCreditLedger(readCreditInput(inputPath));

console.log(renderCreditReport(result));
