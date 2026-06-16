import { ManagedProfileDetector } from '../ManagedProfileDetector.js';
import { NativeModules } from 'react-native';

jest.mock('react-native', () => ({
  NativeModules: {
    GuardianManagedProfile: {
      isRunningInManagedProfile: jest.fn(),
      getProfileOwnerPackage: jest.fn(),
    },
  },
}));

describe('ManagedProfileDetector', () => {
  let detector: ManagedProfileDetector;

  beforeEach(() => {
    detector = new ManagedProfileDetector();
    delete process.env['GUARDIAN_SIMULATE_MANAGED_PROFILE'];
    jest.clearAllMocks();
  });

  it('should detect simulated managed profile', async () => {
    process.env['GUARDIAN_SIMULATE_MANAGED_PROFILE'] = '1';
    const result = await detector.run();
    expect(result).toEqual({
      detected: true,
      confidence: 0.8,
      evidence: { method: 'simulated', profileOwner: 'com.example.mdm' },
    });
  });

  it('should fall back to js-stub if native module throws an error', async () => {
    (NativeModules.GuardianManagedProfile.isRunningInManagedProfile as jest.Mock).mockRejectedValue(new Error('Test error'));

    const result = await detector.run();
    expect(result).toEqual({ detected: false, confidence: 0.0, evidence: { method: 'js-stub' } });
  });

  it('should return detected: false when isRunningInManagedProfile returns null', async () => {
    (NativeModules.GuardianManagedProfile.isRunningInManagedProfile as jest.Mock).mockResolvedValue(null);

    const result = await detector.run();
    expect(result).toEqual({ detected: false, confidence: 0.0, evidence: { method: 'js-stub' } });
  });

  it('should return detected: true when isRunningInManagedProfile returns true', async () => {
    (NativeModules.GuardianManagedProfile.isRunningInManagedProfile as jest.Mock).mockResolvedValue(true);
    (NativeModules.GuardianManagedProfile.getProfileOwnerPackage as jest.Mock).mockResolvedValue('com.mdm.test');

    const result = await detector.run();
    expect(result).toEqual({
      detected: true,
      confidence: 0.8,
      evidence: { managed: 'true', profileOwner: 'com.mdm.test' },
    });
  });

  it('should default owner to unknown when getProfileOwnerPackage returns null', async () => {
    (NativeModules.GuardianManagedProfile.isRunningInManagedProfile as jest.Mock).mockResolvedValue(true);
    (NativeModules.GuardianManagedProfile.getProfileOwnerPackage as jest.Mock).mockResolvedValue(null);

    const result = await detector.run();
    expect(result).toEqual({
      detected: true,
      confidence: 0.8,
      evidence: { managed: 'true', profileOwner: 'unknown' },
    });
  });

  it('should return detected: false when isRunningInManagedProfile returns false', async () => {
    (NativeModules.GuardianManagedProfile.isRunningInManagedProfile as jest.Mock).mockResolvedValue(false);
    (NativeModules.GuardianManagedProfile.getProfileOwnerPackage as jest.Mock).mockResolvedValue(null);

    const result = await detector.run();
    expect(result).toEqual({
      detected: false,
      confidence: 0.0,
      evidence: { managed: 'false', profileOwner: 'unknown' },
    });
  });
});
