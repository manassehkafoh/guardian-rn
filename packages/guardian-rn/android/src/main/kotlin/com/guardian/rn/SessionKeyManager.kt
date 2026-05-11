package com.guardian.rn

import android.security.keystore.KeyGenerator
import android.security.keystore.KeyProperties
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.SecretKey

/**
 * Generates and holds the per-session HMAC-SHA256 key.
 * Android: backed by AndroidKeyStore when available (API 23+).
 * Per ADR-0003: getSessionKeyBytes() may be called only once per instance.
 */
class SessionKeyManager {

    private val keyDelivered = AtomicBoolean(false)
    private val keyAlias = "guardian_session_${System.nanoTime()}"
    private var rawKey: ByteArray? = null

    init {
        rawKey = generateKey()
    }

    /**
     * Returns the 32-byte session key.
     * @throws IllegalStateException if called more than once.
     */
    fun getSessionKeyBytes(): ByteArray {
        if (!keyDelivered.compareAndSet(false, true)) {
            throw IllegalStateException("GuardianError: session key already delivered — may only be called once per session")
        }
        val key = rawKey ?: throw IllegalStateException("GuardianError: session key not initialised")
        val copy = key.copyOf()
        key.fill(0)  // zero out the original after delivery
        rawKey = null
        return copy
    }

    private fun generateKey(): ByteArray {
        return try {
            val kg = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_HMAC_SHA256,
                "AndroidKeyStore"
            )
            kg.init(
                android.security.keystore.KeyGenParameterSpec.Builder(
                    keyAlias,
                    KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
                ).build()
            )
            val secretKey: SecretKey = kg.generateKey()
            // Export raw bytes for delivery to JS — only done once
            val ks = java.security.KeyStore.getInstance("AndroidKeyStore")
            ks.load(null)
            (ks.getKey(keyAlias, null) as? javax.crypto.SecretKey)?.encoded
                ?: fallbackKey()
        } catch (e: Exception) {
            // Fallback to in-memory SecureRandom if Keystore unavailable
            fallbackKey()
        }
    }

    private fun fallbackKey(): ByteArray {
        val key = ByteArray(32)
        java.security.SecureRandom().nextBytes(key)
        return key
    }
}
