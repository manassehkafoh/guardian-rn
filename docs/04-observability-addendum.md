# `guardian-rn` — Centralised Observability Addendum (ELK + Grafana + Reporting)

> **Companion to:** `02-superior-solution-proposal.md`, `03-implementation-plan.md`.
> **Purpose:** Close the observability gap identified during plan review — promote ELK + Grafana + reporting from "implementable via custom adapter" to **first-class supported**.
> **Codename:** `guardian-observe`. Ships as a sibling stack alongside the client SDK.

---

## 1. Architecture (Client → Collector → Storage → Visualisation → Reporting)

```
                     ┌────────── Devices in the wild ──────────┐
                     │                                         │
                     │  React Native app (guardian-rn client)   │
                     │  ├── @guardian/telemetry-elastic         │
                     │  │     • Batches events (max 50 / 5s)    │
                     │  │     • Offline buffer (SQLite, 7d cap) │
                     │  │     • mTLS, exp. backoff, jitter      │
                     │  └── ThreatEvent → ECS-mapped record     │
                     └─────────────────┬───────────────────────┘
                                       │  HTTPS POST (mTLS)
                                       │  /v1/ingest  (NDJSON, gzip)
                                       ▼
       ┌─────────────────────── @guardian/collector ────────────────────────┐
       │  Stateless Node service (Fastify + Pino), Helm-deployable           │
       │  ┌─────────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
       │  │ Auth (mTLS +    │  │ Rate-limit + │  │ Schema validate (ECS)  │ │
       │  │ tenant API key) │  │ replay guard │  │ + PII redactor         │ │
       │  └────────┬────────┘  └──────┬───────┘  └────────────┬───────────┘ │
       │           │                  │                       │             │
       │           ▼                  ▼                       ▼             │
       │  ┌────────────────────────────────────────────────────────────┐    │
       │  │  Fan-out (parallel, with circuit breaker per sink)          │    │
       │  └────┬──────────────┬──────────────┬─────────────┬───────────┘    │
       └───────┼──────────────┼──────────────┼─────────────┼────────────────┘
               ▼              ▼              ▼             ▼
        ┌──────────┐   ┌─────────────┐ ┌──────────┐ ┌─────────────┐
        │ Logstash │   │ Loki / Tempo│ │ S3 audit │ │ Kafka topic │
        │ pipeline │   │ (optional)  │ │ (WORM)   │ │ (optional)  │
        └─────┬────┘   └──────┬──────┘ └──────────┘ └─────────────┘
              ▼               ▼
       ┌───────────────┐  ┌──────────────────────┐
       │ Elasticsearch │  │ Promtail/Grafana Agent│
       │ (ILM:hot/warm)│  │ → Loki/Mimir          │
       └───────┬───────┘  └──────────────┬───────┘
               │                         │
               └────────────┬────────────┘
                            ▼
                 ┌──────────────────────┐
                 │ Grafana (dashboards, │
                 │ alerts, RBAC)        │
                 └──────────┬───────────┘
                            ▼
                 ┌──────────────────────┐
                 │ Reporting worker     │
                 │ (Node + ES queries)  │
                 │ Weekly digest email  │
                 └──────────────────────┘
```

**Why this shape:** the collector is a thin trust boundary that decouples device fan-in from sink fan-out. ES is the primary store (search + visualisation). Loki is optional for shops that prefer logs-as-streams. S3 is the audit-WORM store for compliance. Kafka is optional and unlocks SIEM fan-out (Splunk/Sentinel) without touching the device path.

---

## 2. Client-Side: `@guardian/telemetry-elastic`

### 2.1 Public API

```ts
import { guardian } from 'guardian-rn';
import { elasticTelemetry } from '@guardian/telemetry-elastic';

guardian.telemetry.use(
  elasticTelemetry({
    endpoint: 'https://collect.example.com/v1/ingest',
    tenantId: 'acme-banking',
    clientCert: Platform.OS === 'ios' ? iosCertRef : androidCertRef, // mTLS
    batch:    { maxEvents: 50, maxIntervalMs: 5_000, maxBytes: 256 * 1024 },
    buffer:   { kind: 'sqlite', maxDays: 7, maxBytes: 8 * 1024 * 1024 },
    redact:   { externalId: 'hash', evidence: ['suspiciousApps[*].appName'] },
    backoff:  { initialMs: 1_000, maxMs: 60_000, jitter: 'full' },
    enabled:  () => !__DEV__,    // gate by env
  }),
);
```

