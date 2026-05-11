package com.guardian.rn

import com.guardian.rn.generated.ThreatId
import com.guardian.rn.generated.Severity
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONObject

data class ThreatPayload(
    val threatId: String,
    val severity: String,
    val confidence: Double,
    val evidence: Map<String, String>,
    val ts: Long,
)

data class ThreatEnvelope(
    val seq: Long,
    val sessionId: String,
    val ts: Long,
    val hmac: String,
    val payload: ThreatPayload,
)

/**
 * Native threat event bus for Android.
 * Maintains a monotonic sequence number per ADR-0003.
 * Events are emitted as HMAC-signed envelopes onto a SharedFlow.
 * Per ADR-0004: replay = 32, suspend on buffer overflow.
 */
class ThreatBus(
    private val sessionId: String,
    private val sessionKey: ByteArray,
) {
    private val seq = AtomicLong(0L)

    private val _flow = MutableSharedFlow<ThreatEnvelope>(
        replay = 32,
        extraBufferCapacity = 64,
    )
    val flow: SharedFlow<ThreatEnvelope> = _flow.asSharedFlow()

    /**
     * Sign and emit a threat payload.
     * Increments the sequence number atomically.
     */
    suspend fun emit(payload: ThreatPayload) {
        val currentSeq = seq.incrementAndGet()
        val canonical = CanonicalJsonSerializer.canonicalize(
            mapOf(
                "threatId"   to payload.threatId,
                "severity"   to payload.severity,
                "confidence" to payload.confidence,
                "evidence"   to payload.evidence,
                "ts"         to payload.ts,
            )
        )
        val hmac = HmacSigner.sign(canonical, sessionKey)
        val envelope = ThreatEnvelope(
            seq       = currentSeq,
            sessionId = sessionId,
            ts        = System.currentTimeMillis(),
            hmac      = hmac,
            payload   = payload,
        )
        _flow.emit(envelope)
    }

    fun toJson(envelope: ThreatEnvelope): String {
        val evidenceJson = JSONObject(envelope.payload.evidence)
        val payloadJson = JSONObject().apply {
            put("threatId",   envelope.payload.threatId)
            put("severity",   envelope.payload.severity)
            put("confidence", envelope.payload.confidence)
            put("evidence",   evidenceJson)
            put("ts",         envelope.payload.ts)
        }
        return JSONObject().apply {
            put("seq",       envelope.seq)
            put("sessionId", envelope.sessionId)
            put("ts",        envelope.ts)
            put("hmac",      envelope.hmac)
            put("payload",   payloadJson)
        }.toString()
    }
}
