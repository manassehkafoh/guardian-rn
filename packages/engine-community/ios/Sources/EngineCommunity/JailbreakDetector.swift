import Foundation

public struct DetectorResult {
    public let detected: Bool
    public let confidence: Float
    public let evidence: [String: String]
}

public enum JailbreakDetector {

    private static let jailbreakPaths = [
        "/Applications/Cydia.app",
        "/Library/MobileSubstrate/MobileSubstrate.dylib",
        "/bin/bash",
        "/usr/sbin/sshd",
        "/etc/apt",
        "/private/var/lib/apt/",
        "/private/var/tmp/cydia.log",
        "/usr/bin/ssh",
    ]

    public static func detect() -> DetectorResult {
        let foundPaths = jailbreakPaths.filter { FileManager.default.fileExists(atPath: $0) }
        let canWriteOutsideSandbox = canWriteToRestrictedPath()
        let dyldDetected = detectDyldInjection()

        var hits = 0
        if !foundPaths.isEmpty { hits += 1 }
        if canWriteOutsideSandbox { hits += 1 }
        if dyldDetected { hits += 1 }

        let detected = hits >= 1
        let confidence: Float = switch hits {
        case 3: 0.99
        case 2: 0.92
        case 1: 0.75
        default: 0.05
        }

        var evidence: [String: String] = [:]
        if !foundPaths.isEmpty { evidence["paths"] = foundPaths.joined(separator: ",") }
        if canWriteOutsideSandbox { evidence["sandboxEscape"] = "true" }
        if dyldDetected { evidence["dyldInjection"] = "true" }

        return DetectorResult(detected: detected, confidence: confidence, evidence: evidence)
    }

    private static func canWriteToRestrictedPath() -> Bool {
        let testPath = "/private/\(UUID().uuidString)"
        do {
            try "guardian-test".write(toFile: testPath, atomically: true, encoding: .utf8)
            try FileManager.default.removeItem(atPath: testPath)
            return true
        } catch {
            return false
        }
    }

    private static func detectDyldInjection() -> Bool {
        let suspectLibraries = ["MobileSubstrate", "CydiaSubstrate", "cycript", "frida"]
        for i in 0..<_dyld_image_count() {
            if let name = _dyld_get_image_name(i) {
                let imageName = String(cString: name)
                if suspectLibraries.contains(where: { imageName.contains($0) }) {
                    return true
                }
            }
        }
        return false
    }
}
