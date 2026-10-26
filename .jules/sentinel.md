## 2024-05-24 - Hardcoded Secrets in Docker Compose
**Vulnerability:** Found hardcoded credentials (`changeme` for Elasticsearch, `admin` for Grafana) in `packages/collector/docker-compose.yml`.
**Learning:** Hardcoded credentials in infrastructure configuration files can easily lead to compromised environments if used beyond local development or accidentally exposed.
**Prevention:** Use environment variables for secrets in `docker-compose.yml` with strict enforcement (`${VAR:?Error message}`) and provide a `.env.example` template for developers.
