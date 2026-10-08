## 2023-10-08 - Use secure randomness in CI fallback
**Vulnerability:** Fallback logic uses `Math.random()` to generate cryptographic keys, which is not cryptographically secure and could be used outside tests in some unexpected environments.
**Learning:** Even fallback logic for generating session keys should prefer secure sources like `globalThis.crypto.getRandomValues()` when available to reduce risks. Relying solely on `Math.random` as fallback can lead to security vulnerabilities if `__DEV__` check is missing and Native module fails in prod.
**Prevention:** Always prioritize `globalThis.crypto.getRandomValues()` over `Math.random()` for key generation. Explicitly enforce dev-only usage (throw in production if `__DEV__` is false or `NODE_ENV === 'production'`) for insecure random.
