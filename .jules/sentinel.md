## 2025-02-14 - Predictable cryptographic session keys due to `Math.random()` fallback

**Vulnerability:** The Guardian SDK used an insecure `Math.random()` fallback to generate cryptographic session keys when native Keystore/SecureEnclave modules were unavailable.
**Learning:** Development-only fallback paths for cryptographic operations can silently deploy to production if environmental guards (like `__DEV__` or `NODE_ENV`) are not explicitly enforced, allowing highly predictable key generation.
**Prevention:** Cryptographic generation fallbacks should always prioritize standard web APIs (`globalThis.crypto.getRandomValues`) and strictly assert the environment (e.g., throwing a fatal error if development flags are false) before resorting to insecure mock generators.
