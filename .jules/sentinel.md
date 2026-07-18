## 2024-05-15 - Hardcoded Credentials in Docker Compose

**Vulnerability:** Found hardcoded passwords (`ELASTIC_PASSWORD=changeme`, `ELASTICSEARCH_PASSWORD=changeme`, `GF_SECURITY_ADMIN_PASSWORD=admin`) directly in the `docker-compose.yml` file.

**Learning:** Hardcoded credentials in Docker Compose files can be accidentally committed and expose default or production secrets. For inline shell commands in `docker-compose.yml` (like healthchecks) that need to evaluate variables inside the container, we must use a double dollar sign (`$${VARIABLE}`) so docker-compose doesn't expand it early using the host environment.

**Prevention:** Never use hardcoded default passwords or fallback defaults (e.g., `${VAR:-default}`) in Docker Compose configurations. Require explicit environment variables and provide a `.env.example` file to guide secure deployment.
