# Requirement Map

Maps this slice to issue #15, Community & User Reputation System.

## Contributor Credits

- Validates timestamped contribution records.
- Supports CRediT-style roles such as software, validation, data curation, and writing.
- Requires evidence records before visible profile credit is released.
- Produces contributor profile summaries with role counts and reputation deltas.

## Peer Validation

- Scores attestations from project leads, reviewers, collaborators, and self claims.
- Routes weak attestations to review instead of awarding automatic reputation.
- Detects conflicted attestations that need an independent reviewer.

## Reputation Scoring

- Releases reputation only for verified credit.
- Holds weak, duplicate, or unsupported claims for moderation.
- Blocks reputation changes while a dispute is active.

## Community Timeline And Moderation

- Detects duplicate credit claims for the same contributor, artifact, project, and role.
- Produces a moderation queue for unresolved disputes and review-needed credits.
- Signs ledger events for audit trails.

## Local Verification

```sh
npm run check
npm test
npm run demo
```
