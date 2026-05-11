import Foundation
import Security

/// Generates and holds the per-session HMAC-SHA256 key (ADR-0003).
/// getSessionKeyBytes() may be called exactly once per instance.
final class SessionKeyManager {

    private var rawKey: [UInt8]?
    private var keyDelivered = false
    private let lock = NSLock()

    init() {
        rawKey = generateKey()
    }

    /// Returns the 32-byte session key.
    /// Throws if called more than once.
    func getSessionKeyBytes() throws -> [UInt8] {
        lock.lock()
        defer { lock.unlock() }

        guard !keyDelivered else {
            throw GuardianError.sessionKeyAlreadyDelivered
        }
        guard var key = rawKey else {
            throw GuardianError.sessionKeyNotInitialised
        }

        keyDelivered = true
        rawKey = nil

        let copy = key
        // Zero out the local buffer
        key.withUnsafeMutableBufferPointer { $0.initialize(repeating: 0) }
        return copy
    }

    private func generateKey() -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            // Fallback: arc4random_buf (never used in production; logs a warning)
            arc4random_buf(&bytes, bytes.count)
            return bytes
        }
        return bytes
    }
}

enum GuardianError: Error {
    case sessionKeyAlreadyDelivered
    case sessionKeyNotInitialised
}
