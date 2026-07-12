## 2026-07-12 - Remove Hardcoded Secrets from Docker Compose
**Vulnerability:** Hardcoded credentials (like `changeme` and `admin`) were found in `packages/collector/docker-compose.yml`.
**Learning:** Hardcoding credentials in configuration files exposes sensitive information and violates security best practices.
**Prevention:** Use environment variables (e.g., `${ELASTIC_PASSWORD}`) for configuration values and provide a `.env.example` file to guide secure deployments. When defining inline shell commands in `docker-compose.yml` (e.g., within `healthcheck` blocks) that require interpolating environment variables, use a double dollar sign (e.g., `$${ELASTIC_PASSWORD}`) to prevent early interpolation by `docker-compose`. Ensure the referenced variable exists in the container's environment.
