## 2024-05-18 - Hardcoded Credentials in Docker Compose

**Vulnerability:** Hardcoded default passwords (`changeme`, `admin`) were discovered within `packages/collector/docker-compose.yml` for critical services like Elasticsearch, Logstash, Kibana, and Grafana.

**Learning:** Including hardcoded credentials directly in version control, particularly for infrastructure configuration, introduces severe security risks. When configurations are shared or deployed, these default passwords are often left unchanged in production or inadvertently expose environments. Furthermore, inline shell commands within Docker healthchecks need careful escaping (e.g., using `$${VARIABLE}`) to ensure the container evaluates the runtime environment variable correctly.

**Prevention:** Never use hardcoded secrets in `docker-compose.yml` or fallback defaults like `${VAR:-default}`. Extract all secrets to environment variables (e.g., `${ELASTIC_PASSWORD}`). Require explicit variable declarations and always provide a `.env.example` file to guide secure deployment setups out-of-the-box without exposing actual credentials. Ensure all unique variable names utilized across dependent services are represented in `.env.example`.
