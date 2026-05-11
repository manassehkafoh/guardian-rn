package com.guardian.engine.community

import android.content.Context
import com.guardian.rn.ThreatBus
import com.guardian.rn.generated.ThreatId
import com.guardian.rn.generated.Severity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

private const val ENGINE_ID = "community@1.0.0"
private const val POLL_INTERVAL_MS = 30_000L
private const val CONFIDENCE_THRESHOLD = 0.5f

class CommunityEngine(private val context: Context) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var pollJob: Job? = null

    fun start(bus: ThreatBus) {
        if (pollJob?.isActive == true) return
        pollJob = scope.launch {
            while (isActive) {
                runScan(bus)
                delay(POLL_INTERVAL_MS)
            }
        }
    }

    fun stop() {
        pollJob?.cancel()
        pollJob = null
    }

    private fun runScan(bus: ThreatBus) {
        val pm = context.packageManager

        runDetector("root") {
            val r = RootDetector.detect()
            if (r.detected && r.confidence >= CONFIDENCE_THRESHOLD) {
                bus.emit(ThreatId.ROOT, Severity.HIGH, r.confidence, r.evidence, ENGINE_ID)
            }
        }

        runDetector("debugger") {
            val r = DebuggerDetector.detect()
            if (r.detected && r.confidence >= CONFIDENCE_THRESHOLD) {
                bus.emit(ThreatId.DEBUGGER, Severity.HIGH, r.confidence, r.evidence, ENGINE_ID)
            }
        }

        runDetector("emulator") {
            val r = EmulatorDetector.detect()
            if (r.detected && r.confidence >= CONFIDENCE_THRESHOLD) {
                bus.emit(ThreatId.EMULATOR, Severity.MEDIUM, r.confidence, r.evidence, ENGINE_ID)
            }
        }

        runDetector("hooks") {
            val r = HookDetector.detect(pm)
            if (r.detected && r.confidence >= CONFIDENCE_THRESHOLD) {
                bus.emit(ThreatId.HOOKS, Severity.CRITICAL, r.confidence, r.evidence, ENGINE_ID)
            }
        }
    }

    private inline fun runDetector(name: String, block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            // Detector failure is non-fatal; log and continue
        }
    }
}
