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
    static func verify(canonicalPayload: String, keyBytes: [UInt8], expected: String) -> Bool {
        let computed = sign(canonicalPayload: canonicalPayload, keyBytes: keyBytes)
        // computed is locally generated (trusted length).
        // expected is user input (untrusted length).
        // Iterate over computed to prevent DoS via massive strings in expected.
        var diff: Int = computed.utf8.count ^ expected.utf8.count
        var expectedIterator = expected.utf8.makeIterator()
        for c in computed.utf8 {
            let e = expectedIterator.next() ?? 0
            diff |= Int(c) ^ Int(e)
        }
        return diff == 0
    }
}
