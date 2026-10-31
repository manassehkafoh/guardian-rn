## 2024-05-24 - [Fix hardcoded secrets in docker-compose.yml]
**Vulnerability:** Found hardcoded passwords (`changeme` and `admin`) for Elasticsearch and Grafana in `packages/collector/docker-compose.yml`.
**Learning:** Hardcoded credentials in infrastructure configuration files expose critical services to unauthorized access.
**Prevention:** Use environment variables in docker-compose files and enforce their existence using the `${VAR:?Error message}` syntax, paired with a `.env.example` file to document the requirements.