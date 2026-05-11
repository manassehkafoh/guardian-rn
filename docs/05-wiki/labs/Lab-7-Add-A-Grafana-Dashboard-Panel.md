---
title: "Lab 7 – Add a Grafana Dashboard Panel"
type: tutorial
audience: sre, data-engineer
duration: 60 min
prerequisites: Lab 4 collector stack running; Lab 6 exclusion rule applied (for meaningful data)
last_reviewed: 2026-05-10
---

# Lab 7 – Add a Grafana Dashboard Panel

> **Goal:** add a new time-series panel to the **D-3 FP Triage** dashboard that tracks the rate at which the `mdm-hooks-v1` exclusion rule fires per tenant, export its JSON, commit it to `dashboards/d3-fp-triage.json`, and verify that CI re-deploys the dashboard automatically.

All Grafana dashboards in `guardian-rn` are managed as code — JSON files in `dashboards/`, deployed by CI on merge. This lab teaches you the workflow: design in the UI, export, commit, verify.

---

## Step 1 — Open the D-3 dashboard in edit mode

1. Open `http://localhost:3000`.
2. Log in: `admin` / `admin`.
3. Navigate to **Dashboards → D-3 FP Triage**.
4. Click the **Edit** button (pencil icon, top-right). The dashboard enters edit mode.

---

## Step 2 — Add a new panel

Click **Add → Visualisation** (top-right of the edit toolbar). A blank panel opens with the query editor.

---

## Step 3 — Configure the Elasticsearch data source

In the query editor:

1. **Data source:** `Elasticsearch (Guardian)`
2. **Index:** `logs-guardian.threat-*`
3. **Time field:** `@timestamp`

---

## Step 4 — Write the Elasticsearch query

Switch the query editor to **JSON mode** and paste:

```json
{
  "query": {
    "bool": {
      "must": [
        { "term": { "guardian.exclusion.appliedRule": "mdm-hooks-v1" } }
      ]
    }
  },
  "aggs": {
    "by_time": {
      "date_histogram": {
        "field": "@timestamp",
        "fixed_interval": "5m"
      },
      "aggs": {
        "by_tenant": {
          "terms": { "field": "guardian.tenantId", "size": 20 }
        }
      }
    }
  }
}
```

This aggregation produces a 5-minute bucket time series, broken down by `tenantId`.

---

## Step 5 — Configure the visualisation

In the panel settings on the right:

| Setting | Value |
|---|---|
| **Visualisation type** | Time series |
| **Title** | `MDM-hooks exclusion rule hits / 5 min` |
| **Legend** | `{{guardian.tenantId}}` |
| **Unit** | `Short (count)` |
| **Y-axis min** | `0` |
| **Fill opacity** | `10` |
| **Line width** | `2` |
| **Tooltip** | All series |

Add a **threshold** line at `y = 10` with colour red and label `"Investigate if sustained"`. This is not an alert (alerts are in ElastAlert), but a visual cue for the on-call engineer.

---

## Step 6 — Add a description annotation

In the panel editor, open the **Description** field and paste:

```
Rate of events matched by the MDM-hooks-v1 exclusion rule, per tenant, in 5-minute buckets.

A sustained rate > 10/5min for a single tenant that has not previously appeared here may
indicate a new MDM product or a new OS version that changes the library-scan signature.
File a research ticket per Runbook W-2.
```

---

## Step 7 — Preview with live data

Click **Apply** (top-right). The panel appears in the D-3 dashboard. If you completed Lab 6, you should see a small spike corresponding to the three synthetic events you injected.

Adjust the time range to **Last 1 hour** and confirm the panel refreshes correctly.

---

## Step 8 — Export the dashboard JSON

Grafana's dashboard-as-code workflow:

1. In D-3 edit mode, click the **Settings** icon (gear, top-right).
2. Go to **JSON Model**.
3. Click **Copy to Clipboard**.

Open a terminal and save to the correct path:

```bash
pbpaste > /path/to/guardian-rn/dashboards/d3-fp-triage.json
```

Or use the Grafana HTTP API (preferred for CI reproducibility):

```bash
curl -s -u admin:admin \
  "http://localhost:3000/api/dashboards/uid/d3-fp-triage" \
  | jq '.dashboard' \
  > dashboards/d3-fp-triage.json
```

---

## Step 9 — Validate the JSON diff

```bash
git diff dashboards/d3-fp-triage.json
```

You should see the new panel object added inside the `panels` array. Confirm:

- `"title": "MDM-hooks exclusion rule hits / 5 min"` is present.
- `"type": "timeseries"` is set.
- The Elasticsearch query from Step 4 is embedded correctly.
- No UIDs were accidentally regenerated (Grafana sometimes does this on export — fix by reverting any UID fields that differ from the original to avoid breaking existing links).

---

## Step 10 — Commit

```bash
git add dashboards/d3-fp-triage.json
git commit -m "feat(dashboards): add MDM-hooks exclusion hit-rate panel to D-3 FP Triage"
```

---

## Step 11 — Verify CI deployment

Push to a branch and open a PR. The CI pipeline runs the following check:

```yaml
# .github/workflows/dashboards.yml (excerpt)
- name: Deploy Grafana dashboards
  run: |
    for f in dashboards/*.json; do
      curl -s -X POST \
        -u "$GRAFANA_USER:$GRAFANA_PASS" \
        "$GRAFANA_URL/api/dashboards/import" \
        -H 'Content-Type: application/json' \
        -d "{\"dashboard\": $(cat $f), \"overwrite\": true, \"folderId\": 0}"
    done
```

After merge, the CI job deploys all dashboard JSON files to the staging Grafana instance. Navigate to D-3 in staging Grafana and confirm the new panel appears.

If CI fails with `409 Conflict`, a dashboard UID collision occurred during export — see the note in Step 9 about UID fields.

---

## Step 12 — Add a Grafana alert (optional extension)

If you want to go further, add a Grafana Alert rule that pages when the exclusion hit rate exceeds 10/5 min for 15 consecutive minutes:

1. Open the panel → **Edit** → **Alert** tab.
2. **Condition:** `WHEN last() OF query(A, 15m, now) IS ABOVE 10`.
3. **No data:** `OK` (silence if the tenant has no events — not an outage).
4. **Notification channel:** `PagerDuty (SEV-3)`.
5. Save. Export JSON again and update the commit.

The alert integrates with the ElastAlert W-2 rule from the runbook — together they give two independent signals for anomalous exclusion activity.

---

## You should now understand

- Grafana dashboards are code: JSON committed to `dashboards/`, deployed by CI, not hand-crafted per environment.
- The API export (`/api/dashboards/uid/...`) is preferred over copy-paste because it produces deterministic JSON without editor-state noise.
- Panel descriptions are operational documentation — they tell the on-call engineer what the panel shows and what action to take, without them having to find this lab at 02:00.
- UID stability matters: if you let Grafana regenerate UIDs, bookmarks and PagerDuty links break. Always diff the UID fields before committing.
- The threshold line (y = 10, red) is a visual SLO indicator, not an alert. Alerts live in ElastAlert (for Elasticsearch-side rules) or Grafana Alerting (for dashboard-side rules) — both are committed as code.

---

**You have completed all seven labs.** Return to the [Home wiki](../Home.md) for the next step on your learning path, or move to the [Onboarding Guide](../../07-onboarding-learning-guide.md) to see how these labs fit into the 90-day plan.
