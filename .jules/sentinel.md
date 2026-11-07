## 2026-11-07 - Hardcoded Secrets in Infrastructure Configs
**Vulnerability:** Found hardcoded default passwords (e.g. changeme, admin) in docker-compose.yml for ElasticSearch, Logstash, Kibana, and Grafana.
**Learning:** Infrastructure-as-code files were treated as development-only and missed standard secret management review, leading to deployed services using default credentials.
**Prevention:** Enforce environment variable usage with no defaults (e.g., ${VAR:?Error}) in all docker-compose and deployment files, and maintain a documented .env.example.
