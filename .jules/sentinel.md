## 2026-07-24 - Remove hardcoded default passwords in Docker Compose

**Vulnerability:** The `docker-compose.yml` file for the `@guardian/collector` package contained hardcoded default passwords for Elasticsearch (`ELASTIC_PASSWORD=changeme`, `ELASTICSEARCH_PASSWORD=changeme`) and Grafana (`GF_SECURITY_ADMIN_PASSWORD=admin`). Hardcoded secrets can lead to unauthorized access in local, testing, or production environments if accidentally deployed, and violate secure-by-default practices.

**Learning:** When defining inline shell commands in `docker-compose.yml` (e.g., within `healthcheck` blocks) that require interpolating environment variables, a double dollar sign (e.g., `$${ELASTIC_PASSWORD}`) must be used to prevent `docker-compose` from interpreting it early. Ensure the referenced variable is one that actually exists within the container's environment, so the literal string is passed to and evaluated correctly by the container's shell.

**Prevention:** Never use hardcoded default passwords in Docker Compose configurations. Require explicit environment variables (e.g., `${ELASTIC_PASSWORD}`) and provide a `.env.example` file to guide secure deployment and prevent out-of-the-box authentication failures.
