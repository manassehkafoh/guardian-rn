
## 2024-05-25 - [CRITICAL] Early returns in constant-time comparisons enable timing attacks
**Vulnerability:** Constant-time equality checks for HMAC verification (`constantTimeEqual` in TypeScript, Kotlin, and Swift) included early returns on length mismatch. This allowed an attacker to determine the expected HMAC length or bypass checks. Additionally, iterating over untrusted string lengths poses a CPU exhaustion/DoS risk.
**Learning:** Early returns break the constant-time execution constraint required for cryptographic comparisons.
**Prevention:** Eliminate early returns based on length. Instead, initialize the `diff` accumulator with the XOR of the two lengths. Always iterate strictly over the trusted (locally computed) string length and pad any out-of-bounds indices of the untrusted string with `0`. In TypeScript, use explicit 32-bit coercion (`| 0`).
