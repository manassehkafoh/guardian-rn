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

    /// Constant-time comparison to prevent timing side-channels and O(N) CPU exhaustion DoS.
    static func verify(canonicalPayload: String, keyBytes: [UInt8], expected: String) -> Bool {
        let computed = sign(canonicalPayload: canonicalPayload, keyBytes: keyBytes)
        var diff: Int = computed.count ^ expected.count
        var expectedIterator = expected.utf8.makeIterator()
        for a in computed.utf8 {
            let b = expectedIterator.next() ?? 0
            diff |= Int(a ^ b)
        }
        return diff == 0
    }
}
