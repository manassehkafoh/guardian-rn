## 2024-07-13 - Hardcoded Credentials in Docker Compose

**Vulnerability:** Found hardcoded default credentials (`changeme`, `admin`) in `packages/collector/docker-compose.yml` for Elasticsearch, Logstash, Kibana, and Grafana. Additionally, there was a risk of variable expansion issues in the Elasticsearch healthcheck shell script command if environment variables were not escaped properly.

**Learning:** When defining inline shell commands in `docker-compose.yml` (e.g., within `healthcheck` blocks) that require interpolating environment variables, we must use a double dollar sign (e.g., `$${VARIABLE}`) to prevent `docker-compose` from interpreting it early. Ensure the referenced variable is one that actually exists within the container's environment (e.g., `$${ELASTIC_PASSWORD}`), not the host-level variable used to inject it. This ensures the literal string `$VARIABLE` is passed to and evaluated correctly by the container's shell.

**Prevention:** Never use hardcoded default passwords or fallback defaults (e.g., `${VAR:-default}`) in Docker Compose configurations. Require explicit environment variables and provide a `.env.example` file to guide secure deployment.
