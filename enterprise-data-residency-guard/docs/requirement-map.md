# Requirement Map

Issue: SCIBASE-AI/SCIBASE.AI#19 Enterprise Tooling

| Requirement area | Evidence in this module |
| --- | --- |
| Admin dashboard controls | `dashboard.metrics`, destination breakdowns, and `dashboard.queue` in `src/data-residency-guard.js`. |
| Compliance tracking | GDPR, HorizonEU, HIPAA, NIH, UK-GDPR, and UKRI regimes in sample tenant policy. |
| API and webhooks | `webhookEvents` emits signed `scibase.residency.*` envelopes with deterministic digests. |
| Export pipelines | `exportManifest` records residency routes, decision states, finding codes, and evidence digests. |
| Institutional repository and LMS integrations | Synthetic routes include Zenodo, PubMed Central, Canvas LMS, DSpace, and a journal portal. |
| Custom tags or flags for internal initiatives | Classification and workflow metadata produce decision queues for restricted, embargoed, and public records. |
| Reviewer proof | `npm run check`, `npm test`, `npm run demo`, `docs/demo.svg`, and `docs/demo.gif`. |

## Distinct Slice

Existing #19 attempts focus on dashboards, export packaging, compliance packets, webhooks, identity drift, and retention holds. This module focuses on data residency and transfer impact decisions before exports or webhooks leave an institutional boundary.
