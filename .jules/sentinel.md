## 2024-05-18 - Hardcoded Secrets in docker-compose.yml
**Vulnerability:** Hardcoded credentials (`ELASTIC_PASSWORD=changeme` and `GF_SECURITY_ADMIN_PASSWORD=admin`) were found in `packages/collector/docker-compose.yml`.
**Learning:** Docker Compose infrastructure setups often embed default passwords directly in the file, which can easily be accidentally deployed to production environments or copied, risking unauthorized access.
**Prevention:** Always use environment variables in infrastructure configuration files (e.g., `${ELASTIC_PASSWORD:?Error}`) and document required variables in an accompanying `.env.example` file.
