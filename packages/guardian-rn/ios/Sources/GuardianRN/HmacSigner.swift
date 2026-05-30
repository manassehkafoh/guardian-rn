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
        let computedUtf8 = computed.utf8
        let expectedUtf8 = expected.utf8

        var diff: Int = computedUtf8.count ^ expectedUtf8.count
        var expectedIt = expectedUtf8.makeIterator()
        var computedIt = computedUtf8.makeIterator()

        // Security: Iterate over the trusted length (computed) to prevent timing/DoS attacks
        for _ in 0..<computedUtf8.count {
            let c = Int(computedIt.next() ?? 0)
            let e = Int(expectedIt.next() ?? 0)
            diff |= c ^ e
        }
        return diff == 0
    }
}
