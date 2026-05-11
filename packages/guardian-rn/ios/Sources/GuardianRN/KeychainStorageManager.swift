import Foundation
import Security

/// iOS implementation of EncryptedStoragePort backed by the system Keychain.
/// All items use kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly —
/// available after first unlock, never migrates in iCloud backup.
public final class KeychainStorageManager {

    private let service: String

    public init(service: String = "com.guardian.rn") {
        self.service = service
    }

    public func set(key: String, value: String) throws {
        let data = Data(value.utf8)
        var query = baseQuery(key: key)

        let existing = SecItemCopyMatching(query as CFDictionary, nil)
        if existing == errSecSuccess {
            let attrs: [CFString: Any] = [kSecValueData: data]
            let status = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
            guard status == errSecSuccess else { throw KeychainError.updateFailed(status) }
        } else {
            query[kSecValueData as String] = data
            let status = SecItemAdd(query as CFDictionary, nil)
            guard status == errSecSuccess else { throw KeychainError.addFailed(status) }
        }
    }

    public func get(key: String) throws -> String? {
        var query = baseQuery(key: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw KeychainError.readFailed(status)
        }
        return String(data: data, encoding: .utf8)
    }

    public func remove(key: String) throws {
        let query = baseQuery(key: key)
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.deleteFailed(status)
        }
    }

    public func clear() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.deleteFailed(status)
        }
    }

    private func baseQuery(key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
    }
}

public enum KeychainError: Error {
    case addFailed(OSStatus)
    case updateFailed(OSStatus)
    case readFailed(OSStatus)
    case deleteFailed(OSStatus)
}
