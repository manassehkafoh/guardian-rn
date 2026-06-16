
## 2024-10-24 - Hardcoded Credentials in Docker Compose
**Vulnerability:** Hardcoded default passwords in docker-compose.yml environment variables.
**Learning:** Storing hardcoded secrets in configuration files can lead to unauthorized access and compromises the security of the deployed infrastructure.
**Prevention:** Use environment variables in configuration files and provide a `.env.example` file to guide operators to securely inject secrets during deployment.
