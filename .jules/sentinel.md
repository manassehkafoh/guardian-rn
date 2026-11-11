## 2024-11-11 - Hardcoded Passwords in Docker Compose
**Vulnerability:** Found hardcoded passwords (`changeme`, `admin`) in `packages/collector/docker-compose.yml` for Elasticsearch, Kibana, Logstash, and Grafana.
**Learning:** Hardcoded default passwords in infrastructure configuration files expose services to unauthorized access.
**Prevention:** Use strictly enforced environment variables (e.g., `${VAR:?Error}`) for secrets in `docker-compose.yml`, escape variables in shell healthchecks with `$${VAR}`, and document required variables in a `.env.example` file.
