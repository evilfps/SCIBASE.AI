# Ethics Data Availability Checker

This module adds a focused research assistant review slice for ethics and data availability readiness.

It covers:

- human-subjects approval, consent scope, vulnerable group, and cross-border data checks
- data availability statements, repository access, embargo, license, and controlled-access handling
- code availability, pinned commit, environment, and reproduction command checks
- claim-to-artifact coverage for manuscript claims that need data or approval evidence
- reviewer actions, release readiness status, signed audit events, and deterministic digests

The implementation is dependency-free and uses synthetic sample data only.

## Run

```bash
npm run check
npm test
npm run demo
```

## Demo Assets

- `docs/demo.svg`
- short demo video: `docs/demo.webm`
- `docs/demo.gif`

## API

```js
import {
  evaluateEthicsDataAvailability,
  renderEthicsDataAvailabilityReport
} from "./src/ethics-data-availability-checker.js";

const result = evaluateEthicsDataAvailability(input);
console.log(renderEthicsDataAvailabilityReport(result));
```