### 2.2 Behavioural contract

| Property | Value | Why |
|---|---|---|
| Batch boundaries | max 50 events OR 5s OR 256 KB body | Balance latency vs ingest cost |
| Offline buffer | SQLite, configurable max (default 7d / 8 MB) | Survives airplane mode, slow networks |
| Retry strategy | Exponential backoff with full jitter, max 60s | Avoid thundering-herd on collector restart |
| Drop-policy | Drop-newest after buffer cap, increment dropped-counter (itself shipped) | Bounded memory; observable starvation |
| TLS | mTLS mandatory in prod; cert pinned to a public-key SHA-256 fingerprint | Prevents collector impersonation |
| Compression | gzip on body; collector negotiates via `Content-Encoding` | Mobile bandwidth |
| Idempotency | Each batch carries a UUIDv7 `batchId`; collector dedupes by `(tenantId, batchId)` for 24h | Safe retry |
| Clock skew | Each event carries device `capturedAt` AND collector stamps `ingestedAt`. Both indexed. | Forensics across timezones |

### 2.3 ECS field mapping

We adopt **Elastic Common Schema (ECS) 8.x**. Custom fields live under the `guardian.*` namespace. Excerpt of the index template below; full mapping at `packages/telemetry-elastic/ecs-mapping.json`.

```json
{
  "@timestamp": "<capturedAt, ISO-8601>",
  "ecs": { "version": "8.11.0" },
  "event": {
    "kind": "alert",
    "category": ["threat"],
    "type": ["info"],
    "severity": 1-100,
    "outcome": "success" | "failure" | "unknown",
    "id": "<envelope.seq + sessionId>",
    "ingested": "<collector ingestedAt>",
    "module": "guardian-rn",
    "dataset": "guardian.threat",
    "sequence": 12345
  },
  "host":    { "id": "<deviceId or null>", "os": { "name", "version", "platform", "kernel" } },
  "device":  { "manufacturer", "model", "id" },
  "user":    { "id": "<hashed externalId, optional>" },
  "client":  { "ip": "<edge IP — set by collector>" },
  "service": { "name": "guardian", "version": "<sdk version>", "environment": "prod|stage|dev" },
  "tags":    ["rasp", "<engine>", "<threatId>"],
  "labels":  { "tenant": "<tenantId>", "appBundleId": "...", "platform": "ios|android" },
  "guardian": {
    "session_id":   "<UUIDv4, per-process>",
    "engine":       ["community"|"talsec"|...],
    "threat_id":    "hooks",
    "severity":     "info|low|medium|high|critical",
    "confidence":   0.92,
    "policy":       "telemetry|restrict|lockout|kill",
    "evidence":     { "kind": "hooks", "framework": "frida", "signatures": ["..."] },
    "envelope": {
      "verified": true,
      "seq":      4711,
      "key_id":   "<sessionKey thumbprint, last4>"
    },
    "sdk": { "version": "1.0.0", "rn": "0.74.5", "new_arch": true }
  }
}
```

### 2.4 PII redaction at the SDK

- `externalId` → SHA-256 hex (configurable: `'plain'|'hash'|'omit'`). Default `'hash'`.
- `evidence.suspiciousApps[*].appName` → SHA-256 hex by default; `appIcon` always omitted.
- IP address never sent by the SDK; the collector stamps it from the TLS edge.
- A debug-only `__redactedPreview` field shows what was redacted (off in prod).

### 2.5 Tests (P4 + P5.5)

- Round-trip: synthetic threat → SDK adapter → mock collector → ECS-valid JSON.
- Offline: kill network for 60s; assert events queue in SQLite, then drain on reconnect.
- Backpressure: emit 1000 threats in 100ms; assert no event is duplicated and dropped count = `1000 - delivered`.
- mTLS misconfig: invalid client cert → adapter goes `degraded`, surfaces `EngineState='degraded'`.
- Pinning: server cert with rotated key but valid CA → still rejected unless rotation key was pre-configured.

