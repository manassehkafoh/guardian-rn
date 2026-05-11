import Foundation

public enum HookDetector {

    private static let suspectDylibs = [
        "MobileSubstrate",
        "CydiaSubstrate",
        "FridaGadget",
        "frida-agent",
        "SSLKillSwitch",
        "cycript",
        "libhooker",
    ]

    public static func detect() -> DetectorResult {
        var found: [String] = []
        for i in 0..<_dyld_image_count() {
            guard let cName = _dyld_get_image_name(i) else { continue }
            let name = String(cString: cName)
            if suspectDylibs.contains(where: { name.contains($0) }) {
                found.append(name)
            }
        }

        return DetectorResult(
            detected: !found.isEmpty,
            confidence: found.isEmpty ? 0.02 : 0.99,
            evidence: found.isEmpty ? [:] : ["dylibs": found.joined(separator: ",")]
        )
    }
}
