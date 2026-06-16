import { renderHook, act } from '@testing-library/react-hooks';
import { useGuardian } from '../hooks/useGuardian.js';
import type { GuardianConfig } from '../config/GuardianConfig.js';
import type { Engine } from '../engine/Engine.js';

describe('useGuardian', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('calls onFault when engine.start throws an error', async () => {
    const error = new Error('Engine startup failed');
    const startMock = jest.fn().mockRejectedValue(error);

    const mockEngine: Engine = {
      id: 'test-engine',
      start: startMock,
      stop: jest.fn().mockResolvedValue(undefined),
      onThreat: { subscribe: jest.fn() },
      onHealthTick: { subscribe: jest.fn() },
    };

    const config: GuardianConfig = {
      tenantId: 'test',
      engines: [mockEngine],
      actions: {},
    };

    renderHook(() => useGuardian(config));

    // Wait for the async startAll to run
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(startMock).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith('[guardian] engine fault:', error);
  });

  it('calls onFault with an Error object when engine.start throws a non-Error', async () => {
    const errorString = 'String error';
    const startMock = jest.fn().mockRejectedValue(errorString);

    const mockEngine: Engine = {
      id: 'test-engine',
      start: startMock,
      stop: jest.fn().mockResolvedValue(undefined),
      onThreat: { subscribe: jest.fn() },
      onHealthTick: { subscribe: jest.fn() },
    };

    const config: GuardianConfig = {
      tenantId: 'test',
      engines: [mockEngine],
      actions: {},
    };

    renderHook(() => useGuardian(config));

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(startMock).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith('[guardian] engine fault:', new Error(String(errorString)));
  });
});
