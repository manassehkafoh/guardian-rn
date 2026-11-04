## 2024-11-04 - Hardcoded Secrets in Infrastructure Config
**Vulnerability:** Hardcoded database and admin credentials (ELASTIC_PASSWORD, ELASTICSEARCH_PASSWORD, GF_SECURITY_ADMIN_PASSWORD) in docker-compose.yml.
**Learning:** Infrastructure configuration files are often committed to version control. Hardcoding secrets in them exposes sensitive credentials to anyone with access to the repository, leading to potential unauthorized access to databases or admin panels.
**Prevention:** Use environment variables in configuration files, and enforce their presence using bash parameter expansion syntax (e.g. `${VAR:?Error message}`). Provide an `.env.example` file to document the required variables without exposing the actual secrets.