---

## 3. Server-Side: `@guardian/collector`

A small, **stateless** Node service (Fastify + Pino + undici) that does five jobs and nothing else.

### 3.1 Responsibilities

1. **Authenticate**: mTLS handshake terminates here (or at an Envoy/NGINX in front; both are supported). Tenant API key in `X-Guardian-Tenant`.
2. **Validate**: NDJSON body parsed; each line ECS-validated against `index-template.json` (ajv compiled).
3. **Redact**: server-side pass for `client.ip` stamping and last-line PII-policy enforcement (defence-in-depth even if SDK redaction is bypassed).
4. **Fan-out**: to configured sinks in parallel with per-sink circuit breakers.
5. **Account**: per-tenant ingest counters (events/byte/req), exposed at `/metrics` (Prometheus format).

### 3.2 OpenAPI sketch

```yaml
paths:
  /v1/ingest:
    post:
      summary: Ingest a batch of guardian threat events
      security: [{ mTLS: [], TenantKey: [] }]
      requestBody:
        content:
          application/x-ndjson:
            schema: { type: string, format: binary }
      responses:
        '202': { description: Accepted (batchId in header) }
        '400': { description: Schema invalid }
        '401': { description: Auth failed }
        '413': { description: Batch too large }
        '429': { description: Rate-limited (per-tenant token-bucket) }
  /healthz: { get: { responses: { '200': { description: OK } } } }
  /metrics: { get: { responses: { '200': { description: Prometheus exposition } } } }
```

### 3.3 Sink interface

```ts
export interface Sink {
  readonly name: string;
  readonly required: boolean;            // if true, failure = 5xx to client
  write(batch: ECSEvent[], ctx: IngestCtx): Promise<void>;
}

const sinks: Sink[] = [
  logstashSink({ host, port, tls }),     // required
  s3AuditSink({ bucket, kmsKey }),       // required (compliance)
  kafkaSink({ brokers, topic }),         // optional
  lokiSink({ url, labels }),             // optional
];
```

Per-sink circuit breaker: 5 consecutive failures → open for 30s, half-open after, fail-closed if sink is `required`.

### 3.4 Logstash pipeline (illustrative)

`pipeline/guardian.conf`:

```
input {
  tcp { port => 5044 codec => json_lines }
}

filter {
  if [event][module] != "guardian-rn" { drop {} }

  date {
    match => ["@timestamp", "ISO8601"]
    target => "@timestamp"
  }

  fingerprint {
    source    => ["guardian.session_id", "event.sequence"]
    target    => "[event][id]"
    method    => "SHA256"
  }

  mutate {
    add_field => {
      "[data_stream][type]" => "logs"
      "[data_stream][dataset]" => "guardian.threat"
      "[data_stream][namespace]" => "%{[labels][tenant]}"
    }
  }
}

output {
  elasticsearch {
    hosts => "${ES_HOSTS}"
    data_stream => "true"
    user        => "${ES_USER}"
    password    => "${ES_PASS}"
  }
}
```

### 3.5 Index Lifecycle Management

`elasticsearch/ilm/guardian-threat.json`:

```json
{
  "policy": {
    "phases": {
      "hot":    { "actions": { "rollover": { "max_age": "1d", "max_primary_shard_size": "30gb" } } },
      "warm":   { "min_age": "7d",  "actions": { "shrink": { "number_of_shards": 1 }, "forcemerge": { "max_num_segments": 1 } } },
      "cold":   { "min_age": "30d", "actions": { "searchable_snapshot": { "snapshot_repository": "guardian-snaps" } } },
      "delete": { "min_age": "365d","actions": { "delete": {} } }
    }
  }
}
```

Per-tenant data streams (`logs-guardian.threat-<tenantId>`) give clean retention overrides for regulated customers.

### 3.6 Deploy

