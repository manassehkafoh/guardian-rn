import Foundation

private let engineId = "community@1.0.0"
private let pollIntervalSeconds: TimeInterval = 30
private let confidenceThreshold: Float = 0.5

public final class CommunityEngine {

    private var pollTask: Task<Void, Never>?
    private let bus: ThreatBusProtocol

    public init(bus: ThreatBusProtocol) {
        self.bus = bus
    }

    public func start() {
        guard pollTask == nil else { return }
        pollTask = Task {
            while !Task.isCancelled {
                await runScan()
                try? await Task.sleep(nanoseconds: UInt64(pollIntervalSeconds * 1_000_000_000))
            }
        }
    }

    public func stop() {
        pollTask?.cancel()
        pollTask = nil
    }

    private func runScan() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { self.checkJailbreak() }
            group.addTask { self.checkDebugger() }
            group.addTask { self.checkSimulator() }
            group.addTask { self.checkHooks() }
        }
    }

    private func checkJailbreak() {
        let r = JailbreakDetector.detect()
        if r.detected && r.confidence >= confidenceThreshold {
            bus.emit(threatId: "jailbreak", severity: "high", confidence: r.confidence,
                     evidence: r.evidence, engineId: engineId)
        }
    }

    private func checkDebugger() {
        let r = DebuggerDetector.detect()
        if r.detected && r.confidence >= confidenceThreshold {
            bus.emit(threatId: "debugger", severity: "high", confidence: r.confidence,
                     evidence: r.evidence, engineId: engineId)
        }
    }

    private func checkSimulator() {
        let r = SimulatorDetector.detect()
        if r.detected && r.confidence >= confidenceThreshold {
            bus.emit(threatId: "simulator", severity: "medium", confidence: r.confidence,
                     evidence: r.evidence, engineId: engineId)
        }
    }

    private func checkHooks() {
        let r = HookDetector.detect()
        if r.detected && r.confidence >= confidenceThreshold {
            bus.emit(threatId: "hooks", severity: "critical", confidence: r.confidence,
                     evidence: r.evidence, engineId: engineId)
        }
    }
}

public protocol ThreatBusProtocol {
    func emit(threatId: String, severity: String, confidence: Float,
              evidence: [String: String], engineId: String)
}
