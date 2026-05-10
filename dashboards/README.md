# Grafana Dashboards

All dashboards are managed as code (ADR-0010). JSON files here are deployed to Grafana by CI on merge to `main`.

| File | Dashboard ID | Description |
|---|---|---|
| `d1-threat-heatmap.json` | D-1 | Threat heatmap by type × severity × time |
| `d2-engine-health.json` | D-2 | Engine heartbeat and health ticks per engine |
| `d3-fp-triage.json` | D-3 | False-positive rate, confidence histogram, evidence co-occurrence |
| `d4-per-customer-drilldown.json` | D-4 | Per-tenant threat timeline and policy breakdown |
| `d5-bypass-tool-watch.json` | D-5 | Cross-tenant bypass-tool signature tracking |
| `d6-slo-pipeline-health.json` | D-6 | SLO error budget, ingest p99, ILM health |

Dashboard JSON files are added in Phase 5.5 (observability phase). Stubs will be committed once the Elasticsearch data source is wired.

## Deployment

CI runs on merge to `main`:

```yaml
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
