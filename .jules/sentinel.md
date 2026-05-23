## 2024-05-23 - Prevent early return in constant-time HMAC comparison
**Vulnerability:** The `constantTimeEqual` function in `HmacEnvelope.ts` used an early return `if (a.length !== b.length) return false;` when comparing untrusted input `a` with trusted input `b`. Iterating over the untrusted length or doing early returns creates a CPU exhaustion / Denial of Service (DoS) vulnerability.
**Learning:** Constant-time string comparisons must strictly iterate over the *trusted* (locally computed) string length and must avoid early return patterns that depend on input lengths.
**Prevention:** Pad out-of-bounds indices of the untrusted string with zeroes and add length checking logic to the `diff` variable using bitwise operations, iterating only based on the trusted local string's length.
