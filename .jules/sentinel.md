## 2024-07-05 - Hardcoded Credentials in Docker Compose

**Vulnerability:** Hardcoded passwords (`changeme`, `admin`) found in `packages/collector/docker-compose.yml` for Elasticsearch, Kibana, Logstash, and Grafana.
**Learning:** Hardcoded credentials in source control can easily be deployed to production if not explicitly overridden. Using environment variables is essential. When defining inline shell commands in `docker-compose.yml` (e.g., within `healthcheck` blocks) that require interpolating environment variables, use a double dollar sign (e.g., `$${VARIABLE}`) to prevent `docker-compose` from interpreting it early.
**Prevention:** Always use environment variables (e.g. `${VAR}`) for secrets in `docker-compose.yml` and provide a `.env.example` file.
