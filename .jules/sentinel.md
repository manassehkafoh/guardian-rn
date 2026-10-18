## 2024-05-31 - [CRITICAL] Fix insecure session key generation fallback
**Vulnerability:** The SDK used `Math.random()` as a silent fallback for cryptographic session keys when the native module `GuardianKeyProvider` was missing. This resulted in weak, predictable keys.
**Learning:** `Math.random()` was used as a fallback for test environments but applied globally, meaning a misconfigured production build would silently use predictable session keys instead of failing.
**Prevention:** In security-critical contexts, always fail closed. Enforce production-only throws (e.g. `if (isProd) throw ...`) if dependencies for secure randomness (native modules) are unavailable, rather than silently degrading security.
