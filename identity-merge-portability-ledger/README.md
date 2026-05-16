# Identity Merge Portability Ledger

This module adds a focused user and project management slice for account merge and profile export workflows.

It covers:

- linked account conflict checks across ORCID, SAML, GitHub, Google, and email identities
- merge decisions for duplicate researcher accounts
- project owner, role, and object grant transfer actions after a merge
- profile export packages with public/private profile handling
- privacy redactions for risky third-party private exports
- signed audit events and deterministic manifest digests

The implementation is dependency-free and uses synthetic sample data only.

## Run

```bash
npm run check
npm test
npm run demo
```

## Demo Assets

- `docs/demo.svg`
- `docs/demo.gif`
- `docs/demo.webm`

## API

```js
import {
  evaluateIdentityPortability,
  renderIdentityPortabilityReport
} from "./src/identity-merge-portability-ledger.js";

const result = evaluateIdentityPortability(input);
console.log(renderIdentityPortabilityReport(result));
```
