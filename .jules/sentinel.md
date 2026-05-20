## 2024-05-20 - Constant-Time Equal Implementation
**Vulnerability:** Length-dependent early return in constant-time comparison leaks string length via timing side-channels.
**Learning:** Constant-time comparisons must avoid early returns. They should iterate based on the trusted length and pad the untrusted input to maintain constant time.
**Prevention:** Implement constant-time string comparison correctly by avoiding early returns and iterating up to the maximum possible length or trusted length.
