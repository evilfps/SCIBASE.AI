# Credit Attestation Ledger

This module adds a contributor-credit gate for the community and reputation layer. It validates CRediT-style contribution records, attached evidence, independent attestations, duplicate claims, and active disputes before profile credit or reputation points are released.

It is self-contained and uses only Node built-ins.

## What It Covers

- CRediT role validation for contribution records
- Evidence checks for commits, uploads, reviews, and artifacts
- Attestation strength from project leads, reviewers, collaborators, and self claims
- Duplicate credit claim detection
- Open dispute routing for moderation
- Conflict checks for attestors
- Profile summaries and reputation deltas
- Signed ledger events and deterministic manifest digests

## Run

```sh
npm run check
npm test
npm run demo
```

The demo reads `data/sample-credit-input.json` and prints the credit queue.

## Demo Artifact

- `docs/demo.svg`
- `docs/demo.gif`
- `docs/demo.webm`

## Main API

```js
import {
  evaluateCreditLedger,
  renderCreditReport
} from "./src/credit-attestation-ledger.js";
```

`evaluateCreditLedger(input)` returns dashboard metrics, ordered credit records, contributor profile summaries, signed events, and a manifest digest.
