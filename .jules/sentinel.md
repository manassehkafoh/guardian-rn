## 2026-07-26 - Hardcoded credentials in docker-compose.yml
**Vulnerability:** Found hardcoded passwords for `elasticsearch`, `logstash`, `kibana`, and `grafana` in `docker-compose.yml`.
**Learning:** Hardcoded default passwords lead to insecure default deployments out of the box, even if they're "changeme". Furthermore, substituting inline shell command variables (like in a `healthcheck`) requires `$${VAR}` to ensure proper interpolation by the container shell rather than the docker host, avoiding issues where variables are unexpectedly resolved early.
**Prevention:** Avoid defining secrets in `docker-compose.yml`. Instead use variable references (`${VAR}`) and provide an `.env.example` file that declares all required variables to encourage secure, custom configuration.
