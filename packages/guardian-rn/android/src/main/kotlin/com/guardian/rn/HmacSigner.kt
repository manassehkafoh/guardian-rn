package com.guardian.rn

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Signs a canonical-JSON payload with HMAC-SHA256.
 * Per ADR-0003: envelope.hmac = "sha256=<hex(HMAC-SHA256(canonicalJson(payload), sessionKey))>"
 */
object HmacSigner {

    fun sign(canonicalPayload: String, keyBytes: ByteArray): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(keyBytes, "HmacSHA256"))
        val digest = mac.doFinal(canonicalPayload.toByteArray(Charsets.UTF_8))
        return "sha256=" + digest.joinToString("") { "%02x".format(it) }
    }

    fun verify(canonicalPayload: String, keyBytes: ByteArray, expectedHmac: String): Boolean {
        val computed = sign(canonicalPayload, keyBytes)
        // Constant-time comparison to prevent timing attacks
        return constantTimeEquals(computed, expectedHmac)
    }

    private fun constantTimeEquals(a: String, b: String): Boolean {
        if (a.length != b.length) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].code xor b[i].code)
        return diff == 0
    }
}
