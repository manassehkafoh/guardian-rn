package com.guardian.rn

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG

/**
 * Provides device authentication posture checks exposed to the JS layer
 * via the GuardianDeviceAuth TurboModule.
 *
 * isPasscodeSet()       — true when a PIN, pattern, or password is configured
 * isBiometricEnrolled() — true when at least one strong biometric is enrolled
 *
 * Per ADR-0023.
 */
class DeviceAuthManager(private val context: Context) {

    /**
     * Returns true when the device has a secure lock screen (PIN/pattern/password).
     * Uses KeyguardManager.isDeviceSecure() on API 23+.
     */
    fun isPasscodeSet(): Boolean {
        val km = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            km.isDeviceSecure
        } else {
            @Suppress("DEPRECATION")
            km.isKeyguardSecure
        }
    }

    /**
     * Returns true when at least one strong biometric (fingerprint, face, iris)
     * is enrolled. Uses BiometricManager from androidx.biometric.
     */
    fun isBiometricEnrolled(): Boolean {
        val bm = BiometricManager.from(context)
        return bm.canAuthenticate(BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS
    }
}
