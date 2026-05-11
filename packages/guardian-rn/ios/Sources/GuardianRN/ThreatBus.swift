import Foundation

struct ThreatPayload: Encodable {
    let threatId: String
    let severity: String
    let confidence: Double
    let evidence: [String: String]
    let ts: Int64
}

struct ThreatEnvelope: Encodable {
    let seq: Int64
    let sessionId: String
    let ts: Int64
    let hmac: String
    let payload: ThreatPayload
}

/// Native threat event bus for iOS.
/// Emits HMAC-signed envelopes via an AsyncStream (ADR-0004).
/// Sequence numbers are maintained with an os_unfair_lock-guarded counter.
final class ThreatBus {

    private let sessionId: String
    private let sessionKey: [UInt8]

    private var seq: Int64 = 0
    private var seqLock = os_unfair_lock_s()

    private var continuations: [String: AsyncStream<ThreatEnvelope>.Continuation] = [:]
    private var continuationLock = os_unfair_lock_s()

    init(sessionId: String, sessionKey: [UInt8]) {
        self.sessionId = sessionId
        self.sessionKey = sessionKey
    }

    /// Returns an AsyncStream of signed envelopes and a token to cancel it.
    func stream() -> (AsyncStream<ThreatEnvelope>, String) {
        let id = UUID().uuidString
        var cont: AsyncStream<ThreatEnvelope>.Continuation!
        let stream = AsyncStream(ThreatEnvelope.self, bufferingPolicy: .bufferingNewest(32)) { continuation in
            cont = continuation
        }
        os_unfair_lock_lock(&continuationLock)
        continuations[id] = cont
        os_unfair_lock_unlock(&continuationLock)
        return (stream, id)
    }

    func cancelStream(id: String) {
        os_unfair_lock_lock(&continuationLock)
        continuations[id]?.finish()
        continuations.removeValue(forKey: id)
        os_unfair_lock_unlock(&continuationLock)
    }

    /// Sign and emit a threat payload to all active streams.
    func emit(_ payload: ThreatPayload) throws {
        os_unfair_lock_lock(&seqLock)
        seq &+= 1
        let currentSeq = seq
        os_unfair_lock_unlock(&seqLock)

        let evidenceMap: [String: Any?] = payload.evidence.mapValues { $0 as Any? }
        let payloadMap: [String: Any?] = [
            "threatId":   payload.threatId,
            "severity":   payload.severity,
            "confidence": payload.confidence,
            "evidence":   evidenceMap,
            "ts":         payload.ts,
        ]
        let canonical = try CanonicalJSONEncoder.canonicalize(payloadMap)
        let hmacValue = HmacSigner.sign(canonicalPayload: canonical, keyBytes: sessionKey)

        let envelope = ThreatEnvelope(
            seq:       currentSeq,
            sessionId: sessionId,
            ts:        Int64(Date().timeIntervalSince1970 * 1000),
            hmac:      hmacValue,
            payload:   payload
        )

        os_unfair_lock_lock(&continuationLock)
        let snapshot = continuations
        os_unfair_lock_unlock(&continuationLock)

        for (_, cont) in snapshot {
            cont.yield(envelope)
        }
    }

    func toJSON(_ envelope: ThreatEnvelope) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = []
        let data = try encoder.encode(envelope)
        return String(data: data, encoding: .utf8) ?? "{}"
    }
}
