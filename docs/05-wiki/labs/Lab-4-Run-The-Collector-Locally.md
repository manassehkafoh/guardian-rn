---
title: "Lab 4 – Run the Collector Locally"
type: tutorial
audience: backend-engineer, sre
duration: 45 min
prerequisites: Docker Desktop ≥ 24 running; 8 GB RAM available; ports 4200, 5601, 3000, 9200 free
last_reviewed: 2026-05-10
---

# Lab 4 – Run the Collector Locally

> **Goal:** start the full `guardian-rn` observability stack — collector, Elasticsearch, Logstash, Kibana, and Grafana — using `docker compose`, ingest a synthetic event through the API, and confirm it flows end-to-end to both Kibana and Grafana.

This lab gives every engineer a local version of production that they can break without consequences. It is a dependency for Lab 3 (wiring the SDK adapter) and Lab 7 (adding a Grafana panel).

---

## Step 1 — Check port availability

```bash
for port in 4200 5601 3000 9200 5044; do
  lsof -i ":$port" | grep LISTEN && echo "PORT $port IN USE — free it first" || echo "port $port OK"
done
```

All five lines should print `port NNNN OK`. If any are in use, stop the conflicting process before continuing.

---

## Step 2 — Start the stack

The compose file lives in `packages/collector/`:

```bash
cd packages/collector
docker compose up -d
```

Expected output (order may vary):

```
[+] Running 6/6
 ✔ Network collector_guardian  Created
 ✔ Container elasticsearch     Started
 ✔ Container logstash          Started
 ✔ Container kibana            Started
 ✔ Container grafana           Started
 ✔ Container collector         Started
```

---

## Step 3 — Wait for Elasticsearch to be ready

Elasticsearch takes 30–60 seconds to initialise. Poll until healthy:

```bash
until curl -s -o /dev/null -w "%{http_code}" http://localhost:9200/_cluster/health | grep -q "200"; do
  echo "waiting for ES…"; sleep 5
done
echo "Elasticsearch ready"
```

---

## Step 4 — Verify each service

Run each check in order:

### Collector health

```bash
curl -s http://localhost:4200/health | jq .
```

Expected:

```json
{ "status": "ok", "version": "1.0.0", "uptime": 12 }
```

### Elasticsearch cluster health

```bash
curl -s -u elastic:changeme http://localhost:9200/_cluster/health | jq .status
```

Expected: `"green"` (may briefly show `"yellow"` while shards initialise — wait 30s and retry).

### Kibana

```bash
curl -s http://localhost:5601/api/status | jq .status.overall.level
```

Expected: `"available"`

### Grafana

```bash
curl -s http://localhost:3000/api/health | jq .database
```

Expected: `"ok"`

---

## Step 5 — Seed the Kibana index pattern and Grafana dashboards

The `seed` script runs once to create the ILM policy, index template, Kibana data view, and import all Grafana dashboard JSON files:

```bash
docker compose exec collector npm run seed
```

Expected output:

```
[seed] ILM policy       → logs-guardian-policy   ✓
[seed] index template   → logs-guardian.threat-* ✓
[seed] Kibana data view → logs-guardian.threat-* ✓
[seed] Grafana dashboard D-1 Threat Heatmap       ✓
[seed] Grafana dashboard D-2 Engine Health        ✓
[seed] Grafana dashboard D-3 FP Triage            ✓
[seed] Grafana dashboard D-4 Per-Customer Drilldown ✓
[seed] Grafana dashboard D-5 Bypass-Tool Watch    ✓
[seed] Grafana dashboard D-6 SLO & Pipeline Health ✓
[seed] done
```

---

## Step 6 — Ingest a synthetic event

The collector exposes a dev-only `POST /ingest/debug` endpoint that accepts a raw JSON event without mTLS (disabled in the compose dev profile). Use it to inject a test document:

```bash
curl -s -X POST http://localhost:4200/ingest/debug \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: dev-api-key-change-me-in-prod' \
  -d '{
    "batchId": "lab4-test-001",
    "tenantId": "lab-tenant",
    "events": [{
      "seq": 1,
      "sessionId": "lab4-session",
      "hmac": "dev-bypass",
      "payload": {
        "threatId": "debugger",
        "severity": "high",
        "evidence": { "source": "lab4-synthetic" },
        "ts": '"$(date +%s%3N)"'
      }
    }]
  }' | jq .
```

Expected response:

```json
{ "accepted": 1, "rejected": 0, "batchId": "lab4-test-001" }
```

> The `hmac: "dev-bypass"` value is accepted only by the local dev profile. In staging/production all envelopes must carry a valid HMAC-SHA256 value — the collector will reject anything else with a `400`.

---

## Step 7 — Confirm in Kibana Discover

1. Open `http://localhost:5601`.
2. Log in: `elastic` / `changeme`.
3. Go to **Discover → logs-guardian.threat-***.
4. Set time range to **Last 15 minutes**.
5. You should see one hit with `guardian.threatId: debugger`.

---

## Step 8 — Confirm in Grafana

1. Open `http://localhost:3000`.
2. Log in: `admin` / `admin`.
3. Open **D-1 Threat Heatmap**. The `debugger` cell shows count 1.
4. Open **D-6 SLO & Pipeline Health**. Ingest pipeline shows green; p99 latency should be well under 200 ms for a single event.

---

## Step 9 — Explore the Logstash pipeline

Logstash sits between the collector and Elasticsearch. Inspect the pipeline config that the compose stack mounts:

```bash
cat packages/collector/logstash/pipeline/guardian.conf
```

Key sections to note:

- **`filter { mutate }`** — flattens the `guardian.*` namespace onto ECS fields.
- **`filter { ruby }`** — validates `guardian.envelope.verified` before allowing the document through.
- **`output { elasticsearch }`** — writes to the data-stream `logs-guardian.threat-<tenantId>`.

---

## Tear-down

When you are done:

```bash
docker compose down -v
```

The `-v` flag removes the named volumes (Elasticsearch data, Grafana state). Omit `-v` if you want to keep your data between sessions.

---

## You should now understand

- The five services in the stack and how they are wired: collector → Logstash pipeline → Elasticsearch data-stream → Kibana / Grafana.
- The ILM policy is applied at index-template level, not per-index, so every new tenant index inherits the hot→warm→cold→delete lifecycle automatically.
- The `seed` script is idempotent — you can re-run it safely after a `docker compose down -v` to restore the Kibana and Grafana configuration.
- `guardian.envelope.verified` is enforced in the Logstash pipeline, not just in the collector — this is a defence-in-depth measure.
- The dev profile disables mTLS and accepts `dev-bypass` HMAC values. These guards are active in staging and production — the exact same collector image, different env vars.

---

**Next lab:** [Lab 5 – Build a Custom Engine](Lab-5-Build-A-Custom-Engine.md) — implement the `Engine` interface and register a custom detector that runs alongside the community engine.
