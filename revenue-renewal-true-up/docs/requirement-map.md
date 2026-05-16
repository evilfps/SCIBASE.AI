# Requirement Map

This slice maps to issue #20, Revenue Infrastructure.

| Issue area | Module coverage |
| --- | --- |
| Tiered subscription billing | Evaluates plan, seat price, annual discount, volume threshold, renewal date, and contracted seats. |
| Institutional licenses | Models institutional and consortium renewal packets with purchase order and DPA checks. |
| Volume discounts and auto-scaling | Computes active seat true-ups against contracted seats and volume discount rules. |
| Institutional invoicing | Flags past due and open invoice exposure before renewal booking. |
| AI compute billing | Adds included compute credit limits and renewal-period overage estimates. |
| Admin dashboard | Produces blocked, review, expansion, true-up, churn exposure, and forecast metrics. |
| Webhooks and integrations | Emits deterministic signed renewal events for downstream CRM and billing systems. |
| Auditability | Builds account digests and a manifest digest for reviewer evidence. |

## Distinct Scope

Existing submissions cover billing ledgers, metering, entitlements, procurement, licensing gates, revenue recognition, tax controls, and compute margin. This module focuses on renewal execution after usage has already happened: who is due, what needs a true-up, which renewals are blocked, and where churn or expansion needs action.
