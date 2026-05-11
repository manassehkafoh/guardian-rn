import Foundation
import Darwin

public enum DebuggerDetector {

    public static func detect() -> DetectorResult {
        let sysctl = isAttachedViaSysctl()
        let ptrace = isTracedViaPtrace()
        let detected = sysctl || ptrace

        let confidence: Float = switch (sysctl, ptrace) {
        case (true, true): 0.99
        case (true, false): 0.95
        case (false, true): 0.88
        default: 0.02
        }

        var evidence: [String: String] = [:]
        if sysctl { evidence["sysctl"] = "true" }
        if ptrace { evidence["ptrace"] = "true" }

        return DetectorResult(detected: detected, confidence: confidence, evidence: evidence)
    }

    private static func isAttachedViaSysctl() -> Bool {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.size
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        let result = sysctl(&mib, 4, &info, &size, nil, 0)
        return result == 0 && (info.kp_proc.p_flag & P_TRACED) != 0
    }

    private static func isTracedViaPtrace() -> Bool {
        // Attempting ptrace(PT_DENY_ATTACH) on a debugged process raises SIGKILL.
        // We use a safe heuristic: check if the parent is lldb or Xcode debugserver.
        let parentPid = getppid()
        guard let parentName = processName(for: parentPid) else { return false }
        return parentName.contains("lldb") || parentName.contains("debugserver")
    }

    private static func processName(for pid: Int32) -> String? {
        var buffer = [CChar](repeating: 0, count: Int(MAXPATHLEN))
        proc_name(pid, &buffer, UInt32(buffer.count))
        let name = String(cString: buffer)
        return name.isEmpty ? nil : name
    }
}
