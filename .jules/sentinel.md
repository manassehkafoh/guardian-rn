## 2024-05-17 - Remove hardcoded passwords in docker-compose.yml
**Vulnerability:** Hardcoded credentials (e.g. `ELASTIC_PASSWORD=changeme`, `GF_SECURITY_ADMIN_PASSWORD=admin`) found in `packages/collector/docker-compose.yml`.
**Learning:** Hardcoding credentials in Docker Compose files (or any source code) leads to exposing secrets directly in the repository. Also, inline shell commands in `healthcheck` that interpolate environment variables need `$$` (e.g. `$${ELASTIC_PASSWORD}`) so docker-compose doesn't interpolate it prematurely.
**Prevention:** Never use hardcoded passwords or default variables (like `${VAR:-default}`). Extract secrets into environment variables, configure the `.env.example` file to declare them, and use the `.env` file correctly in the deployment environments.
