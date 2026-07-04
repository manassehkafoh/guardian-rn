## 2024-05-18 - Hardcoded Credentials in Docker Compose
**Vulnerability:** Default passwords like `changeme` and `admin` were hardcoded into the `docker-compose.yml` for critical infrastructure services (Elasticsearch, Kibana, Grafana, Logstash).
**Learning:** Hardcoded configuration defaults often get pushed to production unedited, leading to unauthorized access.
**Prevention:** Extract all credentials to a `.env` file via variables (e.g. `${ELASTICSEARCH_PASSWORD}`) and provide a `.env.example` file that lists them clearly. Ensure inline shell scripts inside compose definitions escape variables using `$$` if they should evaluate inside the container.
