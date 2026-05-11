import { InMemoryEncryptedStorage } from '../storage/EncryptedStoragePort.js';

describe('InMemoryEncryptedStorage', () => {
  test('set and get round-trips a value', async () => {
    const store = new InMemoryEncryptedStorage();
    await store.set('session', 'abc123');
    expect(await store.get('session')).toBe('abc123');
  });

  test('get returns null for unknown key', async () => {
    const store = new InMemoryEncryptedStorage();
    expect(await store.get('missing')).toBeNull();
  });

  test('remove deletes the key', async () => {
    const store = new InMemoryEncryptedStorage();
    await store.set('key', 'val');
    await store.remove('key');
    expect(await store.get('key')).toBeNull();
  });

  test('clear wipes all keys', async () => {
    const store = new InMemoryEncryptedStorage();
    await store.set('a', '1');
    await store.set('b', '2');
    await store.clear();
    expect(await store.get('a')).toBeNull();
    expect(await store.get('b')).toBeNull();
  });

  test('overwriting a key updates the value', async () => {
    const store = new InMemoryEncryptedStorage();
    await store.set('token', 'v1');
    await store.set('token', 'v2');
    expect(await store.get('token')).toBe('v2');
  });
});
