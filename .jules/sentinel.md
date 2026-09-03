## 2024-05-15 - SimpleSubject Emission
**Vulnerability:** N/A (Performance/Anti-pattern)
**Learning:** Making observable emissions asynchronous (e.g. `setTimeout`) breaks synchronous contracts, creates race conditions, and adds severe timer allocation overhead for high-frequency emitters. Standard array iteration with cloning (`slice`) avoids mutation bugs while maintaining excellent, safe performance.
**Prevention:** Stick to synchronous array slicing for event emitters.
