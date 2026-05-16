# Requirement Map

Issue #16 asks for research assistant support around pre-release review, reproducibility checks, and useful reviewer guidance.

This slice covers a focused readiness gate:

- **Auto peer review reports:** emits ethics, consent, data, code, and claim-evidence findings with owner/action fields.
- **Reproducibility checker:** validates data repository, pinned code commit, runtime environment, and reproduction command coverage.
- **Research gap finder support:** prevents opportunity and review packets from using claims without linked data or approval evidence.
- **Reviewer workflow:** creates sorted reviewer actions, a deterministic manifest digest, and signed audit events for follow-up.

Out of scope:

- live model calls
- real participant records
- external repository access
- payment or credential handling
