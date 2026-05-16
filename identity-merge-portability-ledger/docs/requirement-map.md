# Requirement Map

## Authentication & Identity

- Account linking is modeled through verified ORCID, SAML, GitHub, Google, and email subjects.
- Merge decisions detect verified identity conflicts before accounts are collapsed.
- MFA state is enforced when a researcher requests private profile export data.

## Researcher Profiles

- Export packages include public profile fields, keywords, reputation metrics, linked identities, and project memberships.
- Private fields such as email, grants, affiliations, publications, and activity are included only when policy allows it.
- Redactions make public vs private profile behavior reviewable.

## Project Spaces

- Merge decisions inspect project ownership, roles, and object grants.
- Duplicate-account ownership and object grants are converted into explicit transfer actions.
- Export packages include project visibility, role, and object grant counts.

## Permissions & Access Control

- Third-party private export requests are held for review.
- Missing accounts and identity-provider collisions block unsafe merges.
- Project and object-level access changes are recorded as actions instead of hidden side effects.

## Audit Log

- Merge and export decisions emit signed audit events.
- The manifest digest is deterministic so reviewers can compare reruns.
