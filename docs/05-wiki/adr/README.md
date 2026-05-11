---
title: Architectural Decision Records (ADRs)
owner: tech-lead
audience: reference
last_reviewed: 2026-05-10
---

# Architectural Decision Records

Every binding architectural decision is captured here using the [MADR](https://adr.github.io/madr/) format. ADRs are *immutable once accepted*: a superseding decision creates a new ADR that links to the old.

| # | Title | Status | Date |
|---|---|---|---|
| [0001](0001-architecture-baseline.md) | Architecture baseline (TurboModule, JSI, HMAC, codegen) | Accepted | 2026-05-10 |
| [0002](0002-turbomodule-jsi-install-layout.md) | TurboModule + JSI install layout, codegen package structure | Accepted | 2026-05-10 |
| [0003](0003-hmac-canonical-json.md) | HMAC algorithm and canonical-JSON serialisation (RFC 8785 JCS) | Accepted | 2026-05-10 |
| [0004](0004-engine-interface-lifecycle.md) | Engine interface, lifecycle, and conflation rules | Accepted | 2026-05-10 |
| [0005](0005-response-policy-semantics.md) | Response policy semantics (`restrict`, `lockout`, `kill`, grace period) | Accepted | 2026-05-10 |
| [0006](0006-ecs-field-mapping.md) | ECS field mapping and `guardian.*` namespace | Accepted | 2026-05-10 |
| [0007](0007-collector-trust-boundary.md) | Collector trust boundary and sink interface | Accepted | 2026-05-10 |
| [0008](0008-index-lifecycle-policy.md) | Index lifecycle policy (hot/warm/cold/delete) | Accepted | 2026-05-10 |
| [0009](0009-threat-feed-signing.md) | Threat-feed signing scheme (Ed25519, key rotation) | Accepted | 2026-05-10 |
| [0010](0010-grafana-multi-tenant-isolation.md) | Multi-tenant isolation in Grafana (Teams + RLS) | Accepted | 2026-05-10 |

## How to write a new ADR

1. Copy `_template.md` to `NNNN-short-kebab-name.md` with the next number.
2. Set `status: proposed` in the front-matter; fill the body.
3. Open a PR. Reviewers check that:
   - The decision is clearly stated and binding.
   - Alternatives were considered (not a foregone conclusion).
   - Consequences (including negative ones) are honestly listed.
4. Once two senior engineers + Tech Lead approve, change `status: accepted` and merge.
5. To supersede: write a new ADR, set `status: accepted` on the new one and `status: superseded by NNNN` on the old. Do **not** edit the body of the old ADR.

## ADR is for binding decisions

If your decision can be reverted in one sprint without coordination, it doesn't need an ADR — a code comment or PR description is fine. ADR-worthy decisions are those that, if reversed, would force migration of multiple components.
