## 2023-10-27 - [High] Weak Cryptography Fallback

**Vulnerability:** The `generateSessionKey` function in `useGuardian.ts` used `Math.random()` as a fallback when native cryptographic modules weren't available. `Math.random()` is not a Cryptographically Secure Pseudo-Random Number Generator (CSPRNG) and using it can lead to predictable key material, undermining HMAC signatures.
**Learning:** Native module shims might be missing in some environments, and relying blindly on generic fallbacks without validating the environment can inadvertently ship insecure cryptographic fallbacks into production.
**Prevention:** Instead of using weak algorithms for testing, attempt to use standards-compliant APIs like `globalThis.crypto.getRandomValues()` first. If forced to use insecure fallbacks, strictly assert that they are only allowed in development builds (e.g. `if (!__DEV__) throw`).
