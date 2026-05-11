---
title: "ADR-0008: Index lifecycle policy (hot/warm/cold/delete)"
owner: tech-lead
audience: reference
last_reviewed: 2026-05-10
status: accepted
date: 2026-05-10
---

# ADR-0008: Index lifecycle policy (hot/warm/cold/delete)

## Status
Accepted (2026-05-10).

## Context
ADR-0006 established that threat events are stored in per-tenant Elasticsearch data-streams named `logs-guardian.threat-<tenantId>`. As data accumulates, the cluster must manage shard size, query performance, and storage costs without manual operator intervention. Elasticsearch's Index Lifecycle Management (ILM) handles this via a policy that transitions indices through phases as they age.

This ADR fixes the phase timings, rollover conditions, shard configuration per phase, and the retention period. These values must be agreed before the seed script (Lab 4, Step 5) can be written, because ILM policies cannot be changed retroactively without a migration.

Two competing priorities:
- **Query performance:** recent data (last 7 days) must be fast; p99 query latency must stay under 1 second for the Grafana dashboards.
- **Storage cost:** data older than 30 days is queried infrequently (forensic/compliance use); it should not consume hot-tier SSD space.

## Decision

### Policy name

`logs-guardian-policy` — applied to all `logs-guardian.threat-*` data-streams via the index template.

### Phase definitions

| Phase | Entry condition | Actions | Storage tier |
|---|---|---|---|
| **hot** | New index (rollover target) | Rollover when primary shard ≥ 50 GB **or** age ≥ 1 day | SSD / hot nodes |
| **warm** | 7 days after rollover | `shrink` to 1 primary shard; `forcemerge` to 1 segment; `readonly` | Warm nodes (HDD or cost-optimised SSD) |
| **cold** | 30 days after rollover | Convert to **searchable snapshot** on S3; remove local copy | Object storage (S3-compatible) |
| **delete** | 365 days after rollover | Delete index (snapshot remains in S3 WORM, governed separately) | — |

### Hot phase details

- **Primary shards:** 2 (balances parallelism against shard overhead for expected tenant event volumes).
- **Replica shards:** 1 (HA; no data loss on single-node failure).
- **Rollover conditions:** `max_primary_shard_size: 50gb` OR `max_age: 1d`. The size condition prevents unbounded shard growth on high-volume tenants; the age condition ensures low-volume tenants also rotate predictably.
- **Priority:** 100 (highest — hot indices are recovered first after cluster restart).

### Warm phase details

- **`shrink` target:** 1 primary shard. Warm-phase data is read-only; there is no write concurrency to justify multiple shards.
- **`forcemerge` max segments:** 1. Reduces segment count for faster query performance on historical data.
- **`readonly`:** set. Prevents accidental writes to warm indices.
- **Priority:** 50.

### Cold phase details

- **Searchable snapshot:** the index is converted to a searchable snapshot stored on the configured S3 repository (`guardian-snapshots`). The local shard data is removed. Queries against cold data mount the snapshot on-demand; latency is higher (2–10 seconds for first query) but the data is accessible without restore.
- **Replica count:** 0 (snapshots provide their own durability).
- **Use case:** forensic queries (incident post-mortems), compliance audits. Not used by the real-time Grafana dashboards.

### Delete phase

- **Age:** 365 days after rollover.
- **Action:** delete the Elasticsearch index (the underlying searchable snapshot in S3 is deleted separately by the S3 WORM bucket's object lock expiry policy, configured to 730 days — 2 years — to satisfy common compliance retention requirements).
- **Tenant overrides:** a tenant may request a longer retention period (e.g., 7 years for PCI-DSS). This is implemented by creating a tenant-specific ILM policy (`logs-guardian-policy-<tenantId>`) with an extended delete phase and binding it to that tenant's index template. The seed script supports this via an optional `retentionDays` parameter in the tenant config.

### Index template

```json
{
  "index_patterns": ["logs-guardian.threat-*"],
  "data_stream": {},
  "template": {
    "settings": {
      "index.lifecycle.name": "logs-guardian-policy",
      "index.number_of_shards": 2,
      "index.number_of_replicas": 1
    }
  },
  "priority": 200
}
```

### SLO interaction

The D-6 SLO & Pipeline Health dashboard (ADR-0001) tracks:
- Hot index rollover age (alert if any hot index exceeds 26 hours without rolling over — indicates a stuck ILM).
- Warm phase entry lag (alert if warm phase has not started within 8 days of rollover).
- Cold phase conversion success rate.

These are covered in the Runbook A-6 playbook.

## Consequences
- The 1-day hot rollover means a high-volume tenant (>50 GB/day) will have multiple hot indices simultaneously. The `max_primary_shard_size: 50gb` condition handles this correctly; operators must ensure sufficient hot-tier capacity.
- The `forcemerge` in the warm phase is an expensive operation (CPU + I/O). It is scheduled via ILM, which runs asynchronously in the background; it does not block ingest. However, it can spike ES CPU on the warm node — schedule during off-peak hours if possible (not yet configurable in v1.0).
- Searchable snapshots in the cold phase require the S3 snapshot repository to be configured and healthy. A misconfigured S3 repository will cause cold-phase transition failures visible in the Runbook A-6 ILM explain query.
- The 365-day delete policy means the cluster will grow steadily until warm and cold transitions catch up. Operators must monitor disk watermarks on hot nodes (D-6 dashboard) and add capacity or accelerate rollovers if the high-watermark threshold (85%) is approached.

## Alternatives considered
- **Time-based index naming only (no ILM)** — rejected; requires manual curator jobs; does not handle variable event volumes gracefully; gives no shard-size control.
- **Single phase, delete at 90 days** — rejected; regulated customers (banking, healthcare) require 365-day minimum; and the hot/warm/cold tiering is necessary to contain SSD costs at scale.
- **Frozen tier instead of cold** — rejected; the frozen tier requires a full snapshot restore before any query, which is too slow for the compliance-audit use case. Searchable snapshots (cold tier) are a better fit.
- **Per-tenant ILM policies for all tenants from day 1** — rejected; complexity without benefit for v1.0. Tenant-specific overrides are available via the seed script but are not the default.

## Links
- ADR-0006 (ECS field mapping — index naming convention)
- ADR-0007 (S3 WORM sink — separate from ILM-managed snapshots)
- Runbook §A-6 (ES cluster yellow/red)
- `packages/collector/seed/ilm-policy.json`
- `packages/collector/seed/index-template.json`
