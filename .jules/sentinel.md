## 2024-05-16 - DoS and Timing Risks in Constant-Time String Comparison
**Vulnerability:** HMAC equality checks used early returns for length mismatches and iterated over untrusted string lengths, introducing timing attacks and O(N) CPU exhaustion/DoS vulnerabilities.
**Learning:** Even when avoiding early returns on character mismatches, early returns on length mismatch leak the length, and iterating over the untrusted string's length can lead to CPU exhaustion.
**Prevention:** Remove early returns on length, accumulate the length difference directly (e.g. using XOR), and strictly iterate over the *trusted* (locally computed) string's length. Pad any out-of-bounds access for the untrusted string with zero.
