## 2024-10-30 - Hardcoded Secrets in Docker Compose
**Vulnerability:** Hardcoded credentials (elastic/changeme, admin/admin) were used in docker-compose.yml
**Learning:** For ease of development, default secrets were committed, putting any deployed environments at risk of using these known insecure credentials.
**Prevention:** Always use environment variables in docker-compose for secrets and enforce their presence (e.g., ${VAR:?Error}) without hardcoded fallbacks. Document required variables in .env.example.
