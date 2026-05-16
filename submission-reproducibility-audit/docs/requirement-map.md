# Requirement Map

Maps this slice to issue #18, Scientific Bounty System.

## Challenge Posting Portal

- Uses `challenge.requiredDeliverables` and `challenge.acceptance.maxMetricDriftPercent` as the posted rubric contract.
- Rejects incomplete submission packages before sponsor review.

## Submission Engine

- Validates deliverable packages with artifact hashes.
- Checks execution environment evidence: container digest, lockfile, and pinned dependencies.
- Evaluates clean notebook reruns, rerun checks, deterministic seeds, and metric drift.
- Produces an audit manifest digest for reproducibility evidence.

## Arbitration And Reward Distribution

- Emits reviewer queue decisions: `reproducible`, `review`, or `blocked`.
- Converts decisions into payout gates: `release`, `hold_for_reviewer`, or `block_until_fixed`.
- Signs audit events so payout and review systems can verify the evidence record.

## IP Management

- Keeps payout and IP release blocked when restricted data, missing deliverables, or failed reruns make the submission unsafe to accept.

## Local Verification

```sh
npm run check
npm test
npm run demo
```
