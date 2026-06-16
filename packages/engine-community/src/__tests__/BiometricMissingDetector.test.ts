import { BiometricMissingDetector } from '../detectors/BiometricMissingDetector.js';

describe('BiometricMissingDetector', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env['GUARDIAN_SIMULATE_BIOMETRIC_MISSING'];
  });

  test('simulated threat is detected', async () => {
    process.env['GUARDIAN_SIMULATE_BIOMETRIC_MISSING'] = '1';
    const detector = new BiometricMissingDetector();
    const result = await detector.run();
    expect(result).toEqual({
      detected: true,
      confidence: 0.9,
      evidence: { method: 'simulated' },
    });
  });

  test('enrolled returns false threat', async () => {
    jest.doMock('react-native', () => ({
      NativeModules: {
        GuardianDeviceAuth: {
          isBiometricEnrolled: jest.fn().mockResolvedValue(true),
        },
      },
    }));

    const { BiometricMissingDetector: DynamicDetector } = await import('../detectors/BiometricMissingDetector.js');
    const detector = new DynamicDetector();
    const result = await detector.run();

    expect(result).toEqual({
      detected: false,
      confidence: 0.0,
      evidence: { biometricEnrolled: 'true' },
    });
  });

  test('not enrolled returns true threat', async () => {
    jest.doMock('react-native', () => ({
      NativeModules: {
        GuardianDeviceAuth: {
          isBiometricEnrolled: jest.fn().mockResolvedValue(false),
        },
      },
    }));

    const { BiometricMissingDetector: DynamicDetector } = await import('../detectors/BiometricMissingDetector.js');
    const detector = new DynamicDetector();
    const result = await detector.run();

    expect(result).toEqual({
      detected: true,
      confidence: 0.9,
      evidence: { biometricEnrolled: 'false' },
    });
  });

  test('missing NativeModule returns js-stub', async () => {
    jest.doMock('react-native', () => ({
      NativeModules: {},
    }));

    const { BiometricMissingDetector: DynamicDetector } = await import('../detectors/BiometricMissingDetector.js');
    const detector = new DynamicDetector();
    const result = await detector.run();

    expect(result).toEqual({
      detected: false,
      confidence: 0.1,
      evidence: { method: 'js-stub' },
    });
  });

  test('missing isBiometricEnrolled returns js-stub', async () => {
    jest.doMock('react-native', () => ({
      NativeModules: {
        GuardianDeviceAuth: {},
      },
    }));

    const { BiometricMissingDetector: DynamicDetector } = await import('../detectors/BiometricMissingDetector.js');
    const detector = new DynamicDetector();
    const result = await detector.run();

    expect(result).toEqual({
      detected: false,
      confidence: 0.1,
      evidence: { method: 'js-stub' },
    });
  });

  test('null enrolled returns js-stub', async () => {
    jest.doMock('react-native', () => ({
      NativeModules: {
        GuardianDeviceAuth: {
          isBiometricEnrolled: jest.fn().mockResolvedValue(null),
        },
      },
    }));

    const { BiometricMissingDetector: DynamicDetector } = await import('../detectors/BiometricMissingDetector.js');
    const detector = new DynamicDetector();
    const result = await detector.run();

    expect(result).toEqual({
      detected: false,
      confidence: 0.1,
      evidence: { method: 'js-stub' },
    });
  });

  test('throws exception returns js-stub', async () => {
    jest.doMock('react-native', () => ({
      NativeModules: {
        GuardianDeviceAuth: {
          isBiometricEnrolled: jest.fn().mockRejectedValue(new Error('Native failure')),
        },
      },
    }));

    const { BiometricMissingDetector: DynamicDetector } = await import('../detectors/BiometricMissingDetector.js');
    const detector = new DynamicDetector();
    const result = await detector.run();

    expect(result).toEqual({
      detected: false,
      confidence: 0.1,
      evidence: { method: 'js-stub' },
    });
  });
});
