# Revenue Renewal True-Up

This module adds a self-contained revenue operations slice for issue #20. It focuses on renewals and seat true-ups after an institution is already using SCIBASE.

It does not handle live payments or account credentials. All data is synthetic.

## What It Covers

- renewal dates, notice windows, and late renewal risk
- contracted seats vs active seats with annual true-up estimates
- compute credit overage estimates
- payment, purchase order, security review, and DPA blockers
- churn and expansion signals for customer success teams
- signed webhook events and audit digest evidence
- admin dashboard metrics and a renewal packet report

## Run Locally

```bash
npm run check
npm test
npm run demo
```

## Files

- `src/revenue-renewal-true-up.js` contains the evaluator.
- `data/sample-renewal-input.json` contains synthetic accounts and plans.
- `test/revenue-renewal-true-up.test.js` covers decisions, metrics, events, and digest stability.
- `scripts/demo.js` prints a reviewer-friendly renewal report.
- `docs/requirement-map.md` maps the slice to issue #20.
- `docs/demo.svg`, `docs/demo.gif`, and `docs/demo.mp4` show the dashboard flow.
