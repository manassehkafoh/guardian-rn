## 2024-10-27 - Hardcoded Infrastructure Credentials
**Vulnerability:** Hardcoded credentials (elastic, grafana) in docker-compose.yml
**Learning:** Infrastructure configuration files often contain default secrets that get deployed to production if not explicitly managed.
**Prevention:** Always enforce strict environment variable injection (e.g., ${VAR:?Error}) for all secrets in docker-compose and provide a .env.example.
