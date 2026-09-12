## 2026-09-12 - [Weak Random Fallback in Production]
**Vulnerability:** The GuardianKeyProvider TurboModule fallback for generateSessionKey generated insecure keys using Math.random() without environment restrictions.
**Learning:** Math.random() is fine for test environments but must be explicitly prohibited in production to avoid generating weak cryptographic material when native modules fail.
**Prevention:** Hardened fallback sequence to prefer globalThis.crypto.getRandomValues() and explicitly throw an error in production environments if CSPRNG is unavailable.
