## 2024-11-06 - Hardcoded Secrets in Infrastructure Config
**Vulnerability:** Hardcoded default passwords in docker-compose.yml
**Learning:** Infrastructure-as-code must follow the same secret management principles as application code to prevent data pipeline compromise.
**Prevention:** Use strictly enforced environment variables (e.g. `${VAR:?Error}`) and document requirements in `.env.example`.
