import Foundation
import CommonCrypto

/// Signs a canonical-JSON payload with HMAC-SHA256 (ADR-0003).
/// Output format: "sha256=<lowercase hex>"
enum HmacSigner {

    static func sign(canonicalPayload: String, keyBytes: [UInt8]) -> String {
        var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        let data = Array(canonicalPayload.utf8)
        CCHmac(CCHmacAlgorithm(kCCHmacAlgSHA256),
               keyBytes, keyBytes.count,
               data, data.count,
               &digest)
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        return "sha256=\(hex)"
    }

    /// Constant-time comparison to prevent timing side-channels.
    /// Security: Strictly iterate based on the length of the trusted (locally computed) string `computed`.
    /// Untrusted string `expected` is padded with zeros for out-of-bounds indices.
    static func verify(canonicalPayload: String, keyBytes: [UInt8], expected: String) -> Bool {
        let computed = sign(canonicalPayload: canonicalPayload, keyBytes: keyBytes)
        var expectedIter = expected.utf8.makeIterator()
        var diff: UInt8 = 0

        for a in computed.utf8 {
            let b = expectedIter.next() ?? 0
            diff |= a ^ b
        }

        // Ensure expected length matches exactly
        if expectedIter.next() != nil || computed.count != expected.count {
            diff |= 1
        }

        return diff == 0
    }
}