- **Helm chart**: `helm install guardian-collector ./charts/collector --values prod.yaml`. Two replicas minimum, HPA on CPU + ingest-queue depth.
- **Docker Compose** for self-hosters: single-node ELK + Grafana + collector for < 1k devices.
- **AWS reference**: ALB (mTLS termination) → ECS Fargate (collector) → MSK (Kafka) → OpenSearch (managed ES) → Managed Grafana. Terraform module published.

---

## 4. Grafana Dashboards (committed JSON)

Six dashboards ship in `dashboards/`. Each is provisioned via Grafana's file-based provisioning so they're version-controlled and CI-validated (panel JSON schema check, query lint via `grafana-loki-rules-checker` style tooling).

### 4.1 D-1: Threat Heatmap (Overview)

Audience: SecOps, exec.

| Panel | Query (Lucene/ES) | Visualisation |
|---|---|---|
| Threats / hour (24h) | `event.module:guardian-rn` | Timeseries, stacked by `guardian.severity` |
| Top threats (24h) | terms agg on `guardian.threat_id` | Bar chart |
| Severity heatmap | `guardian.threat_id` × time, value=count | Heatmap |
| Top affected app versions | terms on `service.version`, filter `guardian.severity:(high OR critical)` | Table |
| Geo distribution | terms on `client.geo.country_iso_code` (collector enriches) | Worldmap |
| Anomaly score | rolling z-score on hourly volume | Stat panel |

### 4.2 D-2: Engine Health

Audience: SDK engineers.

- Engine emit-rate per platform/version.
- HMAC envelope verification failure rate (should be ~0; alert if > 0).
- Sequence-gap rate (should be ~0; alert if > threshold).
- p50/p95/p99 emit-to-ingest latency (computed `ingestedAt - capturedAt`).
- SDK version distribution sankey.

### 4.3 D-3: False-Positive Triage

Audience: Detection engineers.

- Threats marked FP via host-reported flag (collector accepts a `feedback` event type).
- FP rate per `(threatId, engine, sdk_version)`.
- Detector confidence distribution; shows whether < 0.6 threshold needs tuning.

### 4.4 D-4: Per-Customer Drill-down (multi-tenant)

Audience: CSMs, on-call.

- Variables: `tenantId`, `appBundleId`, `severity`.
- Repeats D-1 panels filtered by tenant.
- "Recent critical events" table with deep-link to the raw ECS document.

### 4.5 D-5: Bypass-Tool Watch

Audience: Threat researchers.

- Frida/Magisk/KernelSU/Xposed signatures hit-count over time.
- New-signature alerts (when an evidence signature appears for the first time in 30 days).

### 4.6 D-6: SLO & Pipeline Health (the meta dashboard)

Audience: SRE.

- Collector p99 latency, error budget burn-down (SLO: 99.9% < 200 ms).
- Sink circuit-breaker state.
- ES cluster status, ILM phase counts.
- Logstash queue depth.
- Per-tenant ingest rate vs quota.

### 4.7 Provisioning + tests

- `dashboards/provisioning.yaml` references all six.
- CI step: `grafana-export` validate (JSON schema), then `grafana-cli dashboard import` against an ephemeral Grafana → assert panel queries return 200.

---

## 5. Alerting

Two layers, intentionally redundant:

### 5.1 Grafana Alerting (presentation-layer, opinionated thresholds)

- **A-1 Critical-threat spike**: rate of `guardian.severity:critical` per tenant > 3× 7-day median (15 min window). → PagerDuty.
- **A-2 Engine emit-rate dropout**: 0 events for 30 min from a tenant that normally has ≥ 1/min. → Slack.
- **A-3 HMAC verification failures**: any non-zero count over 5 min. → Slack + PagerDuty.
- **A-4 Sequence gaps spike**: > 0.1% of events show a gap. → Slack.
- **A-5 Collector ingest p99**: > 200 ms for 5 min. → SRE PagerDuty.
- **A-6 ES cluster yellow/red**: → SRE PagerDuty.

### 5.2 ElastAlert / Watcher (data-layer, correlation rules)

