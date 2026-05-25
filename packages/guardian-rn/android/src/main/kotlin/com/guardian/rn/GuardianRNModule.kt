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

    override fun getName(): String = "GuardianRN"

    @ReactMethod
    fun start(config: ReadableMap, promise: Promise) {
        // TODO(GUARD-2001) Phase 2: initialise engine, session key, HMAC envelope
        promise.resolve(null)
    }

    @ReactMethod
    fun stop(promise: Promise) {
        // TODO(GUARD-2001) Phase 2: stop engine, flush telemetry
        promise.resolve(null)
    }

    @ReactMethod
    fun getSessionKey(promise: Promise) {
        // TODO(GUARD-2001) Phase 2: deliver session key via JSI HostObject (ADR-0003)
        // getSessionKey() may be called only once per process lifetime.
        promise.reject("NOT_IMPLEMENTED", "JSI HostObject not yet wired — Phase 2")
    }
}
