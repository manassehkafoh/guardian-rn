
## 2023-10-25 - [Secrets Management] Enforce Environment Variables in Docker Compose
**Vulnerability:** Hardcoded credentials (`changeme`, `admin`) in `packages/collector/docker-compose.yml` for Elasticsearch, Kibana, Logstash, and Grafana.
**Learning:** `docker-compose.yml` files are frequently committed to version control. Default credentials can lead to unauthorized access if these files are used to deploy infrastructure directly or if defaults aren't overridden in production. Using `${VAR:?Error}` enforces that variables must be provided in the environment.
**Prevention:** Always use environment variable substitution with enforcement (`${VAR:?Error}`) for secrets in docker-compose files and document them in a `.env.example` file. Never commit `.env` files or include hardcoded defaults for secrets.
