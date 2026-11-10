## 2024-11-10 - Hardcoded Secrets in Infrastructure Configuration
**Vulnerability:** Default administrative passwords ('changeme' and 'admin') were hardcoded in plain text within `docker-compose.yml` for ElasticSearch, Logstash, Kibana, and Grafana containers.
**Learning:** Default configurations optimized for quick local development often bypass security best practices, leading to potential credential leaks or insecure deployments if the configuration is ever exposed or run in higher environments without modification.
**Prevention:** Always enforce the explicit injection of secrets via required environment variables (e.g., `${VAR:?Error}`) in infrastructure-as-code and document requirements in a `.env.example` file.
