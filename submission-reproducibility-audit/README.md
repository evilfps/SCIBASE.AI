# Submission Reproducibility Audit

This module adds a reproducibility gate for scientific bounty submissions. It checks submitted artifacts, runtime evidence, rerun results, metric drift, and restricted-data handling before reward review, payout release, or IP handoff.

It is self-contained and uses only Node built-ins.

## What It Covers

- Required deliverable checks for code, data, reports, and models
- Artifact SHA-256 manifest validation
- Container digest, lockfile, and exact dependency pin checks
- Rerun status and metric drift checks
- Restricted data and NDA coverage checks
- Reviewer queue decisions: `reproducible`, `review`, or `blocked`
- Payout gates: release, hold for reviewer, or block until fixed
- Deterministic manifest digests and signed audit events

## Run

```sh
npm run check
npm test
npm run demo
```

The demo reads `data/sample-repro-input.json` and prints a reviewer queue report.

## Demo Artifact

- `docs/demo.svg`
- `docs/demo.gif`
- `docs/demo.webm`

## Main API

```js
import {
  evaluateReproducibilityAudit,
  renderAuditReport
} from "./src/submission-reproducibility-audit.js";
```

`evaluateReproducibilityAudit(input)` returns:

- challenge metadata
- dashboard metrics
- ordered submission audits
- deterministic manifest digest
- signed audit events

`renderAuditReport(result)` turns the audit result into a compact reviewer report.
