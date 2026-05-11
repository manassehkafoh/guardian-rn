import { PolicyStore } from '../policy/PolicyStore.js';
import { InMemoryEncryptedStorage } from '../storage/EncryptedStoragePort.js';
import { DEFAULT_POLICIES } from '../core/policy.js';

describe('PolicyStore', () => {
  test('returns DEFAULT_POLICIES when storage is empty and no endpoint', async () => {
    const store = new PolicyStore(new InMemoryEncryptedStorage());
    const policies = await store.load();
    expect(policies).toEqual(DEFAULT_POLICIES);
  });

  test('persist + load round-trips the policy map', async () => {
    const storage = new InMemoryEncryptedStorage();
    const store = new PolicyStore(storage);
    const custom = { root: 'kill' as const, emulator: 'restrict' as const };
    await store.persist(custom);
    const loaded = await store.load();
    expect(loaded).toEqual(custom);
  });

  test('clear removes cached policies and falls back to DEFAULT_POLICIES', async () => {
    const storage = new InMemoryEncryptedStorage();
    const store = new PolicyStore(storage);
    await store.persist({ root: 'kill' as const });
    await store.clear();
    const loaded = await store.load();
    expect(loaded).toEqual(DEFAULT_POLICIES);
  });

  test('corrupt storage falls back to DEFAULT_POLICIES', async () => {
    const storage = new InMemoryEncryptedStorage();
    await storage.set('guardian:policy-store:v1', '{{invalid json}}');
    const store = new PolicyStore(storage);
    const loaded = await store.load();
    expect(loaded).toEqual(DEFAULT_POLICIES);
  });

  test('remote fetch success persists and returns remote policies', async () => {
    const storage = new InMemoryEncryptedStorage();
    const remoteMap = { jailbreak: 'kill' as const };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => remoteMap,
    }) as jest.MockedFunction<typeof fetch>;

    const store = new PolicyStore(storage, 'https://guardian.example.com/policies');
    const loaded = await store.load();
    expect(loaded).toEqual(remoteMap);

    // Should also be persisted for offline use
    const cached = await new PolicyStore(storage).load();
    expect(cached).toEqual(remoteMap);
  });

  test('remote fetch failure falls back to cached policies', async () => {
    const storage = new InMemoryEncryptedStorage();
    const cachedMap = { debugger: 'restrict' as const };
    await storage.set('guardian:policy-store:v1', JSON.stringify(cachedMap));

    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const store = new PolicyStore(storage, 'https://guardian.example.com/policies');
    const loaded = await store.load();
    expect(loaded).toEqual(cachedMap);
  });

  test('remote 4xx falls back to cached policies', async () => {
    const storage = new InMemoryEncryptedStorage();
    const cachedMap = { root: 'lockout' as const };
    await storage.set('guardian:policy-store:v1', JSON.stringify(cachedMap));

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
    }) as jest.MockedFunction<typeof fetch>;

    const store = new PolicyStore(storage, 'https://guardian.example.com/policies');
    const loaded = await store.load();
    expect(loaded).toEqual(cachedMap);
  });
});
