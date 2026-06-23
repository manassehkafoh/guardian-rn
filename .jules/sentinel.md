
## 2024-06-23 - Prevent Hardcoded Passwords in Docker Compose Defaults
**Vulnerability:** Found hardcoded passwords (`changeme` for elasticsearch/logstash/kibana and `admin` for grafana) within the local `packages/collector/docker-compose.yml` file. While often used for dev, shipping these makes them an easy target for accidental production deployment without change.
**Learning:** Hardcoded default credentials in Docker compose files can be unintentionally exposed or persisted if a stack is deployed outside of local development without configuration changes.
**Prevention:** Never use hardcoded fallback passwords in compose files (e.g., avoiding `${VAR:-default}`). Always use strict variable requirements (e.g. `${ELASTIC_PASSWORD:?ELASTIC_PASSWORD is required}`) and provide an `.env.example` file so the deployer is forced to consciously choose and manage credentials.
