## 2024-05-24 - Remove hardcoded default passwords from docker-compose

**Vulnerability:** Hardcoded default passwords (`changeme`, `admin`) in `packages/collector/docker-compose.yml` for Elasticsearch, Logstash, Kibana, and Grafana.
**Learning:** Hardcoded default passwords in infrastructure configuration files like Docker Compose are a critical security risk because they can be committed to source control and used as-is in deployments, allowing unauthorized access to databases, logs, and monitoring tools.
**Prevention:** Never use hardcoded default passwords or fallback defaults in Docker Compose configurations. Require explicit environment variables and provide a `.env.example` file to guide secure deployment.
