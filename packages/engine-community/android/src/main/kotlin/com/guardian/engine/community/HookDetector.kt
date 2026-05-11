package com.guardian.engine.community

import android.content.pm.PackageManager

object HookDetector {

    private val KNOWN_HOOK_PACKAGES = listOf(
        "de.robv.android.xposed.installer",
        "com.saurik.substrate",
        "com.topjohnwu.magisk",
        "io.github.lsposed.manager",
        "org.lsposed.manager",
    )

    data class Result(
        val detected: Boolean,
        val confidence: Float,
        val evidence: Map<String, String>,
    )

    fun detect(packageManager: PackageManager): Result {
        val found = KNOWN_HOOK_PACKAGES.filter { pkg ->
            try {
                @Suppress("DEPRECATION")
                packageManager.getPackageInfo(pkg, 0)
                true
            } catch (_: PackageManager.NameNotFoundException) {
                false
            }
        }

        return Result(
            detected = found.isNotEmpty(),
            confidence = if (found.isNotEmpty()) 0.99f else 0.03f,
            evidence = if (found.isNotEmpty()) mapOf("packages" to found.joinToString(",")) else emptyMap(),
        )
    }
}
