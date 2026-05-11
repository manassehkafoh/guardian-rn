---
title: "ADR-0006: ECS field mapping and guardian.* namespace"
owner: tech-lead
audience: reference
last_reviewed: 2026-05-10
status: accepted
date: 2026-05-10
---

# ADR-0006: ECS field mapping and `guardian.*` namespace

## Status
Accepted (2026-05-10).

## Context
The collector (`packages/collector`) writes every inbound threat event as an Elasticsearch document. The schema of that document must be agreed before the Logstash pipeline, the Kibana data view, Grafana dashboard queries, and the ElastAlert rules can be written.

[Elastic Common Schema (ECS)](https://www.elastic.co/guide/en/ecs/current/index.html) provides a standard field set that makes guardian-rn events interoperable with the broader Elastic security ecosystem (SIEM rules, Endpoint integration, etc.). Custom fields that have no ECS equivalent go in a `guardian.*` namespace.

Two competing approaches were considered:
1. **ECS-first:** map as much as possible to ECS standard fields; use `guardian.*` only for what ECS cannot express.
2. **Flat custom:** put everything in `guardian.*` and ignore ECS.

## Decision

### Approach

**ECS-first.** Standard ECS fields are used wherever ECS semantics match. `guardian.*` fields supplement ECS for domain-specific data that ECS does not model.

### Top-level ECS field mapping

| Guardian concept | ECS field | Notes |
|---|---|---|
| Ingest timestamp | `@timestamp` | Collector wall-clock time, not device clock |
| Event kind | `event.kind` | Always `"event"` |
| Event category | `event.category` | `["authentication"]` for access threats; `["malware"]` for malware detection |
| Event type | `event.type` | `["info"]` (telemetry), `["denied"]` (restrict/lockout), `["end"]` (kill) |
| Event outcome | `event.outcome` | `"unknown"` — the outcome depends on the app's policy response |
| App name | `service.name` | `"guardian-rn"` |
| App version (SDK) | `service.version` | e.g., `"1.0.0"` |
| Tenant identifier | `organization.id` | tenant's `apiKey`-derived ID; not the raw API key |
| Device OS | `host.os.name` | `"Android"` or `"iOS"` |
| Device OS version | `host.os.version` | e.g., `"17.4.1"` |
| Device architecture | `host.architecture` | `"arm64"`, `"x86_64"`, etc. |
| App package name | `process.name` | e.g., `"com.acme.myapp"` |
| App version (customer) | `process.args_count` | Not ideal ECS fit — see note below |

> **Note on `process.args_count`:** ECS has no standard field for "host app version". We use `labels.appVersion` (ECS `labels` is a flat string map for custom key-value pairs) rather than abusing `process.*`. This is revisited in ADR-0006-amendment if ECS 9.x adds an `app.*` fieldset.

### `guardian.*` namespace

All guardian-specific fields use a single top-level `guardian` object:

```
guardian.threatId          keyword    e.g. "root", "hooks"
guardian.severity          keyword    "low" | "medium" | "high" | "critical"
guardian.confidence        float      0.0–1.0
guardian.sessionId         keyword    UUID v4 per process lifetime
guardian.seq               long       monotonic sequence number
guardian.envelope.verified boolean    HMAC verification result
guardian.tenantId          keyword    tenant identifier (same as organization.id)
guardian.engineId          keyword    e.g. "community@1.0.0"
guardian.evidence.*        object     arbitrary key-value evidence from the engine
guardian.policy.name       keyword    "telemetry" | "restrict" | "lockout" | "kill"
guardian.policy.executedAt date       Unix epoch ms
guardian.policy.confidenceAtExecution  float
guardian.policy.killDeferred           boolean
guardian.exclusion.appliedRule         keyword    null if no exclusion applied
guardian.bus.droppedCount              long       events dropped by rate cap since session start
```

### `guardian.evidence.*` mapping

Evidence fields are engine-defined and therefore dynamic. The Elasticsearch index template uses a dynamic mapping rule for `guardian.evidence.*`:

```json
{
  "path_match": "guardian.evidence.*",
  "mapping": { "type": "keyword", "ignore_above": 1024 }
}
```

All evidence values are indexed as `keyword` (not `text`) to support exact-match aggregations in FP triage. Values longer than 1024 characters are silently truncated. This is intentional: evidence values are metadata fingerprints, not prose.

### PII redaction policy

The collector applies PII redaction before writing to Elasticsearch. Fields that must never reach the index:

| Field | Disposition |
|---|---|
| `guardian.evidence.deviceId` | SHA-256 pseudonymised before storage |
| `guardian.evidence.userId` | Dropped entirely (tenants must not send user identifiers) |
| `host.ip` | Dropped (IP retention requires separate legal basis) |
| `guardian.evidence.location.*` | Truncated to city-level (lat/lon dropped) |

The redaction rules are enforced in the Logstash pipeline (`packages/collector/logstash/pipeline/guardian.conf`) and are not bypassable by the SDK.

### Full example document

```json
{
  "@timestamp": "2026-05-10T14:30:00.000Z",
  "event.kind": "event",
  "event.category": ["authentication"],
  "event.type": ["denied"],
  "event.outcome": "unknown",
  "service.name": "guardian-rn",
  "service.version": "1.0.0",
  "organization.id": "tenant-acme",
  "host.os.name": "Android",
  "host.os.version": "14",
  "host.architecture": "arm64",
  "process.name": "com.acme.banking",
  "labels": { "appVersion": "5.2.1" },
  "guardian": {
    "threatId": "hooks",
    "severity": "critical",
    "confidence": 0.92,
    "sessionId": "a3f8c2d1-...",
    "seq": 7,
    "envelope": { "verified": true },
    "tenantId": "tenant-acme",
    "engineId": "community@1.0.0",
    "evidence": {
      "hookFramework": "frida",
      "targetMethod": "com.acme.banking.auth.TokenManager.getToken"
    },
    "policy": {
      "name": "lockout",
      "executedAt": 1715350800000,
      "confidenceAtExecution": 0.92,
      "killDeferred": false
    },
    "exclusion": { "appliedRule": null },
    "bus": { "droppedCount": 0 }
  }
}
```

### Index naming

`logs-guardian.threat-<tenantId>` — one data-stream per tenant. The `logs-` prefix qualifies the data-stream for ILM policy inheritance (ADR-0008).

## Consequences
- ECS alignment means guardian-rn events can be correlated with Elastic Security SIEM rules without field translation. A future integration with Elastic Endpoint or Elastic Agent becomes cheaper.
- Dynamic `guardian.evidence.*` mapping prevents the index from requiring a schema change every time a new engine emits a new evidence key. The `keyword`-only mapping trades full-text search for consistent aggregation behaviour.
- The PII redaction rules are enforced in the Logstash pipeline. Any change to the rules requires a pipeline re-deploy (not just an SDK release), which is the correct locus of control for data governance.
- `organization.id` used for tenant ID means tenant names are not stored in ECS standard fields; operators must join on `guardian.tenantId` for any tenant-name display (resolved via a Kibana index alias or Grafana lookup table).

## Alternatives considered
- **Flat custom schema (ignore ECS)** — rejected; would require a custom SIEM integration layer for every Elastic security product the customer uses.
- **OCSF (Open Cybersecurity Schema Framework)** — considered; OCSF 1.0 was released in 2022 and is gaining adoption. Rejected for v1.0 because Elasticsearch's native ECS integration is significantly more mature; OCSF support can be added as a second sink in a future ADR.
- **One index for all tenants with a `tenantId` field** — rejected; per-tenant data-streams provide isolation for ILM policy, shard routing, and Grafana row-level security (ADR-0010). The operational overhead of one stream per tenant is acceptable at the scale guardian-rn targets.

## Links
- ADR-0007 (collector: PII redaction, sink interface)
- ADR-0008 (ILM: `logs-guardian.threat-*` policy)
- ADR-0010 (Grafana multi-tenant isolation: tenantId in queries)
- ECS reference: https://www.elastic.co/guide/en/ecs/current/index.html
- `packages/collector/logstash/pipeline/guardian.conf`
- `packages/collector/src/schema/ecs-mapping.ts`