- **W-1 Compromise pattern**: `(privilegedAccess AND hooks) within 60s for the same sessionId` → tenant-CSIRT email.
- **W-2 New evidence signature**: any `evidence.signatures[*]` not seen in the last 30 days → research mailbox.
- **W-3 Multi-instance + deviceBinding combo**: → fraud team mailbox.

Each rule ships as YAML in `alerting/`, version-controlled, with golden-test fixtures (run rule against canned ES results, assert hit/miss).

---

## 6. Weekly Reporting Worker

Replaces freeRASP's `watcherMail` with a **pluggable digest pipeline**.

### 6.1 What ships

```
@guardian/reporting/
├── src/
│   ├── queries/                # ES queries (typed via @elastic/elasticsearch)
│   │   ├── topThreats.ts
│   │   ├── trendDelta.ts
│   │   ├── newSignatures.ts
│   │   └── slaSummary.ts
│   ├── renderers/
│   │   ├── email-html.tsx      # MJML template
│   │   ├── email-text.ts
│   │   ├── pdf.ts              # react-pdf
│   │   └── markdown.ts         # for Slack/Teams export
│   ├── schedules.ts            # cron triggers
│   └── delivery/
│       ├── sendgrid.ts
│       ├── ses.ts
│       └── webhook.ts          # generic POST
└── tests/
    └── golden/                 # canned ES → expected report
```

### 6.2 Default weekly digest content

1. Executive summary (1 paragraph): "X threats detected across Y devices. Critical: Z (vs. last week)."
2. Top 10 threat types with WoW delta.
3. Affected app versions.
4. Detected bypass tools (with first-seen dates).
5. False-positive rate trend.
6. SDK health (HMAC failures, sequence gaps).
7. SLO summary.
8. Tenant-specific call-to-actions ("upgrade SDK from 1.0.0 → 1.1.2 for new KernelSU detection").

### 6.3 Configuration

Per-tenant config in YAML:

```yaml
tenant: acme-banking
schedule: "0 7 * * MON"          # Mondays 07:00 UTC
timezone: Europe/London
recipients:
  - security@acme.example
  - oncall@acme.example
formats: [email-html, pdf]
delivery: ses
filters:
  appBundleId: ["com.acme.banking"]
  minSeverity: low
attachments:
  raw_events_csv: false          # GDPR — opt-in only
```

### 6.4 Tests

- Golden-file test per query: canned ES JSON → expected output.
- Snapshot test of rendered HTML/MJML and PDF (visual regression via `puppeteer` snapshot diff).
- E2E test: spin ephemeral ES, seed canned data, run worker, intercept SES call, assert payload shape.

---

## 7. Data Residency, GDPR, Compliance

| Concern | Treatment |
|---|---|
| **Residency** | Collector deployable per region; tenants choose `eu-west-1`, `us-east-1`, `ap-south-1`. SDK config carries region; ingest endpoint is regional. |
| **PII minimisation** | SDK redaction defaults to hashing `externalId` and app-name fields. Collector enforces server-side. |
| **Right to erasure (Art. 17)** | `DELETE /v1/erase` endpoint accepts a hashed `externalId`; deletes via `_delete_by_query` across the relevant data streams. Audit row written to S3 WORM. |
| **Right of access (Art. 15)** | `GET /v1/export?subject=<hash>` returns NDJSON of all events for that subject, signed by the collector. |
| **Retention** | ILM defaults to 1y; per-tenant overrides supported. |
| **Audit log** | Every collector decision (auth pass/fail, redaction applied, sink failure) logged to S3 WORM with object-lock. |
| **Encryption at rest** | ES configured with encrypted snapshots + KMS-managed CMK. S3 sink uses SSE-KMS. |
| **Encryption in transit** | mTLS device→collector; TLS 1.3 collector→ES; encrypted Kafka if used. |
| **DPA artefacts** | Standard DPA template + sub-processor list shipped in `legal/`. |

---

## 8. SLOs

| SLO | Target | Measurement |
|---|---|---|
| Ingest availability | 99.9% / 30d | `2xx + 429` / total at `/v1/ingest` |
| Ingest latency p99 | < 200 ms | collector histogram |
| End-to-end freshness | event-captured → searchable in Kibana < 60s p99 | `now - capturedAt` measured at search-query time on a synthetic probe |
| HMAC verification failures | 0 (any non-zero is an incident) | counter |
| Dashboard query latency p95 | < 2s | Grafana panel `query_data_latency` |
| Weekly report delivery | by 09:00 local on schedule day, > 99% | scheduled-job result store |

