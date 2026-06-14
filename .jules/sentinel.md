## 2024-05-15 - Constant-Time HMAC String Comparison CPU Exhaustion/DoS

**Vulnerability:** The constant-time string comparison methods in `HmacEnvelope.ts`, `HmacSigner.kt`, and `HmacSigner.swift` contained two critical vulnerabilities.
1. They exited early if `a.length !== b.length`, defeating the purpose of constant-time comparison as it leaks length information.
2. In many implementations, iterating over the *untrusted* user-supplied string length (or using functions like `zip` that might stop early depending on the smaller string) can lead to a severe Denial of Service (DoS) or CPU exhaustion vulnerability if a maliciously crafted, extremely long string is provided as the HMAC value.

**Learning:** Constant-time comparison must *never* early return based on length. More importantly, the iteration loop must *always* bound its duration by the length of the *trusted* (locally computed) string. If you loop based on the untrusted string's length, an attacker can send a 100MB string and force the server to iterate 100 million times.

**Prevention:**
- When implementing constant-time comparison, compute `let diff = trusted.length ^ untrusted.length` initially to capture length mismatches without returning early.
- Always iterate `for (i = 0; i < trusted.length; i++)`.
- When accessing the untrusted string's characters within the loop, safely pad with `0` (or `NaN | 0`) if the index is out-of-bounds to prevent crashes.
- In Swift, use `Int` instead of `UInt8` for accumulation to prevent overflow crashes when bitwise OR-ing large length differences.
