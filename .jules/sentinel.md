## 2024-07-08 - Hardcoded Default Passwords in Infrastructure Config
**Vulnerability:** Default hardcoded passwords (`changeme`, `admin`) were left in the Docker Compose configuration for Elasticsearch, Kibana, Logstash, and Grafana.
**Learning:** Hardcoded credentials in infrastructure configuration files create significant risk, especially if deployed directly to production. When environment variable replacements are needed inside shell instructions (like healthchecks) in docker-compose, `$$` must be used to defer interpolation to the container shell.
**Prevention:** Never use hardcoded credentials or fallback defaults (like `${VAR:-default}`) in docker-compose.yml. Always mandate explicit environment variables and provide a `.env.example` file to guide secure deployment.
