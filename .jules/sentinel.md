## 2025-02-14 - Early Return Timing Leak in HMAC Verification
**Vulnerability:** The constant-time equality check for HMAC comparison previously returned early on string length mismatch, allowing potential attackers to incrementally deduce the length of valid HMACs or short circuits via timing attacks.
**Learning:** Even when avoiding string-by-string comparison by utilizing bitwise operations, iterating over an untrusted string length or performing early length returns violates the constant-time constraints of sensitive comparisons.
**Prevention:** Remove early returns on string length discrepancy. Ensure the loop iterates linearly up to the *trusted* parameter's length. Safely pad out-of-bounds indices for untrusted parameters to `0` prior to bitwise XOR comparisons.
