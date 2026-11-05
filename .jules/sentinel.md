## 2024-05-20 - Insecure Session Key Fallback
**Vulnerability:** The generateSessionKey function could fall back to an insecure Math.random()-based key generation in production if the native module was unavailable.
**Learning:** The fallback was intended for tests/CI but was not strictly gated behind development environment checks.
**Prevention:** Always gate test fallbacks for cryptographic material behind explicit __DEV__ or NODE_ENV checks and throw in production.
