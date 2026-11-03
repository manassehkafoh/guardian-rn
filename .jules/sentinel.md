## 2024-11-03 - Insecure Math.random() Fallback in Production
**Vulnerability:** The SDK used `Math.random()` as a fallback to generate the 32-byte cryptographic session key if the native module was unavailable, leading to a highly predictable key and trivial HMAC bypass.
**Learning:** The fallback was intended for tests/CI but lacked enforcement, allowing it to silently execute in production environments when native linking failed.
**Prevention:** Explicitly enforce dev-only usage by throwing an error in production if the native module is missing, and prefer `globalThis.crypto.getRandomValues` when available.
