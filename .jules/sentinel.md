## 2024-07-14 - Remove Hardcoded Secrets in Docker Compose
**Vulnerability:** Hardcoded default passwords (`changeme`) were found in `packages/collector/docker-compose.yml` for Elasticsearch and Logstash configuration.
**Learning:** Using hardcoded default credentials in deployment configurations like Docker Compose risks exposing services if deployed without modifying the configuration, especially for data stores like Elasticsearch.
**Prevention:** Never use hardcoded default passwords or fallback defaults in Docker Compose configurations. Require explicit environment variables and provide a `.env.example` file to guide secure deployment.
