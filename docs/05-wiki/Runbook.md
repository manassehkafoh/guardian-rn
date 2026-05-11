---
title: Runbook
owner: sre
audience: how-to
last_reviewed: 2026-05-10
---

# Runbook — On-Call Operations for `guardian-rn`

> **Audience:** the engineer paged at 02:00. Goal: resolve, not learn. If you find yourself reading this for understanding instead of action, switch to [`Architecture-Overview`](Architecture-Overview.md) tomorrow.

## 0. First 5 Minutes

1. **Acknowledge the page** in PagerDuty. Set a 15-minute timer.
2. **Open the war-room channel** `#guardian-incident` (auto-created by the PD integration).
3. **Open D-6 SLO & Pipeline Health** dashboard. If it's red, you have a pipeline problem; if green, you have a tenant-specific or detection problem.
4. **Declare a SEV** (see §1). Update the channel topic with `SEV-X — <one-line summary>`.
5. **Start the incident timeline** (`/incident timeline` slash command).

If at any point you are unsure: **escalate**. The handoff from on-call to incident commander is not a failure; not handing off is.

---

## 1. SEV definitions

| SEV | Definition | Examples | Response |
|---|---|---|---|
| **SEV-1** | Customer-impacting outage; data loss possible; security breach. | Collector down for any tenant > 5 min. HMAC verification failures > 0. Erasure endpoint failing. | Page Tech Lead + Security Advisor immediately. War room until resolved. Postmortem within 5 days. |
| **SEV-2** | Significant degradation; SLO at risk. | Ingest p99 > 200 ms for 30 min. ES cluster yellow. Reporting worker missed delivery. | Page primary + secondary. Aim to resolve in shift. Postmortem within 7 days. |
| **SEV-3** | Single-tenant or single-feature degraded; no data risk. | One tenant's dashboard slow. Alert flapping. | Within-shift handling. No postmortem unless recurring. |
| **SEV-4** | Cosmetic or low-priority issue. | Doc broken link. Dashboard label wrong. | Ticket, fix in next sprint. |

---

## 2. Common Alerts → Actions

### A-1 Critical-threat spike (per tenant)

**Page condition:** `guardian.severity:critical` rate > 3× the 7-day median over 15 min for a single tenant.

**Likely causes:**
1. Real attack on the customer.
2. Customer rolled out a new app version that triggers FPs.
3. Detector tuning regression in a recent SDK release.

**Actions:**
1. Check D-1 → filter by `tenantId`. Note `service.version` distribution.
2. If a single SDK version dominates → suspect FP regression. Cross-reference D-3 (FP rate per version).
3. Notify the tenant's CSM (auto-paged). Do **not** contact the customer directly without CSM coord.
4. If real attack confirmed via evidence patterns: page Security Advisor; tenant decides on response (kill switch, forced re-auth via app server).

### A-2 Engine emit-rate dropout

**Page condition:** A tenant that normally emits ≥ 1 event/min has emitted 0 for 30 min.

**Likely causes:**
1. Customer disabled telemetry adapter (verify in their config repo if accessible).
2. Cert rotation broke their mTLS chain.
3. Their app saw a major outage on their side and nobody is using it.

**Actions:**
1. Check D-2 — is the tenant's SDK version still seen on health pings?
2. Check the collector logs for that tenant's API key — are 401/403 errors trending?
3. Reach out via CSM with a "we observed" message. Don't assume malice or panic.

### A-3 HMAC verification failures

**Page condition:** Any non-zero count over 5 min. **Always SEV-1.**

**Likely causes:**
1. SDK bug in the canonical-JSON serialiser.
2. Active attacker tampering with the bridge.
3. Clock-skew + TLS-MITM combination (rare).

**Actions:**
1. Capture the offending event(s) from `guardian.envelope.verified:false`. Pull `device.id`, `service.version`, geo.
2. If concentrated in one SDK version → likely a regression. Roll back the version on npm `next` tag, advise tenants to pin previous.
3. If spread across versions and concentrated in one tenant → likely real attack. Coordinate with tenant's security team via established channels.
4. Post the captured envelopes (redacted) into the war room for forensic review.

### A-4 Sequence gap rate

**Page condition:** > 0.1% of events show a gap.

**Likely causes:**
1. Network-induced drops (offline buffer exhausted).
2. SDK crash mid-session.
3. Load shedding at the collector.

**Actions:**
1. Cross-reference with collector 5xx rate (D-6).
2. Check device-side: is `dropped` counter growing? (Adapter ships its own counters.)
3. If correlated with collector 5xx → scale collector / fix root cause.
4. If pure device-side → investigate offline-buffer behaviour; may need SDK-side fix.

