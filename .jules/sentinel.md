## 2026-06-16 - [Critical] Fix HMAC timing leak and DoS vector

**Vulnerability:**
The HMAC verification implementations in `HmacEnvelope.ts`, `HmacSigner.kt`, and `HmacSigner.swift` contained early returns on length mismatch. This creates a timing leak, allowing attackers to incrementally guess valid HMAC lengths. Additionally, iterating based on the untrusted string's length could cause an O(N) Denial of Service (DoS) vulnerability via CPU exhaustion if an attacker supplies an arbitrarily long HMAC string.

**Learning:**
Cryptographic string comparisons must be strictly constant-time. They must accumulate length differences and character differences without branching (e.g., using XOR and OR). Iterations must always be bounded by the length of the *trusted* (locally computed) string, padding any out-of-bounds accesses on the untrusted string with zero.

**Prevention:**
Enforce code reviews and static analysis checks to catch early returns in cryptographic equality functions. Ensure test suites include fuzzing with unusually long inputs to verify O(1) performance bounds on string comparisons.
