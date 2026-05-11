---
title: "ADR-0007: Collector trust boundary and sink interface"
owner: tech-lead
audience: reference
last_reviewed: 2026-05-10
status: accepted
date: 2026-05-10
---

# ADR-0007: Collector trust boundary and sink interface

## Status
Accepted (2026-05-10).

## Context
The collector (`packages/collector`) is the single network-facing ingestion point for all guardian-rn threat events. This ADR defines what the collector is responsible for, what it is explicitly not responsible for, how it authenticates SDK clients, and the `Sink` interface that abstracts its downstream outputs (Logstash, S3, Kafka).

The collector sits at the trust boundary between the (untrusted) SDK running on a device the attacker may control and the (trusted) internal observability pipeline. Everything the collector does must be justified by that trust-boundary position; anything that is not a trust-boundary concern belongs elsewhere.

## Decision

### Collector responsibilities (in scope)

1. **mTLS authentication:** SDK clients present a client certificate signed by the guardian CA. The collector validates the chain. Certificates are per-tenant, short-lived (90-day TTL), and rotatable without SDK release (see ADR-0009 for the signing scheme).
2. **API key validation:** A secondary `X-API-Key` header provides a fast pre-mTLS rejection path for unauthenticated traffic (DDoS defence). The API key is tenant-scoped and is rotatable.
3. **HMAC envelope verification:** For each event in the batch, the collector re-computes the HMAC using the session key from the session store (Redis, keyed by `sessionId`). Events with `guardian.envelope.verified: false` are stored but quarantined (ADR-0003).
4. **ECS validation:** Incoming events are validated against the collector's ECS schema. Malformed documents are rejected with `400`; the rejection count is exported as a Prometheus metric.
5. **PII redaction:** Applied before any downstream write (ADR-0006).
6. **Fan-out to sinks:** After validation and redaction, the collector writes to all configured sinks via the `Sink` interface.
7. **Idempotency:** Duplicate batches (same `batchId`) are detected via a Redis idempotency key (TTL: 24 hours) and acknowledged without re-processing.
8. **Health endpoint:** `GET /health` returns collector status, used by Lab 4 and by the SLO dashboard.

### Collector non-responsibilities (explicitly out of scope)

- **Response policy execution** — this runs in the SDK on the device, not in the collector.
- **Alert routing** — handled by ElastAlert rules reading from Elasticsearch.
- **Dashboard rendering** — Grafana reads from Elasticsearch directly.
- **Threat-feed distribution** — handled by a separate feed service (ADR-0009).
- **Tenant management / provisioning** — handled by a separate admin API (out of scope for v1.0).
- **Long-term storage** — the collector writes to sinks; retention is an ILM concern (ADR-0008).

### Session handshake

Before the SDK can submit events, it performs a session handshake:

```
POST /session
X-API-Key: <tenant-api-key>
mTLS client cert required

Body: { "sessionId": "<UUID>", "publicKeyHash": "<SHA-256 of session public key>" }

Response: { "sessionToken": "<JWT>", "expiresAt": "<ISO-8601>" }
```

The session token is a short-lived JWT (1-hour TTL, HS256 with collector's internal secret). The SDK includes it as `Authorization: Bearer <token>` on all subsequent `POST /ingest` calls. This separates the expensive mTLS handshake from per-batch authentication.

The session key for HMAC verification is not transmitted; the collector derives it server-side from the `publicKeyHash` and its stored per-tenant key material. (This is a deliberate simplification for v1.0; a full ECDH key exchange is specified for v2.0.)

### Ingest endpoint

```
POST /ingest
Authorization: Bearer <session-token>
Content-Type: application/json

Body: GuardianBatch
```

```typescript
interface GuardianBatch {
  batchId: string;         // UUID; idempotency key
  tenantId: string;
  events: GuardianEnvelope[];
}
```

Maximum batch size: 50 events or 256 KB, whichever comes first. Batches exceeding either limit receive `413`.

The collector processes the batch synchronously (validate → redact → fan-out) and responds:

```json
{ "accepted": 47, "rejected": 3, "batchId": "..." }
```

Rejected events are logged with their rejection reason but do not cause the entire batch to fail (partial acceptance).

### Sink interface

```typescript
interface Sink {
  readonly id: string;
  write(documents: EcsDocument[]): Promise<SinkWriteResult>;
  healthCheck(): Promise<SinkHealth>;
}

interface SinkWriteResult {
  written: number;
  failed: number;
  errors: SinkError[];
}
```

Three sink implementations ship in-tree:

| Sink | Class | Description |
|---|---|---|
| Logstash | `LogstashSink` | TCP/Lumberjack protocol to Logstash input; primary path to Elasticsearch |
| S3 WORM | `S3Sink` | Gzip-compressed NDJSON to S3-compatible bucket; write-once object lock |
| Kafka | `KafkaSink` | Optional; for tenants who want real-time stream processing |

The collector is configured with an ordered list of sinks. Each document is written to all sinks. If a sink fails, it does not block the others; the failed-sink count is exported as a Prometheus metric. A circuit breaker (per sink, 5-failure threshold, 60-second recovery window) prevents a slow downstream from blocking the ingest path.

### Statelessness

The collector is designed to be horizontally scalable and stateless with respect to documents. All state (session tokens, idempotency keys) lives in Redis. The collector pods can be scaled, restarted, or replaced without data loss. This is enforced by the Kubernetes deployment spec (`replicas: 2` minimum, no `PodAffinity` on the document path).

## Consequences
- The stateless design means session tokens in Redis are a single point of failure. Redis must be deployed in HA mode (Redis Sentinel or Cluster). This is a Phase 1 infrastructure decision.
- Partial batch acceptance (some events accepted, some rejected) means the SDK's offline buffer may re-queue rejected events. The SDK distinguishes `4xx` (permanent rejection, discard) from `5xx` (transient, retry). A malformed event (schema violation) returns `400` and is not retried.
- The circuit breaker means a sustained Logstash outage will stop documents from reaching Elasticsearch but not stop the collector from accepting them (S3 WORM continues to receive everything). The S3 WORM is therefore the audit log of record.
- The `dev-bypass` HMAC value accepted in the development docker-compose profile (Lab 4) must be gated behind an env var check (`NODE_ENV !== 'production'`). A CI check verifies this gate is present.

## Alternatives considered
- **SDK writes directly to Elasticsearch** — rejected; exposes Elasticsearch credentials to the device; bypasses PII redaction; requires ES to be publicly accessible.
- **SDK writes to Logstash directly** — rejected; Logstash has no authentication model suited to untrusted clients; adds TLS complexity to a log aggregator that should sit inside the trust boundary.
- **Single sink only (Logstash)** — rejected; the S3 WORM sink is the audit log of record and must be independent of the primary pipeline.
- **Stateful collector with local document buffer** — rejected; prevents horizontal scaling and complicates the Kubernetes deployment.

## Links
- ADR-0003 (HMAC envelope — session key management)
- ADR-0006 (ECS field mapping — what the collector validates and redacts)
- ADR-0008 (ILM — downstream of Logstash sink)
- ADR-0009 (mTLS certificate signing — collector CA)
- `packages/collector/src/`
- `packages/collector/docker-compose.yml`
