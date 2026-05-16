## 2024-03-05 - [Fix Timing Side-Channel in HMAC Verifications]
**Vulnerability:** Length-dependent early return in `constantTimeEqual` implementations.
**Learning:** Returning early when lengths mismatch in a constant-time equality check effectively creates a timing side-channel that leaks the length of the expected signature/secret.
**Prevention:** Compare lengths using bitwise XOR, incorporate it into the initial `diff`, and iterate up to the expected signature's length to ensure the operation time is independent of the provided string's length or content.
