## 2024-05-18 - Early Return in Constant-Time String Comparison

**Vulnerability:** Length checks with early returns and iterating over the untrusted string's length in constant-time comparison functions (HMAC verification).
**Learning:** Returning early on length mismatch leaks the length of the expected MAC (timing side-channel). Furthermore, iterating up to the untrusted input length opens a severe CPU Exhaustion / Denial of Service (DoS) attack, as an attacker can provide massively long strings.
**Prevention:** Remove early length mismatch returns. Initialize the diff with the XOR of the lengths. Always strictly iterate up to the trusted (locally computed) string length and pad the untrusted string bounds with zeros using bitwise OR (`| 0`) in JavaScript or null-coalescing in other languages.
