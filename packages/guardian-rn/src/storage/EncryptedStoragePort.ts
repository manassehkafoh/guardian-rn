/**
 * Abstraction over encrypted key-value storage.
 * Implementations: Android EncryptedSharedPreferences / iOS Keychain.
 * Consumers depend on this interface only — never on platform impls directly.
 */
export interface EncryptedStoragePort {
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * In-memory implementation for tests and environments without native storage.
 * Never persists beyond process lifetime — do not use in production.
 */
export class InMemoryEncryptedStorage implements EncryptedStoragePort {
  private readonly store = new Map<string, string>();

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}
