## 2024-10-14 - Fix insecure PRNG fallback in session key generation
**Vulnerability:** Weak random number generator (`Math.random()`) was being used as a fallback for cryptographic session keys if the native module is unavailable.
**Learning:** `Math.random()` provides predictable random numbers and shouldn't be used for any security features. The code had a fallback to it if `GuardianKeyProvider` wasn't available in `useGuardian.ts`, meaning production systems could generate insecure session keys.
**Prevention:** Instead of falling back blindly to `Math.random()`, always try to use `globalThis.crypto.getRandomValues()` as a more secure fallback. Finally, limit the non-cryptographic fallback to dev or testing environments specifically, and throw an error for production.
