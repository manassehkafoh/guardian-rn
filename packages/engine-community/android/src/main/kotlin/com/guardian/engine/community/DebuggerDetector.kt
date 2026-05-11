package com.guardian.engine.community

import android.os.Debug
import java.io.File

object DebuggerDetector {

    data class Result(
        val detected: Boolean,
        val confidence: Float,
        val evidence: Map<String, String>,
    )

    fun detect(): Result {
        val jdwpAttached = Debug.isDebuggerConnected()
        val tracerPid = readTracerPid()
        val detected = jdwpAttached || tracerPid > 0

        val confidence = when {
            jdwpAttached && tracerPid > 0 -> 0.99f
            jdwpAttached -> 0.95f
            tracerPid > 0 -> 0.90f
            else -> 0.02f
        }

        return Result(
            detected = detected,
            confidence = confidence,
            evidence = buildMap {
                if (jdwpAttached) put("jdwp", "true")
                if (tracerPid > 0) put("tracerPid", tracerPid.toString())
            },
        )
    }

    private fun readTracerPid(): Int {
        return try {
            File("/proc/self/status")
                .readLines()
                .firstOrNull { it.startsWith("TracerPid:") }
                ?.substringAfter(":")
                ?.trim()
                ?.toIntOrNull() ?: 0
        } catch (_: Exception) {
            0
        }
    }
}
