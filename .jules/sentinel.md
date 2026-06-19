## 2024-11-20 - [CRITICAL] Constant-Time String Comparison Vulnerability
**Vulnerability:** The `constantTimeEqual` functions in TypeScript, Kotlin, and Swift implementations of the HMAC verification were returning early if the length of the computed HMAC did not match the expected HMAC. This introduced a timing side-channel attack where an attacker could deduce the expected HMAC length. Additionally, iterating over the untrusted string length could introduce a CPU exhaustion (Denial of Service) vulnerability if the attacker provides a massive payload.
**Learning:** Even when attempting to use constant-time comparison algorithms (like bitwise XOR), an early return based on length breaks the constant-time property and opens the door to timing attacks. Furthermore, iterating over untrusted input without bounds limits is dangerous and can lead to DoS attacks.
**Prevention:**
1. Always incorporate length comparisons securely within the loop using bitwise operations (e.g., `diff = a.length ^ b.length`).
2. Never return early on mismatched lengths.
3. Always iterate over the *trusted* (locally computed or expected) length, padding the untrusted input with zeros if it is out-of-bounds.
