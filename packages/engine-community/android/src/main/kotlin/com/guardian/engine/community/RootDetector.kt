package com.guardian.engine.community

import java.io.File

object RootDetector {

    private val ROOT_PATHS = listOf(
        "/system/app/Superuser.apk",
        "/system/xbin/su",
        "/system/bin/su",
        "/sbin/su",
        "/data/local/xbin/su",
        "/data/local/bin/su",
        "/data/local/su",
        "/system/bin/.ext/.su",
        "/system/usr/we-need-root/su-backup",
    )

    private val ROOT_BINARIES = listOf("su", "busybox", "magisk", "daemonsu")

    data class Result(
        val detected: Boolean,
        val confidence: Float,
        val evidence: Map<String, String>,
    )

    fun detect(): Result {
        val foundPaths = ROOT_PATHS.filter { File(it).exists() }
        val foundBinaries = ROOT_BINARIES.filter { binary ->
            System.getenv("PATH")
                ?.split(":")
                ?.any { dir -> File(dir, binary).exists() } == true
        }

        val detected = foundPaths.isNotEmpty() || foundBinaries.isNotEmpty()
        val confidence = when {
            foundPaths.size >= 2 -> 0.97f
            foundPaths.size == 1 -> 0.80f
            foundBinaries.isNotEmpty() -> 0.70f
            else -> 0.05f
        }

        return Result(
            detected = detected,
            confidence = confidence,
            evidence = buildMap {
                if (foundPaths.isNotEmpty()) put("paths", foundPaths.joinToString(","))
                if (foundBinaries.isNotEmpty()) put("binaries", foundBinaries.joinToString(","))
            },
        )
    }
}