Error-budget burn dashboards live in D-6.

---

## 9. Updated Phase Plan (insert P5.5)

The original plan from `03-implementation-plan.md` is amended; only changed/added items shown.

### P4 — JS API & State Machine (unchanged 3w, +3 days inside)

- **Add 3 days** for the **`@guardian/telemetry-elastic`** SDK adapter (client-side only). Implements §2.

### P5.5 — Centralised Observability Pipeline (NEW, 4 weeks, between P5 and P6)

Goal: collector + ES + Grafana + reporting worker all running, with the dashboards committed and CI-validated.

| Week | Workstream | Deliverable |
|---|---|---|
| **5.5.1** | Collector Node service | mTLS handshake, NDJSON parse, ECS validate, redact, fan-out to Logstash/S3. /healthz, /metrics, OpenAPI doc. |
| **5.5.2** | ES + ILM + Logstash | Index template (ECS + `guardian.*` extension), ILM policy, Logstash pipeline, data-stream-per-tenant. |
| **5.5.3** | Grafana | Six dashboards JSON, provisioning config, query lint in CI, alert rules (Grafana + ElastAlert). |
| **5.5.4** | Reporting + compliance | Weekly digest worker (email + PDF + markdown), erasure/export endpoints, S3 WORM audit. |

Parallel work during P5.5:
- Helm chart + Terraform module for AWS reference deploy.
- Docker Compose self-host bundle.
- Synthetic-probe service (writes one event/min per region; alerts on freshness SLO).

Total elapsed: **30 weeks** (was 26). With 1 additional back-end-leaning engineer for the 4-week window, no calendar slip.

### Updated decision gate

**G-Observe** (end of P5.5): Does the synthetic probe show end-to-end freshness < 60s p99 in all reference deploys? If no, **stop** and harden before P6.

---

## 10. Engineering Practice Notes

- **Schema is law.** ECS mapping lives next to the SDK adapter; collector and Logstash both validate against the same artefact. CI fails on drift.
- **Backwards-compatible additions only.** Adding a `guardian.*` field is fine; renaming or removing one is a breaking SDK release.
- **Dashboard JSON is reviewed like code.** No clicking-changes-into-prod-Grafana. CI pulls the live dashboard, diffs against repo, fails on drift.
- **Synthetic probes >> live alerts.** A probe that emits a known event every minute catches pipeline failures the moment they happen — without waiting for real customer traffic to reveal them.
- **No customer-data dashboards in shared Grafana orgs.** Tenant-isolation via Grafana Teams + data-source row-level security via `_security` queries.

---

## 11. What this addendum closes (vs. the gap report)

| Gap from prior message | Now addressed in |
|---|---|
| ELK adapter (Elasticsearch HTTP / Logstash beat) | §2 (SDK adapter) + §3 (collector → Logstash → ES) |
| Grafana dashboards | §4 (six dashboards committed) |
| Centralised collection backend | §3 (`@guardian/collector` Node service, Helm + Terraform) |
| Multi-tenant aggregation | §3.5 (per-tenant data streams), §4.4 (drill-down dashboard) |
| Reporting layer (weekly email replacement) | §6 (`@guardian/reporting` worker) |
| GDPR / PII redaction at ingest | §2.4 (SDK), §3.3 (collector defence-in-depth), §7 (compliance matrix) |
| RBAC on dashboards | §4.7 (Teams + RLS) |
| ILM / retention | §3.5 (ILM JSON, ILM phases hot/warm/cold/delete) |
| Alerting | §5 (Grafana Alerting + ElastAlert) |
| SIEM correlation handoff | §3.3 (Kafka sink), §5.2 (correlation rules) |
| Pipeline SLOs | §8 |

Net result: **observability is now a first-class, self-hostable, multi-tenant pillar of `guardian-rn`** — not an afterthought left to host-app engineers.
