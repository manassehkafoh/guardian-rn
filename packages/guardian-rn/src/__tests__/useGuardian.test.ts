import { renderHook } from '@testing-library/react-hooks';
import { useGuardian } from '../hooks/useGuardian.js';
import type { EngineContext, Engine } from '../engine/Engine.js';
import type { GuardianConfig } from '../config/GuardianConfig.js';
import type { Observable, Observer, Subscription } from '../types/Observable.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

class DummyObservable<T> implements Observable<T> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  subscribe(_observer: Observer<T>): Subscription {
    return { unsubscribe: () => {} };
  }
}

describe('useGuardian', () => {
  it('calls ctx.onFault when engine start throws an error', async () => {
    let onFaultSpy: jest.SpyInstance | undefined;

    const mockEngine: Engine = {
      id: 'test-engine@1.0.0',
      onThreat: new DummyObservable(),
      onHealthTick: new DummyObservable(),
      start: jest.fn().mockImplementation(async (ctx: EngineContext) => {
        onFaultSpy = jest.spyOn(ctx, 'onFault');
        throw new Error('Test Engine Error');
      }),
      stop: jest.fn().mockResolvedValue(undefined),
    };

    const config: GuardianConfig = {
      tenantId: 'test-tenant',
      actions: {},
      engines: [mockEngine],
    };

    // Suppress console.error so it doesn't clutter test output
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    renderHook(() => useGuardian(config));

    // Wait for microtasks to flush so the async startAll completes
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockEngine.start).toHaveBeenCalled();
    expect(onFaultSpy).toBeDefined();
    expect(onFaultSpy).toHaveBeenCalledWith(expect.any(Error));
    expect(onFaultSpy!.mock.calls[0][0].message).toBe('Test Engine Error');
    expect(consoleSpy).toHaveBeenCalledWith('[guardian] engine fault:', expect.any(Error));

    consoleSpy.mockRestore();
  });
});
