import { generateSessionKey } from '../useGuardian';

const mockGenerateSessionKey = jest.fn();
let mockNativeModules: any = {};

// When simulating throwing requires, doMock is typically better
// or overriding the require within the try block but we can mock it here
jest.mock('react-native', () => {
  return {
    get NativeModules() {
      if ((globalThis as any).SIMULATE_RN_THROW) {
         throw new Error('Cannot find module react-native');
      }
      return mockNativeModules;
    }
  }
}, { virtual: true });

describe('generateSessionKey', () => {
  beforeEach(() => {
    mockNativeModules = {};
    (globalThis as any).SIMULATE_RN_THROW = false;
    jest.clearAllMocks();
  });

  afterAll(() => {
    delete (globalThis as any).SIMULATE_RN_THROW;
  });

  it('uses NativeModules.GuardianKeyProvider when available and valid', () => {
    mockNativeModules.GuardianKeyProvider = {
      generateSessionKey: mockGenerateSessionKey.mockReturnValue(new Array(32).fill(42))
    };
    const key = generateSessionKey();
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
    expect(key[0]).toBe(42);
    expect(mockGenerateSessionKey).toHaveBeenCalled();
  });

  it('falls back to Math.random when GuardianKeyProvider is undefined', () => {
    mockNativeModules.GuardianKeyProvider = undefined;
    const mathRandomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.25);

    const key = generateSessionKey();
    expect(key.length).toBe(32);
    expect(key[0]).toBe(64); // 0.25 * 256 = 64
    expect(mathRandomSpy).toHaveBeenCalledTimes(32);

    mathRandomSpy.mockRestore();
  });

  it('falls back to Math.random when GuardianKeyProvider returns invalid length', () => {
    mockNativeModules.GuardianKeyProvider = {
      generateSessionKey: mockGenerateSessionKey.mockReturnValue(new Array(31).fill(42))
    };
    const mathRandomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const key = generateSessionKey();
    expect(key.length).toBe(32);
    expect(key[0]).toBe(128); // 0.5 * 256 = 128
    expect(mathRandomSpy).toHaveBeenCalledTimes(32);

    mathRandomSpy.mockRestore();
  });

  it('falls back to Math.random when require("react-native") throws', () => {
    (globalThis as any).SIMULATE_RN_THROW = true;
    const mathRandomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.75);

    const key = generateSessionKey();
    expect(key.length).toBe(32);
    expect(key[0]).toBe(192); // 0.75 * 256 = 192
    expect(mathRandomSpy).toHaveBeenCalledTimes(32);

    mathRandomSpy.mockRestore();
  });
});
