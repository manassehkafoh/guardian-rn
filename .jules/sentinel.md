## 2024-10-09 - Hardening cryptographic material generation in fallbacks

**Vulnerability:** The SDK used `Math.random()` as a fallback for session key generation if the native module (`GuardianKeyProvider`) wasn't available. In production builds, this could lead to predictable session keys and potential HMAC forgery if the native module silently fails to load or link.

**Learning:** When providing fallbacks for missing cryptographic native APIs (like `GuardianKeyProvider`), you cannot assume the fallback will only execute in development/CI. A missing linking configuration could cause the production app to silently use the weak fallback, silently degrading the security posture.

**Prevention:** Always explicitly fail-secure in production environments. Enforce environmental checks (like `__DEV__` or `NODE_ENV`) in the fallback path, actively throwing an error instead of continuing with non-secure defaults. Additionally, utilize standard web APIs like `globalThis.crypto.getRandomValues` when available in the environment to bolster the fallback.
