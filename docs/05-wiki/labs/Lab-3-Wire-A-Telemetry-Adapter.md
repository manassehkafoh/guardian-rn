---
title: "Lab 3 – Wire a Telemetry Adapter"
type: tutorial
audience: sdk-engineer
duration: 75 min
prerequisites: Lab 1 complete; Lab 4 collector stack running locally (or a team staging collector URL)
last_reviewed: 2026-05-10
---

# Lab 3 – Wire a Telemetry Adapter

> **Goal:** configure `@guardian/telemetry-elastic` in the example app so that threat events are batched, HMAC-signed, and delivered to the collector — then confirm they appear as documents in Kibana and as a data point in Grafana.

If you do not yet have a local collector, complete [Lab 4 – Run the Collector Locally](Lab-4-Run-The-Collector-Locally.md) first and come back. The collector URL you need is `http://localhost:4200`.

---

## Step 1 — Install the telemetry adapter

```bash
npm install @guardian/telemetry-elastic --workspace=apps/example
```

Expected output:

```
added 1 package
```

The adapter has zero transitive dependencies beyond `@guardian/rn`.

---

## Step 2 — Create a collector config file

Create `apps/example/src/collectorConfig.ts`:

```typescript
import { ElasticTelemetryConfig } from '@guardian/telemetry-elastic';

export const collectorConfig: ElasticTelemetryConfig = {
  collectorUrl: 'http://localhost:4200/ingest',
  apiKey: 'dev-api-key-change-me-in-prod',
  batchSize: 50,
  flushIntervalMs: 5_000,
  maxPayloadBytes: 256 * 1024,
  offlineBufferDays: 7,
};
```

> **Security note:** `apiKey` must never be a plain string in production builds. Use a secrets manager (e.g., Android Keystore–backed fetch or iOS Keychain) to deliver the key at runtime. The `dev-api-key-change-me-in-prod` value is accepted by the local collector's dev auth middleware only.

---

## Step 3 — Wire the adapter into the app

Open `apps/example/src/App.tsx`. Import and configure the adapter:

```typescript
import { ElasticTelemetryAdapter } from '@guardian/telemetry-elastic';
import { collectorConfig } from './collectorConfig';

// Create the adapter once at module scope (not inside the component)
const telemetry = new ElasticTelemetryAdapter(collectorConfig);
```

Pass it to `useGuardian`:

```typescript
const guardian = useGuardian({
  engine: communityEngine(),
  telemetry,          // ← add this line
  actions: {
    // ... your existing action handlers
  },
});
```

Save and allow Metro to hot-reload.

---

## Step 4 — Run the unit test for the adapter

The adapter ships with an integration test harness. Run it against the local collector:

```bash
COLLECTOR_URL=http://localhost:4200 \
  npm test --workspace=packages/telemetry-elastic -- --testPathPattern=integration
```

Expected output:

```
PASS  src/__tests__/integration/delivery.test.ts
  ✓ batches 50 events and flushes (1234 ms)
  ✓ flushes on 5 s interval with < 50 events (5043 ms)
  ✓ retries on 503 with exponential backoff (3211 ms)
  ✓ persists to SQLite offline buffer on network failure (892 ms)
  ✓ drains offline buffer on reconnect (1102 ms)
```

If you see `ECONNREFUSED`, the collector is not running. Go to Lab 4 first.

---

## Step 5 — Trigger a threat in the simulator

With the example app running (Metro + simulator from Lab 1), tap **"Start Guardian"** and then **"Simulate Threat → debugger"**.

In the Metro console you should see:

```
[guardian] threat: debugger
[telemetry] batch queued — 1/50 events
```

Wait 5 seconds for the flush interval, or tap the button 49 more times to trigger an immediate flush. You will then see:

```
[telemetry] flush — 1 event(s) → http://localhost:4200/ingest — 200 OK
[telemetry] batchId: 3f9a2b... committed
```

---

## Step 6 — Verify the event in Kibana

Open Kibana at `http://localhost:5601`. Log in with `elastic` / `changeme`.

1. Navigate to **Discover**.
2. Select the index pattern `logs-guardian.threat-*`.
3. Set the time filter to **Last 15 minutes**.
4. You should see one document. Click it to expand.

Confirm the following ECS fields are present:

| Field | Expected value |
|---|---|
| `event.kind` | `event` |
| `event.category` | `authentication` |
| `guardian.threatId` | `debugger` |
| `guardian.severity` | `high` |
| `guardian.envelope.verified` | `true` |
| `service.name` | `guardian-rn` |
| `host.os.name` | `Android` or `iOS` |

If `guardian.envelope.verified` is `false`, the HMAC check failed — check that the collector's session-key exchange is working (see [Runbook A-3](../Runbook.md#a-3-hmac-verification-failures)).

---

## Step 7 — Verify the event in Grafana

Open Grafana at `http://localhost:3000`. Log in with `admin` / `admin`.

1. Open the **D-1 Threat Heatmap** dashboard.
2. The `debugger` cell in the heatmap should show a count of 1 (or however many times you tapped).
3. Open **D-2 Engine Health** and confirm the `AllChecksFinished` heartbeat is ticking.

---

## Step 8 — Test offline buffering

This step simulates a device losing connectivity mid-session.

1. In the simulator, enable **Airplane Mode** (iOS: Device → Network Conditions → Offline; Android: emulator extended controls → Cellular → No network).
2. Tap **"Simulate Threat → hooks"** three times.
3. In the Metro console:

```
[telemetry] flush — 3 event(s) → ... — ECONNREFUSED
[telemetry] offline buffer: +3 events (total: 3, capacity: 7-day)
```

4. Re-enable network.
5. Within the next flush interval (≤ 5s) you will see:

```
[telemetry] draining offline buffer — 3 event(s)
[telemetry] flush — 3 event(s) → ... — 200 OK
```

6. Confirm all three `hooks` events appear in Kibana Discover.

---

## You should now understand

- The telemetry adapter is configured once at module scope and injected into `useGuardian` — not recreated per render.
- The adapter batches by count (50), time (5 s), and size (256 KB), whichever triggers first.
- Events that cannot be delivered are persisted to a SQLite offline buffer for up to 7 days and drained automatically on reconnect.
- `guardian.envelope.verified: true` in Kibana is the proof that the HMAC integrity check passed all the way through the collector.
- The Grafana Threat Heatmap (D-1) is the primary operational view of what your telemetry adapter is shipping.

---

**Next lab:** [Lab 4 – Run the Collector Locally](Lab-4-Run-The-Collector-Locally.md) — stand up the full docker-compose stack so you have a local collector to target.
