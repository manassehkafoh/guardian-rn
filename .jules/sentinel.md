## 2023-10-27 - [CRITICAL] Fix insecure fallback for cryptographic session key generation
**Vulnerability:** The SDK used `Math.random()` as a fallback for generating cryptographic session keys when native modules were unavailable.
**Learning:** This creates a critical vulnerability because `Math.random()` produces predictable values, compromising HMAC signing security. The fallback was intended for tests but could accidentally execute in production environments lacking native crypto modules.
**Prevention:** Always harden fallback crypto implementations by attempting `globalThis.crypto.getRandomValues` first, and explicitly enforcing dev-only usage for non-CSPRNG fallbacks by throwing errors in production environments (`__DEV__` or `NODE_ENV === 'production'`).
