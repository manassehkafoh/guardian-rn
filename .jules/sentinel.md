## 2023-10-23 - Hardened Insecure Randomness Fallback
**Vulnerability:** The React Native module silently fell back to Math.random() for session key generation if the native module was unavailable, risking insecure key material in production.
**Learning:** Relying on optional native modules for security primitives requires explicit production environment guards to fail securely rather than degrade silently.
**Prevention:** Always enforce dev-only checks (e.g., __DEV__ or process.env.NODE_ENV) before using non-CSPRNG fallbacks in cryptographic contexts.
