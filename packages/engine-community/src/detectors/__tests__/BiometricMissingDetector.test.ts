import { BiometricMissingDetector } from '../BiometricMissingDetector.js';

const mockIsBiometricEnrolled = jest.fn();

jest.mock('react-native', () => ({
  NativeModules: {
    GuardianDeviceAuth: {
      get isBiometricEnrolled() { return mockIsBiometricEnrolled; }
    },
  },
}));

describe('BiometricMissingDetector', () => {
  let detector: BiometricMissingDetector;

  beforeEach(() => {
    detector = new BiometricMissingDetector();
    delete process.env['GUARDIAN_SIMULATE_BIOMETRIC_MISSING'];
    mockIsBiometricEnrolled.mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('returns simulated threat if GUARDIAN_SIMULATE_BIOMETRIC_MISSING is 1', async () => {
    process.env['GUARDIAN_SIMULATE_BIOMETRIC_MISSING'] = '1';

    const result = await detector.run();

    expect(result).toEqual({
      detected: true,
      confidence: 0.9,
      evidence: { method: 'simulated' },
    });
    expect(mockIsBiometricEnrolled).not.toHaveBeenCalled();
  });

  test('returns detected: false with confidence 0.0 if biometric is enrolled', async () => {
    mockIsBiometricEnrolled.mockResolvedValue(true);

    const result = await detector.run();

    expect(result).toEqual({
      detected: false,
      confidence: 0.0,
      evidence: { biometricEnrolled: 'true' },
    });
    expect(mockIsBiometricEnrolled).toHaveBeenCalledTimes(1);
  });

  test('returns detected: true with confidence 0.9 if biometric is not enrolled', async () => {
    mockIsBiometricEnrolled.mockResolvedValue(false);

    const result = await detector.run();

    expect(result).toEqual({
      detected: true,
      confidence: 0.9,
      evidence: { biometricEnrolled: 'false' },
    });
    expect(mockIsBiometricEnrolled).toHaveBeenCalledTimes(1);
  });

  test('returns js-stub fallback if enrolled is null', async () => {
    mockIsBiometricEnrolled.mockResolvedValue(null);

    const result = await detector.run();

    expect(result).toEqual({
      detected: false,
      confidence: 0.1,
      evidence: { method: 'js-stub' },
    });
    expect(mockIsBiometricEnrolled).toHaveBeenCalledTimes(1);
  });

  test('returns js-stub fallback if react-native require throws', async () => {
    jest.resetModules();
    jest.doMock('react-native', () => {
      throw new Error('Module not found');
    });

    const { BiometricMissingDetector: ReimportedDetector } = await import('../BiometricMissingDetector.js');
    const newDetector = new ReimportedDetector();

    const result = await newDetector.run();

    expect(result).toEqual({
      detected: false,
      confidence: 0.1,
      evidence: { method: 'js-stub' },
    });
  });

  test('returns js-stub fallback if isBiometricEnrolled throws', async () => {
    // We need to re-mock or reset the original mock carefully for this specific case
    // to avoid the state leak from the previous test causing `mockIsBiometricEnrolled` not being called
    // Let's just use the original detector and mockIsBiometricEnrolled since resetModules might have broken the link.
    // wait, resetModules in the previous test removed the caching for the NEXT test!

    // So we resetModules and setup the mock again properly for THIS test.
    jest.resetModules();
    const localMock = jest.fn().mockRejectedValue(new Error('Native code error'));
    jest.doMock('react-native', () => ({
      NativeModules: {
        GuardianDeviceAuth: {
          isBiometricEnrolled: localMock
        }
      }
    }));

    const { BiometricMissingDetector: ReimportedDetector } = await import('../BiometricMissingDetector.js');
    const newDetector = new ReimportedDetector();

    const result = await newDetector.run();

    expect(result).toEqual({
      detected: false,
      confidence: 0.1,
      evidence: { method: 'js-stub' },
    });
    expect(localMock).toHaveBeenCalledTimes(1);
  });
});
