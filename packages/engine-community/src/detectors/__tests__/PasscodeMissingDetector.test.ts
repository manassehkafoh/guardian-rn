import { PasscodeMissingDetector } from '../PasscodeMissingDetector.js';

describe('PasscodeMissingDetector', () => {
  let detector: PasscodeMissingDetector;

  beforeEach(() => {
    jest.resetModules();
    delete process.env['GUARDIAN_SIMULATE_PASSCODE_MISSING'];
    detector = new PasscodeMissingDetector();
  });

  test('simulated passcode missing', async () => {
    process.env['GUARDIAN_SIMULATE_PASSCODE_MISSING'] = '1';
    const result = await detector.run();
    expect(result).toEqual({
      detected: true,
      confidence: 1.0,
      evidence: { method: 'simulated' },
    });
  });

  test('detects when passcode is NOT set', async () => {
    jest.doMock('react-native', () => ({
      NativeModules: {
        GuardianDeviceAuth: {
          isPasscodeSet: jest.fn().mockResolvedValue(false),
        },
      },
    }), { virtual: true });

    const result = await detector.run();
    expect(result).toEqual({
      detected: true,
      confidence: 1.0,
      evidence: { passcodeSet: 'false' },
    });
  });

  test('detects when passcode IS set', async () => {
    jest.doMock('react-native', () => ({
      NativeModules: {
        GuardianDeviceAuth: {
          isPasscodeSet: jest.fn().mockResolvedValue(true),
        },
      },
    }), { virtual: true });

    const result = await detector.run();
    expect(result).toEqual({
      detected: false,
      confidence: 0.0,
      evidence: { passcodeSet: 'true' },
    });
  });

  test('returns fallback if isPasscodeSet returns null', async () => {
    jest.doMock('react-native', () => ({
      NativeModules: {
        GuardianDeviceAuth: {
          isPasscodeSet: jest.fn().mockResolvedValue(null),
        },
      },
    }), { virtual: true });

    const result = await detector.run();
    expect(result).toEqual({
      detected: false,
      confidence: 0.1,
      evidence: { method: 'js-stub' },
    });
  });

  test('returns fallback if require throws', async () => {
    jest.doMock('react-native', () => {
      throw new Error('Module not found');
    }, { virtual: true });

    const result = await detector.run();
    expect(result).toEqual({
      detected: false,
      confidence: 0.1,
      evidence: { method: 'js-stub' },
    });
  });

  test('returns fallback if isPasscodeSet throws', async () => {
    jest.doMock('react-native', () => ({
      NativeModules: {
        GuardianDeviceAuth: {
          isPasscodeSet: jest.fn().mockRejectedValue(new Error('Native error')),
        },
      },
    }), { virtual: true });

    const result = await detector.run();
    expect(result).toEqual({
      detected: false,
      confidence: 0.1,
      evidence: { method: 'js-stub' },
    });
  });
});
