## 2024-05-24 - Infrastructure Secrets Management
**Vulnerability:** Hardcoded default passwords ('changeme' and 'admin') were present in docker-compose.yml for Elasticsearch, Logstash, Kibana, and Grafana.
**Learning:** Development environments often ship with hardcoded defaults to simplify setup, but these can easily leak into production if deployed as-is, especially when using Docker Compose for infrastructure.
**Prevention:** Always enforce the use of environment variables without hardcoded defaults (e.g., using ${VAR:?Error}) in docker-compose files and provide a .env.example template to ensure secure configuration during deployment.
