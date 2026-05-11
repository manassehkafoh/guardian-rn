import Foundation

/// RFC 8785 JSON Canonicalisation Scheme (JCS).
/// Must produce identical output to the TypeScript and Kotlin implementations.
/// Test vectors: CanonicalJSONEncoderTests.swift (48 RFC 8785 appendix vectors).
enum CanonicalJSONEncoder {

    static func canonicalize(_ value: Any?) throws -> String {
        guard let value = value else { return "null" }

        switch value {
        case let b as Bool:
            return b ? "true" : "false"

        case let n as NSNumber:
            // Bool is bridged as NSNumber; distinguish by ObjC type encoding
            if String(cString: n.objCType) == "c" {
                return n.boolValue ? "true" : "false"
            }
            return try canonicalizeNumber(n)

        case let s as String:
            return encodeString(s)

        case let arr as [Any?]:
            let items = try arr.map { try canonicalize($0) }
            return "[" + items.joined(separator: ",") + "]"

        case let dict as [String: Any?]:
            let sorted = try dict.keys.sorted().map { key -> String in
                let val = try canonicalize(dict[key] as Any?)
                return encodeString(key) + ":" + val
            }
            return "{" + sorted.joined(separator: ",") + "}"

        default:
            throw CanonicalJSONError.unsupportedType(String(describing: type(of: value)))
        }
    }

    private static func canonicalizeNumber(_ n: NSNumber) throws -> String {
        let d = n.doubleValue
        guard d.isFinite else {
            throw CanonicalJSONError.nonFiniteNumber
        }
        // Use integer representation if exact
        if d == d.rounded(.towardZero) && !d.isInfinite &&
           d >= Double(Int64.min) && d <= Double(Int64.max) {
            return String(Int64(d))
        }
        return String(d)
    }

    private static func encodeString(_ s: String) -> String {
        var out = "\""
        for scalar in s.unicodeScalars {
            let cp = scalar.value
            switch cp {
            case 0x08: out += "\\b"
            case 0x09: out += "\\t"
            case 0x0a: out += "\\n"
            case 0x0c: out += "\\f"
            case 0x0d: out += "\\r"
            case 0x22: out += "\\\""
            case 0x5c: out += "\\\\"
            case ..<0x20:
                out += String(format: "\\u%04x", cp)
            default:
                out += String(scalar)
            }
        }
        out += "\""
        return out
    }
}

enum CanonicalJSONError: Error {
    case unsupportedType(String)
    case nonFiniteNumber
}
