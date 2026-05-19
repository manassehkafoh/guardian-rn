## 2024-05-19 - HMAC Timing Side-Channel Fix
**Vulnerability:** HMAC verification functions across TypeScript, Android (Kotlin), and iOS (Swift) used early returns when comparing expected and computed hashes, leaking string length information via timing side-channels.
**Learning:** Early returns in security-sensitive string comparisons must be avoided, and iteration should always be based on the length of the trusted, locally computed string. Care must be taken in Swift to avoid integer overflow crashes (e.g.  truncation) when comparing lengths.
**Prevention:** Always use constant-time comparison algorithms for security checks, iterate over the trusted length, and use bitwise XOR/OR operations to accumulate differences without branching.
## 2024-05-19 - HMAC Timing Side-Channel Fix
**Vulnerability:** HMAC verification functions across TypeScript, Android (Kotlin), and iOS (Swift) used early returns when comparing expected and computed hashes, leaking string length information via timing side-channels.
**Learning:** Early returns in security-sensitive string comparisons must be avoided, and iteration should always be based on the length of the trusted, locally computed string. Care must be taken in Swift to avoid integer overflow crashes (e.g. `UInt8` truncation) when comparing lengths.
**Prevention:** Always use constant-time comparison algorithms for security checks, iterate over the trusted length, and use bitwise XOR/OR operations to accumulate differences without branching.
