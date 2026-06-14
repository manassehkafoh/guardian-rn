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

    private fun constantTimeEquals(trusted: String, untrusted: String): Boolean {
        var diff = trusted.length xor untrusted.length
        for (i in trusted.indices) {
            val untrustedCode = if (i < untrusted.length) untrusted[i].code else 0
            diff = diff or (trusted[i].code xor untrustedCode)
        }
        return diff == 0
    }
}
