---
title: "Lab 6 – Trigger and Triage a False Positive"
type: tutorial
audience: detection-engineer
duration: 60 min
prerequisites: Lab 4 collector stack running; basic Kibana familiarity
last_reviewed: 2026-05-10
---

# Lab 6 – Trigger and Triage a False Positive

> **Goal:** inject a known false-positive scenario (a corporate MDM profile that looks like a hook to the community engine), locate it in Kibana, confirm it is a false positive using the D-3 FP Triage dashboard, and submit a confidence-threshold adjustment — all without shipping a new SDK version.

False positives (FPs) are the most damaging operational problem for any RASP product: a single mis-fired `lockout` or `kill` policy event causes a customer's end-users to lose access to the app. This lab builds the muscle memory for the triage workflow before you face a real one at 02:00.

---

## Background: how the community engine scores threats

The community engine emits a `confidence` field (0.0–1.0) on every `Evidence` object. The response-policy engine only escalates events whose confidence meets or exceeds the tenant's configured threshold:

| Policy | Default threshold |
|---|---|
| `telemetry` | 0.0 (log everything) |
| `restrict` | 0.70 |
| `lockout` | 0.85 |
| `kill` | 0.95 |

An FP is almost always a high-confidence event that the detector got wrong. Tuning means lowering the threshold for the affected threat type so the policy does not escalate it — without disabling detection entirely.

---

## Step 1 — Inject the false-positive scenario

The collector's `POST /ingest/debug` endpoint (from Lab 4) accepts a batch of synthetic events. Inject three events that simulate an MDM-managed device triggering the `hooks` detector:

```bash
for i in 1 2 3; do
curl -s -X POST http://localhost:4200/ingest/debug \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: dev-api-key-change-me-in-prod' \
  -d "{
    \"batchId\": \"lab6-fp-00$i\",
    \"tenantId\": \"lab-tenant\",
    \"events\": [{
      \"seq\": $i,
      \"sessionId\": \"lab6-session\",
      \"hmac\": \"dev-bypass\",
      \"payload\": {
        \"threatId\": \"hooks\",
        \"severity\": \"critical\",
        \"confidence\": 0.91,
        \"evidence\": {
          \"source\": \"community-engine\",
          \"hookFramework\": \"unknown\",
          \"deviceLabel\": \"MDM-managed-corp-device\",
          \"mdmProfile\": \"com.acme.corp.mdm\"
        },
        \"ts\": $(date +%s%3N)
      }
    }]
  }" | jq .
done
```

Expected response for each:

```json
{ "accepted": 1, "rejected": 0 }
```

---

## Step 2 — Observe the alert in Kibana

Open `http://localhost:5601 → Discover → logs-guardian.threat-*`. Set the time range to the last 15 minutes.

You will see three documents with:
- `guardian.threatId: hooks`
- `guardian.severity: critical`
- `guardian.confidence: 0.91`
- `guardian.evidence.mdmProfile: com.acme.corp.mdm`

The presence of `mdmProfile` in the evidence is a strong signal this is an FP — Frida and Xposed do not announce themselves.

---

## Step 3 — Open the FP Triage dashboard

Open Grafana at `http://localhost:3000`. Navigate to **D-3 FP Triage**.

This dashboard has four panels:

1. **FP rate per threat type** — shows `hooks` spiking for `lab-tenant`.
2. **Confidence histogram** — `hooks` events are clustered around 0.91, just above the `lockout` threshold.
3. **Evidence co-occurrence heatmap** — `mdmProfile` co-occurs with `hooks` in 100% of the new events; this is the FP fingerprint.
4. **SDK version breakdown** — all three events came from the same SDK version.

The confidence histogram is the key signal: a legitimate Frida injection typically scores 0.97–1.0. Events clustering at 0.91 with an MDM evidence field are a known FP pattern for corporate device fleets.

---

## Step 4 — Confirm via KQL query

In Kibana, use the following KQL to find all events from `lab-tenant` in the last 24 hours where `hooks` fired with MDM evidence:

```
guardian.tenantId: "lab-tenant"
  AND guardian.threatId: "hooks"
  AND guardian.evidence.mdmProfile: *
```

Save this search as **"Lab6 – MDM hooks FP"** (Saved Searches menu). You will reference it in the tuning ticket.

