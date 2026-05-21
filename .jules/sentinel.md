## 2024-05-21 - [CRITICAL] Prevent HMAC length timing attacks and CPU exhaustion DoS

**Vulnerability:** The `constantTimeEqual` function in TypeScript, and `constantTimeEquals` in Kotlin and `verify` in Swift had an early return length check causing potential timing side channels for HMAC signature matching.
**Learning:** These early returns meant we couldn't properly secure the hash length and they could be inferred via timing. In addition, iterating on the bounds of the untrusted hash `b` meant that malicious users could provide extreme length hashes to cause severe CPU exhaustion.
**Prevention:** Bound string iteration using the expected hash length, pad out-of-bounds missing user characters with zeroes. Perform length check XOR to start the difference tracker, and remove early returns.
