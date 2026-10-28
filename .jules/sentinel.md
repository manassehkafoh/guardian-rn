## 2026-10-28 - Insecure PRNG Fallback in Key Generation
**Vulnerability:** Key generation fell back to Math.random() without environment checks.
**Learning:** Test/CI fallbacks can inadvertently execute in production environments if native modules fail or are misconfigured.
**Prevention:** Harden fallbacks by trying globalThis.crypto.getRandomValues and enforcing dev-only usage before allowing Math.random().
