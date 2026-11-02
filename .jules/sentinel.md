## 2024-11-02 - Insecure CSPRNG Fallback
**Vulnerability:** The application used Math.random() as a silent fallback for generating cryptographic session keys if the native module failed to load.
**Learning:** In environments without native modules, production builds could silently generate predictable keys, rendering HMAC protections ineffective.
**Prevention:** Always fail securely by enforcing environment checks (e.g., throwing an error in production if `__DEV__` is false) rather than silently degrading security material.