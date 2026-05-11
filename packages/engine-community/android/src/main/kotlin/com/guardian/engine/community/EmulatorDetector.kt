package com.guardian.engine.community

import android.os.Build

object EmulatorDetector {

    private val EMULATOR_FINGERPRINTS = listOf(
        "generic", "unknown", "google_sdk", "emulator", "Android SDK built for x86",
    )

    private val EMULATOR_MODELS = listOf(
        "sdk", "Emulator", "Android SDK built for x86",
    )

    data class Result(
        val detected: Boolean,
        val confidence: Float,
        val evidence: Map<String, String>,
    )

    fun detect(): Result {
        val fingerprintMatch = EMULATOR_FINGERPRINTS.any {
            Build.FINGERPRINT.startsWith(it) || Build.FINGERPRINT.contains(it)
        }
        val modelMatch = EMULATOR_MODELS.any { Build.MODEL.contains(it) }
        val manufacturerGoogle = Build.MANUFACTURER.equals("Google", ignoreCase = true)
                && Build.BRAND.equals("google", ignoreCase = true)
                && !Build.DEVICE.startsWith("coral") // Pixel 4, not emulator

        val hits = listOf(fingerprintMatch, modelMatch, manufacturerGoogle).count { it }
        val detected = hits >= 2 || (hits == 1 && fingerprintMatch)
        val confidence = when (hits) {
            3 -> 0.99f
            2 -> 0.90f
            1 -> 0.60f
            else -> 0.05f
        }

        return Result(
            detected = detected,
            confidence = confidence,
            evidence = buildMap {
                if (fingerprintMatch) put("fingerprint", Build.FINGERPRINT)
                if (modelMatch) put("model", Build.MODEL)
                if (manufacturerGoogle) put("manufacturer", Build.MANUFACTURER)
            },
        )
    }
}
