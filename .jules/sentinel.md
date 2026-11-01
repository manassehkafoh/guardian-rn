## 2026-11-01 - Prevent hardcoded secrets in docker-compose
**Vulnerability:** Found hardcoded passwords 'changeme' and 'admin' for ElasticSearch, Logstash, Kibana, and Grafana in docker-compose.yml.
**Learning:** Docker environments often default to insecure hardcoded secrets for convenience, violating secure secret management.
**Prevention:** Always use environment variables with the '${VAR:?Error message}' syntax to enforce secure secret injection.