---

## Step 5 — Write a tuning ticket

In your issue tracker, file a ticket with the following fields:

**Title:** FP: `hooks` detector fires on MDM-managed devices (confidence 0.91)

**Description:**
```
Affected tenant: lab-tenant
Affected SDK version: community@1.0.0
Evidence fingerprint: guardian.evidence.mdmProfile present AND guardian.confidence < 0.93

Root cause hypothesis:
  The community engine's hook detector scans loaded libraries. MDM profiles inject a
  legitimate management agent that shares a syscall pattern with Xposed.

Proposed fix:
  Add an exclusion rule: if evidence.mdmProfile is present AND confidence < 0.93,
  reclassify to severity=low and cap confidence at 0.60 before policy evaluation.
  This keeps detection (logs the event) but prevents lockout/kill escalation.

Acceptance criteria:
  - Re-injecting the lab6 scenario scores confidence ≤ 0.60.
  - Policy engine does not escalate to `lockout`.
  - Genuine Frida events (from Lab 1 Simulate Threat) still score ≥ 0.97.
  - FP rate for `hooks` across known MDM tenants drops to < 0.1%.
```

---

## Step 6 — Apply the exclusion rule

Exclusion rules live in `packages/engine-community/src/exclusions/`. Create `mdm-hooks.exclusion.json`:

```json
{
  "id": "mdm-hooks-v1",
  "threatId": "hooks",
  "condition": {
    "evidenceFieldPresent": "mdmProfile",
    "confidenceBelow": 0.93
  },
  "action": {
    "capConfidence": 0.60,
    "overrideSeverity": "low"
  }
}
```

The community engine loads all `*.exclusion.json` files at startup. Restart the engine (Metro hot-reload is sufficient in dev).

---

## Step 7 — Verify the exclusion

Re-inject the same scenario from Step 1. This time, check the Kibana document:

```
guardian.confidence: 0.60    (was 0.91)
guardian.severity: "low"     (was "critical")
guardian.policy.escalated: false
guardian.exclusion.appliedRule: "mdm-hooks-v1"
```

The event is still logged (telemetry policy fires), but the `lockout` threshold (0.85) is not met. No user is locked out.

Now inject a genuine Frida event (from Lab 1 **"Simulate Threat → hooks"** — this scores 0.97):

```
guardian.confidence: 0.97
guardian.severity: "critical"
guardian.policy.escalated: true
guardian.exclusion.appliedRule: null
```

The exclusion rule correctly left the genuine threat unaffected.

---

## Step 8 — Commit the exclusion file

```bash
git add packages/engine-community/src/exclusions/mdm-hooks.exclusion.json
git commit -m "fix(engine): exclude MDM hook FP for managed corporate devices"
```

CI will run the FP regression suite (50 known-FP scenarios, 50 known-TP scenarios). Both must pass before the PR merges.

---

## Step 9 — Update the W-2 research ticket

From the [Runbook W-2 playbook](../Runbook.md#w-2-new-evidence-signature): once an exclusion is in place, the research ticket is updated with the fingerprint and closed as **"excluded, not malicious"**. Log this in your issue tracker and add the `mdmProfile` field to the FP exclusion reference list in `docs/known-fp-patterns.md`.

---

## You should now understand

- Confidence scoring is the lever between detection (log everything) and escalation (restrict/lockout/kill). Most FPs are tuned at this layer — not by disabling detection.
- The D-3 FP Triage dashboard's confidence histogram and evidence co-occurrence heatmap are the primary diagnostic tools for identifying FP patterns quickly.
- Exclusion rules are data — JSON files committed to the repo, tested in CI, not hardcoded logic. Adding one requires no SDK release.
- The triage workflow: observe alert → KQL query to confirm pattern → write ticket → apply exclusion → verify both FP and TP paths → commit.
- `guardian.exclusion.appliedRule` in the event document is the audit trail: operators can always see why an event was downgraded.

---

**Next lab:** [Lab 7 – Add a Grafana Dashboard Panel](Lab-7-Add-A-Grafana-Dashboard-Panel.md) — create a new panel in the D-3 dashboard that tracks the MDM exclusion rule hit rate, then commit the JSON and deploy via CI.
