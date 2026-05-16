# Instrument Method Compatibility Graph

This module adds a focused knowledge graph slice for instrument, method, and dataset compatibility.

It covers:

- typed instrument, method, dataset, and experiment nodes
- compatibility edges across instruments, methods, and datasets
- modality, file format, resolution, calibration, and evidence checks
- entity pages for instrument, method, and dataset navigation
- candidate edge recommendations for graph discovery
- curator actions, audit events, and deterministic digests

The implementation is dependency-free and uses synthetic sample data only.

## Run

```bash
npm run check
npm test
npm run demo
```

## Demo Assets

- short demo video: `docs/demo.webm`
- `docs/demo.svg`

## API

```js
import {
  evaluateInstrumentMethodCompatibility,
  renderInstrumentMethodCompatibilityReport
} from "./src/instrument-method-compatibility-graph.js";

const result = evaluateInstrumentMethodCompatibility(input);
console.log(renderInstrumentMethodCompatibilityReport(result));
```
