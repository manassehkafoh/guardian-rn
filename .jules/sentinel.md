## 2024-06-28 - Hardcoded Secrets in Docker Compose Configuration

**Vulnerability:** Hardcoded credentials (`changeme`, `admin`) were found directly in `docker-compose.yml` for services like Elasticsearch, Logstash, Kibana, and Grafana.

**Learning:** Storing secrets in plain text within source-controlled configuration files poses a severe security risk. This could expose critical infrastructure to unauthorized access. Also learned about using double dollar signs (`$$`) in Docker Compose shell healthchecks to prevent early environment variable interpolation by `docker-compose`.

**Prevention:** Never commit secrets. Always require explicit environment variables (e.g., `${ELASTIC_PASSWORD}`) for sensitive configuration values. Provide a `.env.example` file to guide developers on secure local deployment setups without exposing actual credentials.
