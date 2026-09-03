package com.guardian.rn

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.guardian.rn.generated.ThreatId

/**
 * TurboModule entry point for guardian-rn on Android.
 * Lifecycle: start() → events via onThreat stream → stop().
 * Per ADR-0001: no legacy bridge support; TurboModule only.
 */
class GuardianRNModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var threatBus: ThreatBus? = null
    private var nativeSessionKey: ByteArray? = null
    private var currentSessionId: String? = null

    override fun getName(): String = "GuardianRN"

    @ReactMethod
    fun start(config: ReadableMap, promise: Promise) {
        try {
            if (threatBus != null) {
                promise.resolve(currentSessionId)
                return
            }

            val sessionId = if (config.hasKey("sessionId")) {
                config.getString("sessionId") ?: java.util.UUID.randomUUID().toString()
            } else {
                java.util.UUID.randomUUID().toString()
            }

            val skm = SessionKeyManager()
            val keyBytes = skm.getSessionKeyBytes()

            nativeSessionKey = keyBytes
            currentSessionId = sessionId
            threatBus = ThreatBus(sessionId, keyBytes)

            promise.resolve(sessionId)
        } catch (e: Exception) {
            promise.reject("GUARDIAN_START_ERROR", e.message)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        // TODO Phase 2: stop engine, flush telemetry
        promise.resolve(null)
    }

    @ReactMethod
    fun getSessionKey(promise: Promise) {
        // TODO Phase 2: deliver session key via JSI HostObject (ADR-0003)
        // getSessionKey() may be called only once per process lifetime.
        promise.reject("NOT_IMPLEMENTED", "JSI HostObject not yet wired — Phase 2")
    }
}
