## 2024-10-17 - Insecure Cryptographic Fallback
**Vulnerability:** The session key generation in `generateSessionKey()` used `Math.random()` as a fallback when the native `GuardianKeyProvider` was unavailable, meaning production keys could be easily guessable.
**Learning:** `Math.random()` was documented as a test/CI fallback but lacked checks to prevent its use in production. Test fallbacks should never be reachable in a production environment if native modules are accidentally not linked.
**Prevention:** Always first attempt to use `globalThis.crypto.getRandomValues`. Furthermore, explicitly enforce dev-only usage (e.g., throwing an error in production if `__DEV__` is false or `NODE_ENV === 'production'`) rather than allowing the insecure fallback to run.
