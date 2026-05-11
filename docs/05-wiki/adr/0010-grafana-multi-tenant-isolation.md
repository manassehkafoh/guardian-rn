---
title: "ADR-0010: Multi-tenant isolation in Grafana (Teams + RLS)"
owner: tech-lead
audience: reference
last_reviewed: 2026-05-10
status: accepted
date: 2026-05-10
---

# ADR-0010: Multi-tenant isolation in Grafana (Teams + RLS)

## Status
Accepted (2026-05-10).

## Context
All tenant data flows into the same Grafana instance that runs against the shared Elasticsearch cluster. Without isolation controls, a tenant's operator could query or see another tenant's threat data — a confidentiality breach.

Three models were evaluated:

| Model | Description |
|---|---|
| **Separate Grafana instances** | One Grafana per tenant |
| **Separate organisations** | Grafana's built-in `orgs` feature: one org per tenant |
| **Teams + dashboard variables + Elasticsearch RLS** | Shared Grafana, tenant-scoped by query-time variable injection |

The choice must satisfy:
1. A guardian-rn operator can see all tenant data (aggregate view).
2. A tenant's own operator can only see their own data.
3. Adding a new tenant does not require deploying new infrastructure.
4. The isolation mechanism cannot be bypassed by a tenant operator editing a dashboard URL.

## Decision

### Model: Grafana Teams + Elasticsearch document-level security (DLS)

**Shared Grafana instance, one Team per tenant, Elasticsearch DLS enforces the data boundary.**

The two-layer design:

| Layer | Mechanism | What it enforces |
|---|---|---|
| **Grafana layer** | Grafana Teams; dashboard variable `$tenantId` bound to the team's allowed values | Scopes the UI; prevents a tenant from selecting another tenant's ID in the dashboard |
| **Elasticsearch layer** | DLS role: `{ "term": { "guardian.tenantId": "<tenantId>" } }` | Enforces at query time; returns empty results even if a crafted query omits the `tenantId` filter |

The Elasticsearch layer is the trust boundary. The Grafana layer is a UX guard. Neither alone is sufficient.

### Grafana team structure

```
Team: guardian-ops           ← internal operators; all dashboards; no tenantId restriction
Team: tenant-<tenantId>      ← one team per tenant; dashboards scoped to their tenantId
```

Team membership is managed via Grafana's API (provisioned by the tenant onboarding script, not hand-configured).

### Dashboard variable injection

All six committed dashboards (D-1 through D-6) include a `$tenantId` template variable:

```json
{
  "name": "tenantId",
  "type": "custom",
  "query": "${__user.teams}",   // Grafana built-in: resolves to the current user's team names
  "hide": 0,
  "multi": false
}
```

For `guardian-ops` team members, `$tenantId` is a free-text dropdown showing all tenants. For `tenant-acme` members, the dropdown is restricted to `acme` only (enforced by the team's allowed-values list, configured at team creation). Every Elasticsearch query in every panel uses `guardian.tenantId: "$tenantId"` as a mandatory filter.

### Elasticsearch DLS configuration

Each tenant has a dedicated ES role:

```json
{
  "indices": [{
    "names": ["logs-guardian.threat-*"],
    "privileges": ["read"],
    "query": "{\"term\": {\"guardian.tenantId\": \"<tenantId>\"}}"
  }]
}
```

The Grafana data source for tenant-scoped access authenticates to Elasticsearch using an API key bound to this role. The `guardian-ops` data source uses a separate API key with unrestricted read access.

There are therefore two Elasticsearch data sources configured in Grafana:

| Data source | ES API key scope | Used by |
|---|---|---|
| `Elasticsearch (Guardian - Ops)` | All tenants | `guardian-ops` team dashboards |
| `Elasticsearch (Guardian - Tenant)` | `$tenantId` DLS role | Tenant team dashboards |

Dashboard provisioning assigns the correct data source based on the dashboard's `meta.tenant` field in its JSON.

### Tenant onboarding script

Running `npm run onboard-tenant --workspace=packages/collector -- --tenantId=acme` performs:

1. Creates Elasticsearch role `guardian-tenant-acme` with DLS query.
2. Creates Elasticsearch API key bound to that role.
3. Creates Grafana team `tenant-acme`.
4. Adds the allowed `tenantId` value `acme` to the team's variable config.
5. Provisions the six tenant-scoped dashboard copies (using the `Elasticsearch (Guardian - Tenant)` data source).
6. Creates the data-stream `logs-guardian.threat-acme` with the ILM policy (ADR-0008).
7. Generates the mTLS client certificate for the tenant's SDK (signed by the guardian CA, ADR-0007).
8. Outputs the tenant's `apiKey` and certificate bundle.

This script is idempotent; re-running it for an existing tenant is safe.

### guardian-ops aggregate view

The `guardian-ops` team sees dashboards with `$tenantId = *` (wildcard), which queries all `logs-guardian.threat-*` indices simultaneously. This is the view used for the SLO health dashboard (D-6) and the cross-tenant bypass-tool watch (D-5).

### What this model does NOT support

- **Tenant self-service dashboard editing:** tenants get read-only access to their provisioned dashboards. If they want custom panels, they submit a request to the guardian-rn team. (Self-service editing is planned for v2.0 using Grafana's folder + permission model.)
- **Row-level security in Kibana:** Kibana's document-level security is handled by the same Elasticsearch role used for Grafana; tenants who have direct Kibana access (not default) use the same scoped API key.

## Consequences
- The Elasticsearch DLS is the authoritative isolation boundary. A bug in Grafana's variable injection (e.g., `$tenantId` not applied to a panel) would be caught by the DLS returning zero results, not by a data leak. This is the correct defence-in-depth posture.
- Two Elasticsearch data sources in Grafana add provisioning complexity but prevent a single misconfigured API key from exposing all tenants.
- The tenant onboarding script is the single point where new tenants are provisioned across ES, Grafana, and the collector. Any drift between these systems (e.g., ES role exists but Grafana team does not) will cause silent access denial; the script's idempotency check detects and repairs drift when re-run.
- Grafana OSS does not support Teams with variable restriction natively — this requires Grafana Enterprise or Grafana Cloud. The docker-compose dev stack uses Grafana Enterprise Trial (90 days) for local development; production must have a Grafana Enterprise licence.

## Alternatives considered
- **Separate Grafana instances per tenant** — rejected; O(n) infrastructure; no aggregate view across tenants for ops; operationally expensive to maintain.
- **Grafana organisations per tenant** — rejected; Grafana orgs require separate data source configurations per org and cannot be managed via a single admin session; the Grafana API for org management is limited compared to Teams.
- **Grafana dashboard variable only (no Elasticsearch DLS)** — rejected; a tenant who intercepts the Grafana API request or modifies the URL query parameter could supply a different `tenantId` and bypass the isolation. DLS is required as the enforcement layer.
- **Elasticsearch indices per tenant, index-level permissions only** — this is equivalent to DLS at the index level (since data streams are already per-tenant, per ADR-0006). This approach was considered but DLS was chosen because it allows the ops team to use wildcard index patterns while still scoping tenant access — not possible with index-level permissions alone.

## Links
- ADR-0006 (ECS field mapping — `guardian.tenantId` field used in DLS query)
- ADR-0007 (collector — tenant API key provisioned by onboarding script)
- ADR-0008 (ILM — data-stream created by onboarding script)
- `packages/collector/scripts/onboard-tenant.ts`
- `dashboards/` (all six committed dashboard JSON files)
- Grafana Teams documentation: https://grafana.com/docs/grafana/latest/administration/team-management/
