# Statistical Consistency Checker

This module adds a focused research review slice for statistical method consistency.

It covers:

- p-value, alpha, and reported-significance alignment
- effect size and confidence interval consistency
- null-value checks for significant and non-significant findings
- multiple-comparison correction review
- sample-size and small-group warnings
- unit mismatches and linked data/code artifact availability
- reviewer actions, audit events, and deterministic digests

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
  evaluateStatisticalConsistency,
  renderStatisticalConsistencyReport
} from "./src/statistical-consistency-checker.js";

const result = evaluateStatisticalConsistency(input);
console.log(renderStatisticalConsistencyReport(result));
```
