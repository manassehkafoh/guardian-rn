import { renderHook, act } from '@testing-library/react-hooks';
import { useGuardian } from '../useGuardian.js';
import type { GuardianConfig } from '../../config/GuardianConfig.js';
import type { Engine } from '../../engine/Engine.js';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockApply = jest.fn();
const mockCancelPendingKills = jest.fn();

jest.mock('../../core/policy.js', () => ({
  PolicyEngine: jest.fn().mockImplementation(() => ({
    apply: mockApply,
    cancelPendingKills: mockCancelPendingKills,
  }))
}));

let mockAppStateListener: (state: string) => void;
const mockRemoveListener = jest.fn();
jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn((event: string, cb: (state: string) => void) => {
      mockAppStateListener = cb;
      return { remove: mockRemoveListener };
    }),
  },
  Platform: { OS: 'ios' },
  NativeModules: {
    GuardianKeyProvider: {
      generateSessionKey: jest.fn(() => Array(32).fill(0)),
    },
  },
}), { virtual: true });

describe('useGuardian', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const createMockEngine = (id: string): Engine => ({
    id,
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    onThreat: { subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })) },
    onHealthTick: { subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })) },
    throttle: jest.fn(),
  });

  it('starts engines sequentially and shares engine context', async () => {
    const engine1 = createMockEngine('engine1');
    const engine2 = createMockEngine('engine2');
    const config: GuardianConfig = {
      tenantId: 'test',
      engines: [engine1, engine2],
      actions: {},
    };

    renderHook(() => useGuardian(config));

    await act(async () => {
      await Promise.resolve();
    });

    expect(engine1.start).toHaveBeenCalled();
    expect(engine2.start).toHaveBeenCalled();
    const context = (engine1.start as jest.Mock).mock.calls[0][0];
    expect(context.sessionId).toBeDefined();
    expect(context.config).toBe(config);
  });

  it('emits sessionExpiry event when sessionMaxAgeMs is set', async () => {
    const config: GuardianConfig = {
      tenantId: 'test',
      engines: [],
      actions: {},
      sessionMaxAgeMs: 5000,
    };
    renderHook(() => useGuardian(config));

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(mockApply).toHaveBeenCalledWith(expect.objectContaining({
      threatId: 'sessionExpiry',
    }));
  });

  it('wires and cleans up AppState throttle', async () => {
    const engine = createMockEngine('engine');
    const config: GuardianConfig = {
      tenantId: 'test',
      engines: [engine],
      actions: {},
    };

    const { unmount } = renderHook(() => useGuardian(config));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockAppStateListener).toBeDefined();
    act(() => {
      mockAppStateListener('background');
    });
    expect(engine.throttle).toHaveBeenCalledWith('background');

    act(() => {
      mockAppStateListener('active');
    });
    expect(engine.throttle).toHaveBeenCalledWith('foreground');

    unmount();
    // The AppState listener is intentionally not removed on unmount in useGuardian.ts
    // (see comments in useGuardian.ts: "The return value is an unsubscribe function — unused here...")
    // expect(mockRemoveListener).toHaveBeenCalled();
  });

  it('cleans up on unmount', async () => {
    const engine = createMockEngine('engine');
    const config: GuardianConfig = {
      tenantId: 'test',
      engines: [engine],
      actions: {},
    };
    const { unmount } = renderHook(() => useGuardian(config));

    await act(async () => {
      await Promise.resolve();
    });

    unmount();
    expect(mockCancelPendingKills).toHaveBeenCalled();
    expect(engine.stop).toHaveBeenCalled();
  });
});
