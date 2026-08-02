## 2024-05-24 - Default passwords in docker-compose
**Vulnerability:** Default passwords like "changeme" for Elasticsearch and "admin" for Grafana in docker-compose.yml.
**Learning:** Hardcoded passwords in Docker compose files, especially for standard infrastructure components (Elasticsearch, Grafana), expose the environment if deployed as-is in upper environments without override mechanisms in place.
**Prevention:** Use environment variables (e.g., `${ELASTIC_PASSWORD:-changeme}`) or mandatory `.env` files for secrets to enforce secure configuration during deployment.
