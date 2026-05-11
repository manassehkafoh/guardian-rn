import type { ThreatId } from '../generated/ThreatId.js';
import type { ResponsePolicy } from '../generated/ResponsePolicy.js';
import type { EncryptedStoragePort } from '../storage/EncryptedStoragePort.js';
import { DEFAULT_POLICIES } from '../core/policy.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Versioned storage key. Incrementing the version suffix forces a cache
 * miss on all existing devices after a breaking change to the PolicyMap shape,
 * so old devices do not apply an incompatible cached format.
 */
const STORAGE_KEY = 'guardian:policy-store:v1';

/** A partial map from threat identifiers to their assigned response policy. */
export type PolicyMap = Partial<Record<ThreatId, ResponsePolicy>>;

// ─────────────────────────────────────────────────────────────────────────────
// PolicyStore
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Offline-resilient remote policy cache. Per ADR-0017.
 *
 * ── Problem ───────────────────────────────────────────────────────────────
 *
 * Hard-coded policies (DEFAULT_POLICIES) cannot be updated without shipping
 * a new app version. In practice, the threat landscape evolves faster than
 * app release cycles: a newly discovered hook framework needs its policy
 * escalated from 'restrict' to 'kill' immediately, not at the next quarterly
 * release.
 *
 * ── Solution ──────────────────────────────────────────────────────────────
 *
 * PolicyStore fetches a PolicyMap JSON from a remote HTTPS endpoint on every
 * useGuardian mount. Successful fetches are persisted to encrypted device
 * storage (EncryptedSharedPreferences on Android, Keychain on iOS) so they
 * survive the next launch even without network connectivity.
 *
 * The fallback chain:
 *   1. Remote fetch succeeds    → use remote map, persist it.
 *   2. Remote fetch fails       → use last persisted map.
 *   3. No persisted map exists  → use DEFAULT_POLICIES (built-in SDK defaults).
 *
 * The fetch is advisory — the SDK never blocks the session start waiting for
 * it. load() is async, but its result is available before the first engine
 * scan completes, so in practice policies are always up-to-date.
 *
 * ── Security considerations ───────────────────────────────────────────────
 *
 * The remote endpoint MUST be served over HTTPS. The SDK does not perform
 * certificate pinning by default — tenants with strict security requirements
 * should implement pinning at the network layer (OkHttp interceptor on Android,
 * URLSession delegate on iOS) or behind a trusted CDN with HSTS.
 *
 * The persisted map is stored in the platform's encrypted storage subsystem
 * and is therefore protected at rest. The JSON format is not authenticated
 * (no HMAC over the policy map itself), which means a compromised backend
 * could serve a permissive map. Rate of change monitoring at the backend
 * is the recommended mitigation.
 */
export class PolicyStore {
  private readonly storage: EncryptedStoragePort;
  private readonly endpoint: string | undefined;

  /**
   * @param storage   Encrypted key-value store. Use EncryptedSharedPreferences
   *                  (Android) or KeychainStorageManager (iOS) in production;
   *                  InMemoryEncryptedStorage in tests.
   * @param endpoint  Optional HTTPS URL of the remote policy JSON endpoint.
   *                  Omit when no remote endpoint is configured; the store
   *                  will operate in cache-only mode.
   */
  constructor(storage: EncryptedStoragePort, endpoint?: string) {
    this.storage  = storage;
    this.endpoint = endpoint;
  }

  /**
   * Return the most authoritative policy map currently available.
   *
   * Tries the remote endpoint first (if configured), falls back to the
   * encrypted device cache, and finally to DEFAULT_POLICIES as a last resort.
   *
   * The caller (PolicyEngine constructor or useGuardian) should call load()
   * early in the mount lifecycle so that remote updates are applied before
   * the first threat events are processed.
   */
  async load(): Promise<PolicyMap> {
    if (this.endpoint) {
      try {
        const remote = await this.fetchRemote(this.endpoint);
        // Persist immediately so the next launch can use this map
        // even if the network is unavailable.
        await this.persist(remote);
        return remote;
      } catch {
        // Network error, timeout, or malformed response — fall through to cache.
        // The SDK treats remote fetch failures as non-fatal: an attacker who
        // blocks the fetch endpoint would simply downgrade the map to the cached
        // version, not disable protection entirely.
      }
    }
    return this.loadCached();
  }

  /**
   * Persist a policy map to encrypted storage.
   *
   * Call this directly when doing a background refresh (e.g. a push
   * notification instructs the app to fetch updated policies). The next
   * call to load() will pick up the persisted map if the remote fetch fails.
   */
  async persist(map: PolicyMap): Promise<void> {
    await this.storage.set(STORAGE_KEY, JSON.stringify(map));
  }

  /**
   * Clear the persisted cache.
   *
   * After clearing, the next load() that cannot reach the remote endpoint
   * will fall back to DEFAULT_POLICIES. Call this on user sign-out so that
   * a subsequent user's session gets a fresh policy fetch rather than
   * inheriting the previous user's cached map.
   */
  async clear(): Promise<void> {
    await this.storage.remove(STORAGE_KEY);
  }

  // ── private ──────────────────────────────────────────────────────────────

  /**
   * Read and parse the cached policy map from encrypted storage.
   *
   * Returns DEFAULT_POLICIES if the cache is empty or contains invalid JSON.
   * The parse failure case is important: if a previous version wrote an
   * incompatible format, the fallback to defaults is safe — the SDK will
   * re-fetch and overwrite the invalid cache on the next successful network
   * call.
   */
  private async loadCached(): Promise<PolicyMap> {
    const raw = await this.storage.get(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_POLICIES };
    try {
      return JSON.parse(raw) as PolicyMap;
    } catch {
      // Corrupt or incompatible cached data — discard and use defaults.
      return { ...DEFAULT_POLICIES };
    }
  }

  /**
   * Fetch the policy map from the remote endpoint.
   *
   * Throws on any network error or non-2xx HTTP status so the caller can
   * fall through to the cache. Does not set a timeout — relies on the
   * platform's default connection timeout (typically 30–60 s on mobile).
   * Tenants with strict SLAs should wrap the fetch in a Promise.race with
   * a timeout if needed.
   */
  private async fetchRemote(url: string): Promise<PolicyMap> {
    const response = await fetch(url, {
      method:  'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`policy fetch failed: HTTP ${response.status}`);
    }
    return (await response.json()) as PolicyMap;
  }
}
