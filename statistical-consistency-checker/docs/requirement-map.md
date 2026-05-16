# Requirement Map

This slice targets the peer-review diagnostics part of issue #13.

| Requirement | Coverage |
| --- | --- |
| Statistical error detection | Checks p-values, confidence intervals, effect sizes, significance labels, and null-value consistency. |
| Compliance-style review packet | Emits reviewer actions, audit events, deterministic manifest digests, and finding digests. |
| Citation/review workflow fit | Links each finding to an analysis and includes artifact ids where artifact checks apply. |
| Batch-ready local workflow | `npm run demo` evaluates a synthetic review packet with no external services. |
| Tests | `npm test` covers clean packets, invalid p-values, interval mismatches, unit mismatches, artifact gaps, and deterministic output. |
