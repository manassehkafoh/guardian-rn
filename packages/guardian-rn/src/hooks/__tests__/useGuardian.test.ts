describe('useGuardian - generateSessionKey fallback', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses native GuardianKeyProvider if available and returns exactly 32 bytes', () => {
    const mockNativeKey = new Array(32).fill(42);
    jest.doMock('react-native', () => ({
      NativeModules: {
        GuardianKeyProvider: {
          generateSessionKey: jest.fn().mockReturnValue(mockNativeKey),
        },
      },
    }), { virtual: true });

    // Re-import to pick up the new mock
    const { generateSessionKey: generateKeyMocked } = require('../useGuardian.js');
    const key = generateKeyMocked();

    expect(key).toBeInstanceOf(Uint8Array);
    expect(key).toHaveLength(32);
    expect(Array.from(key)).toEqual(mockNativeKey);
  });

  it('falls back to Math.random when NativeModules.GuardianKeyProvider is missing', () => {
    jest.doMock('react-native', () => ({
      NativeModules: {},
    }), { virtual: true });

    // Re-import to pick up the new mock
    const { generateSessionKey: generateKeyMocked } = require('../useGuardian.js');

    // We mock Math.random to verify it's called
    const mathRandomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const key = generateKeyMocked();

    expect(key).toBeInstanceOf(Uint8Array);
    expect(key).toHaveLength(32);
    expect(mathRandomSpy).toHaveBeenCalledTimes(32);

    // 0.5 * 256 = 128
    expect(key[0]).toBe(128);
  });

  it('falls back to Math.random when react-native require fails', () => {
    // Tell jest to throw an error when requiring react-native
    jest.doMock('react-native', () => {
      throw new Error('Module not found');
    }, { virtual: true });

    // Re-import to pick up the new mock
    const { generateSessionKey: generateKeyMocked } = require('../useGuardian.js');

    // We mock Math.random to verify it's called
    const mathRandomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.25);

    const key = generateKeyMocked();

    expect(key).toBeInstanceOf(Uint8Array);
    expect(key).toHaveLength(32);
    expect(mathRandomSpy).toHaveBeenCalledTimes(32);

    // 0.25 * 256 = 64
    expect(key[0]).toBe(64);
  });

  it('falls back to Math.random when generateSessionKey returns invalid length', () => {
    const mockNativeKeyInvalidLength = new Array(16).fill(42); // Not 32 bytes
    jest.doMock('react-native', () => ({
      NativeModules: {
        GuardianKeyProvider: {
          generateSessionKey: jest.fn().mockReturnValue(mockNativeKeyInvalidLength),
        },
      },
    }), { virtual: true });

    const { generateSessionKey: generateKeyMocked } = require('../useGuardian.js');

    const mathRandomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.1);

    const key = generateKeyMocked();

    expect(key).toBeInstanceOf(Uint8Array);
    expect(key).toHaveLength(32);
    expect(mathRandomSpy).toHaveBeenCalledTimes(32);
    expect(key[0]).toBe((0.1 * 256) | 0);
  });
});
