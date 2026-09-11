## 2024-05-18 - Insecure Random Key Generation Fallback

**Vulnerability:** The session key generation mechanism (`generateSessionKey`) in `@guardian/rn` fell back silently to `Math.random()` when native crypto modules (`GuardianKeyProvider`) were missing. `Math.random()` is not a cryptographically secure pseudo-random number generator (CSPRNG), leading to predictable session keys if the fallback triggers in production.
**Learning:** Hardcoded fallbacks meant for testing/CI (like `Math.random()`) can be inadvertently triggered in production if native modules are not linked correctly, causing a silent downgrade to insecure cryptography.
**Prevention:** If an insecure fallback is maintained for tests/CI, harden it by first attempting web-standard CSPRNGs (`globalThis.crypto.getRandomValues`), and strictly enforcing dev-only usage for the insecure fallback by throwing an error in production environments (e.g., checking `__DEV__` or `process.env.NODE_ENV === 'production'`).
