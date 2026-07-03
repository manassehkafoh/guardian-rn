## 2024-07-03 - Math.random() usage for session identifiers
**Vulnerability:** Weak random number generator for session IDs and test HMAC keys
**Learning:** React Native lacks `crypto.getRandomValues()`. Using `Math.random()` to generate UUIDs or fallback keys weakens security as it's not cryptographically secure, and its seed might be predictable or easily guessed.
**Prevention:** Always use `react-native-get-random-values` polyfill and `uuid` or similar cryptographically secure libraries for identifier and key generation, even for fallback keys in environments outside the native app.
