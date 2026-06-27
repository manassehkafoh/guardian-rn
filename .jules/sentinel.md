## 2024-06-27 - Hardcoded Passwords in Docker Compose
**Vulnerability:** Hardcoded default passwords (`changeme` and `admin`) were found in `packages/collector/docker-compose.yml` for Elasticsearch and Grafana.
**Learning:** Even in development stacks, hardcoded credentials can easily leak into production environments if not explicitly parameterized, and default values violate security best practices.
**Prevention:** Always use explicit environment variables (e.g. `${ELASTIC_PASSWORD}`) for secrets in Docker Compose. Provide a `.env.example` file to guide secure deployment and ensure inline shell commands correctly escape interpolation (`$${VAR}`).
