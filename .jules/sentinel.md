## 2024-05-24 - Hardcoded Secrets in Infrastructure Config
**Vulnerability:** Hardcoded default passwords ('changeme', 'admin') for Elasticsearch and Grafana in docker-compose.yml.
**Learning:** Infrastructure configuration files (like docker-compose.yml) are sometimes checked in with default passwords for convenience, risking deployment to production with insecure defaults.
**Prevention:** Enforce environment variables without hardcoded defaults (e.g. ${VAR:?Error}) in docker-compose files and document requirements in a .env.example file.
