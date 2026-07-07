## 2024-07-07 - Remove hardcoded passwords from Docker Compose

**Vulnerability:** Found hardcoded passwords (`changeme`, `admin`) in `packages/collector/docker-compose.yml` for services.
**Learning:** Hardcoded credentials in orchestration files can be easily committed to version control, leading to potential unauthorized access.
**Prevention:** Use environment variables for sensitive configuration and provide a `.env.example` file for secure deployment documentation.