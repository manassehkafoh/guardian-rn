import { renderHook } from '@testing-library/react-native';
import { useGuardian } from '../useGuardian';
import { PolicyEngine } from '../../core/policy';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Mock the PolicyEngine since it's instantiated inside the hook
const mockApply = jest.fn();
const mockCancelPendingKills = jest.fn();

jest.mock('../../core/policy', () => {
  return {
    PolicyEngine: jest.fn().mockImplementation(() => ({
      apply: mockApply,
      cancelPendingKills: mockCancelPendingKills,
    })),
  };
});

// Mock react-native
jest.mock(
  'react-native',
  () => {
    return {
      Platform: { OS: 'ios' },
      AppState: {
        addEventListener: jest.fn(() => ({
          remove: jest.fn(),
        })),
      },
      NativeModules: {
        GuardianKeyProvider: {
          generateSessionKey: jest.fn(() => Array.from({ length: 32 }, () => 1)),
        },
      },
    };
  },
  { virtual: true }
);

describe('useGuardian', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should initialize PolicyEngine and start all engines on mount', async () => {
    const mockEngine1 = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      onThreat: { subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }) },
      onHealthTick: { subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }) },
    };
    const mockEngine2 = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      onThreat: { subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }) },
      onHealthTick: { subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }) },
    };

    const config = {
      engines: [mockEngine1, mockEngine2],
    } as any;

    await renderHook(() => useGuardian(config));

    // Wait for the async startAll to complete
    await jest.runAllTimersAsync();

    expect(PolicyEngine).toHaveBeenCalledTimes(1);
    expect(mockEngine1.start).toHaveBeenCalledTimes(1);
    expect(mockEngine2.start).toHaveBeenCalledTimes(1);

    // Check ctx passed to start
    const ctxArg = mockEngine1.start.mock.calls[0][0];
    expect(ctxArg).toHaveProperty('sessionId');
    expect(ctxArg).toHaveProperty('platform', 'ios');
    expect(ctxArg).toHaveProperty('config', config);
  });

  it('should unsubscribe and stop engines on unmount', async () => {
    const mockThreatSub = { unsubscribe: jest.fn() };
    const mockHealthSub = { unsubscribe: jest.fn() };

    const mockEngine = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      onThreat: { subscribe: jest.fn().mockReturnValue(mockThreatSub) },
      onHealthTick: { subscribe: jest.fn().mockReturnValue(mockHealthSub) },
    };

    const config = {
      engines: [mockEngine],
    } as any;

    const { unmount } = await renderHook(() => useGuardian(config));

    await jest.runAllTimersAsync();

    await unmount();

    expect(mockThreatSub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(mockHealthSub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(mockEngine.stop).toHaveBeenCalledTimes(1);
  });

  it('should handle engine start failure gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const mockEngine1 = {
      start: jest.fn().mockRejectedValue(new Error('Engine failed')),
      stop: jest.fn().mockResolvedValue(undefined),
      onThreat: { subscribe: jest.fn() },
      onHealthTick: { subscribe: jest.fn() },
    };

    const mockEngine2 = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      onThreat: { subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }) },
      onHealthTick: { subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }) },
    };

    const config = {
      engines: [mockEngine1, mockEngine2],
    } as any;

    await renderHook(() => useGuardian(config));

    await jest.runAllTimersAsync();

    expect(mockEngine1.start).toHaveBeenCalledTimes(1);
    // Even if engine 1 fails, engine 2 should still start
    expect(mockEngine2.start).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith('[guardian] engine fault:', expect.any(Error));

    consoleSpy.mockRestore();
  });

  it('should schedule a sessionExpiry threat if sessionMaxAgeMs is configured', async () => {
    const mockEngine = {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      onThreat: { subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }) },
      onHealthTick: { subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }) },
    };

    const config = {
      engines: [mockEngine],
      sessionMaxAgeMs: 5000,
    } as any;

    await renderHook(() => useGuardian(config));

    await jest.runAllTimersAsync();

    jest.advanceTimersByTime(5000);

    expect(mockApply).toHaveBeenCalledWith(
      expect.objectContaining({
        threatId: 'sessionExpiry',
        severity: 'high',
        engineId: 'guardian-rn/session',
      })
    );
  });
});
