# Requirement Map

This slice targets issue #17's graph navigation and recommendation requirements.

| Requirement | Coverage |
| --- | --- |
| Entity extraction / linked data | Models typed instrument, method, dataset, and experiment nodes with stable ids. |
| Knowledge navigation | Builds entity pages and graph query labels for instrument-to-method-to-dataset traversal. |
| Relationship quality | Scores compatibility edges and flags modality, format, resolution, calibration, evidence, and deprecated-method issues. |
| Recommendations | Emits candidate graph edges when instrument, method, and dataset metadata are compatible. |
| Tests | `npm test` covers ready edges, missing nodes, mismatch blockers, stale calibration, weak evidence, recommendations, digests, and reports. |
