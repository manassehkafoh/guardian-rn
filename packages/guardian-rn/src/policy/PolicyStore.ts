import type { ThreatId } from '../generated/ThreatId.js';
import type { ResponsePolicy } from '../generated/ResponsePolicy.js';
import type { EncryptedStoragePort } from '../storage/EncryptedStoragePort.js';
import { DEFAULT_POLICIES } from '../core/policy.js';

const STORAGE_KEY = 'guardian:policy-store:v1';

export type PolicyMap = Partial<Record<ThreatId, ResponsePolicy>>;

/**
 * Offline-resilient policy cache per ADR-0017.
 *
 * On startup, PolicyStore attempts to fetch fresh policies from
 * `policyEndpoint`. On success it persists them to EncryptedStoragePort
 * and returns them. On failure (network unreachable, 4xx/5xx) it falls
 * back to the last persisted map. If no persisted map exists it falls
 * back to DEFAULT_POLICIES.
 *
 * The fetch is advisory — the SDK never blocks on it. Callers receive
 * the best-available policy map immediately via `load()`.
 */
export class PolicyStore {
  private readonly storage: EncryptedStoragePort;
  private readonly endpoint: string | undefined;

  constructor(storage: EncryptedStoragePort, endpoint?: string) {
    this.storage = storage;
    this.endpoint = endpoint;
  }

  /**
   * Returns the most authoritative policy map available.
   * Order of preference: remote fetch → cached → DEFAULT_POLICIES.
   */
  async load(): Promise<PolicyMap> {
    if (this.endpoint) {
      try {
        const remote = await this.fetchRemote(this.endpoint);
        await this.persist(remote);
        return remote;
      } catch {
        // Network or parse failure — fall through to cache
      }
    }
    return this.loadCached();
  }

  /** Persist a policy map explicitly (e.g. after a background refresh). */
  async persist(map: PolicyMap): Promise<void> {
    await this.storage.set(STORAGE_KEY, JSON.stringify(map));
  }

  /** Clear the persisted cache (e.g. on sign-out). */
  async clear(): Promise<void> {
    await this.storage.remove(STORAGE_KEY);
  }

  // ── private ──────────────────────────────────────────────────────────────

  private async loadCached(): Promise<PolicyMap> {
    const raw = await this.storage.get(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_POLICIES };
    try {
      const parsed = JSON.parse(raw) as PolicyMap;
      return parsed;
    } catch {
      return { ...DEFAULT_POLICIES };
    }
  }

  private async fetchRemote(url: string): Promise<PolicyMap> {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`policy fetch failed: ${response.status}`);
    const data = (await response.json()) as PolicyMap;
    return data;
  }
}