### A-5 Collector ingest p99 > 200 ms

**Page condition:** sustained for 5 min.

**Likely causes:**
1. ES write pressure (check D-6).
2. Logstash queue backed up.
3. Collector pod CPU saturated.

**Actions:**
1. Check `kubectl top pods -n guardian`. Scale horizontally if CPU pinned.
2. Check ES `_cluster/health` — yellow/red? Hot-warm balance?
3. Check Logstash queue: `pipeline.workers` saturated?
4. If sink is at fault → flip the affected sink to circuit-break (config-driven), serve clients fast, replay later from S3 audit.

### A-6 ES cluster yellow/red

**SEV-1 if red, SEV-2 if yellow.**

Standard ES playbook applies. Common causes here:

- ILM rollover stuck — check `GET _ilm/explain`.
- Disk watermark crossed on a hot node — add capacity or accelerate rollover.
- Replica failure on snapshot repository — re-mount snapshot bucket.

### W-1 Compromise pattern (`privilegedAccess` + `hooks` within 60s, same sessionId)

**SEV-2; auto-routed to tenant-CSIRT email by ElastAlert.**

Actions:
1. Verify the rule fired correctly (W-1 has historically fired on emulator-only test devices — check `host.os` labels).
2. Notify CSM if customer doesn't already have CSIRT integration.
3. Capture evidence into the case management system (the rule writes a case automatically; verify it has all the related events).

### W-2 New evidence signature

**SEV-3; routed to research mailbox.**

Actions:
1. Confirm the signature is genuinely new (D-5).
2. File a research ticket with the evidence.
3. Trigger a threat-feed update if confirmed malicious; otherwise add to the FP exclusion list in the next release.

---

## 3. Standard Diagnostic Toolkit

### 3.1 Collector

```bash
# Logs (last 30 min, errors only)
kubectl logs -n guardian -l app=collector --since=30m | grep -E '"level":"(error|warn)"'

# Per-tenant ingest counters
curl -s https://collect.example.com/metrics | grep guardian_ingest_total

# Force-rotate certs (if compromise suspected)
kubectl rollout restart -n guardian deployment/collector
```

### 3.2 Elasticsearch

```bash
# Cluster health
curl -s -u "$ES_USER:$ES_PASS" "$ES_HOST/_cluster/health?pretty"

# Hot/warm shard distribution
curl -s -u "$ES_USER:$ES_PASS" "$ES_HOST/_cat/shards/logs-guardian.threat-*?v"

# Stuck ILM
curl -s -u "$ES_USER:$ES_PASS" "$ES_HOST/logs-guardian.threat-*/_ilm/explain"

# Force rollover (last resort)
curl -X POST -u "$ES_USER:$ES_PASS" "$ES_HOST/logs-guardian.threat-acme/_rollover"
```

### 3.3 Grafana

- Admin URL in 1Password (`Grafana / Admin (prod)`).
- If Grafana is down: dashboards are JSON in `dashboards/`; you can render via `grafana-cli` against a local Grafana for sanity checks.

### 3.4 Reporting worker

```bash
# Re-run a missed digest manually
kubectl exec -n guardian deployment/reporting -- node bin/reporting.js \
  --tenant=acme-banking --since=2026-05-03 --until=2026-05-10 --dry-run
# Drop --dry-run when ready.
```

---

## 4. Out-of-Band Handoff

If the incident lasts > 4 hours or shift-changes during it:

1. Update the timeline with current state, hypothesis, what's been tried, what hasn't.
2. Brief the incoming on-call live (15-minute call, no exceptions).
3. Hand the IC role explicitly with a Slack message: `IC handoff: <old-handle> → <new-handle> at <UTC time>`.
4. Old IC stays available for 1 hour for context questions, then off-shift.

---

## 5. After-Action

- **Postmortem** within the SEV-defined window. Use the template in [`Incident-Response`](Incident-Response.md).
- **Action items** filed in the tracker with owners and due dates. Followups appear in the next sprint.
- **Runbook updates** — if you ran into a step that this doc didn't cover, *update this doc in the same week*. Future-you will thank you.

---

## 6. Things this runbook explicitly does NOT cover

- Customer-side issues that aren't surfaced via collector telemetry — those are CSM territory.
- SDK debugging on a customer device — see `HowTo-Capture-A-Device-Trace` (link TBD; lab P5).
- Hiring, comp, performance — wrong document.

---

**Owner:** SRE | **Last reviewed:** 2026-05-10 | **Review cadence:** quarterly + after every SEV-1/2
