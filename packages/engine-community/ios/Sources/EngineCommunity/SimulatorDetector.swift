import Foundation

public enum SimulatorDetector {

    public static func detect() -> DetectorResult {
        #if targetEnvironment(simulator)
        return DetectorResult(
            detected: true,
            confidence: 0.99,
            evidence: ["targetEnvironment": "simulator"]
        )
        #else
        // Runtime fallback: check for simulator-specific env variables
        let simEnv = ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"]
        if simEnv != nil {
            return DetectorResult(
                detected: true,
                confidence: 0.97,
                evidence: ["simulatorDevice": simEnv ?? "unknown"]
            )
        }
        return DetectorResult(detected: false, confidence: 0.02, evidence: [:])
        #endif
    }
}
