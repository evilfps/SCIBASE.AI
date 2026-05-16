# Enterprise Data Residency Guard

Institutional customers need proof that research artifacts, identities, exports, and webhook deliveries stay inside approved data regions unless a transfer impact review says otherwise. This module turns tenant policy, research records, and destination metadata into deterministic decisions for admins.

## What It Covers

- Region-aware transfer decisions for repository exports, LMS sync, journals, funder portals, and lab notebooks.
- Research data classifications including public metadata, unpublished manuscripts, controlled human-subject data, PHI, grant reports, and embargoed preprints.
- Admin dashboard metrics for approved, review, and blocked transfers.
- Webhook-safe event envelopes with deterministic HMAC signatures.
- Export manifest entries that preserve residency evidence without credentials.

## Run It

```bash
npm run check
npm test
npm run demo
```

## Reviewer Notes

- Synthetic data only. No credentials, protected health data, or real institution records.
- Zero dependencies. The logic uses Node built-ins so reviewers can run it offline.
- The sample shows one blocked PHI transfer, one manual review, and approved in-region exports.

## Files

- `src/data-residency-guard.js` - residency policy evaluator and helpers.
- `data/sample-residency-input.json` - synthetic tenants, destinations, and records.
- `test/data-residency-guard.test.js` - coverage for decisions, dashboard metrics, digest stability, and manifest output.
- `docs/requirement-map.md` - issue #19 acceptance mapping.
- `docs/demo.svg`, `docs/demo.gif`, and `docs/demo.mp4` - short visual proof artifacts for the demo run.
