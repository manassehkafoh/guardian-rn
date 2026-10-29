## 2024-10-29 - [Fix hardcoded infrastructure secrets in docker-compose.yml]
**Vulnerability:** Hardcoded credentials (`changeme`, `admin`) were present in `packages/collector/docker-compose.yml` for Elasticsearch, Logstash, Kibana, and Grafana.
**Learning:** Hardcoded default secrets in infrastructure configurations (like `docker-compose.yml`) often persist into production deployments, providing trivial unauthorized access to the logging and monitoring stack, which can contain sensitive telemetry or operational data.
**Prevention:** Always use environment variable substitution with strict requirement flags (e.g., `${VAR:?Error message}`) in infrastructure configuration files and document the required secrets in an `.env.example` file.
