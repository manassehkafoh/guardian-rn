import { renderHook } from '@testing-library/react-hooks';
import { useThreatHandler, __setGlobalSubscribe } from '../useThreatHandler.js';
import type { ThreatEvent } from '../../events/ThreatEvent.js';
import type { ThreatId } from '../../generated/ThreatId.js';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('useThreatHandler', () => {
  let mockSubscribe: jest.Mock;
  let mockUnsubscribe: jest.Mock;
  let registeredHandlers: Record<string, (e: ThreatEvent) => void>;

  beforeEach(() => {
    mockUnsubscribe = jest.fn();
    registeredHandlers = {};

    mockSubscribe = jest.fn((threatId: ThreatId, handler: (e: ThreatEvent) => void) => {
      registeredHandlers[threatId] = handler;
      return mockUnsubscribe;
    });

    __setGlobalSubscribe(mockSubscribe);
  });

  afterEach(() => {
    __setGlobalSubscribe(null as any);
  });

  it('registers handlers for provided threat IDs', () => {
    const handlers = {
      'root': jest.fn(),
      'hooks': jest.fn(),
    } as Partial<Record<ThreatId, (e: ThreatEvent) => void>>;

    renderHook(() => useThreatHandler(handlers));

    expect(mockSubscribe).toHaveBeenCalledTimes(2);
    expect(mockSubscribe).toHaveBeenCalledWith('root', expect.any(Function));
    expect(mockSubscribe).toHaveBeenCalledWith('hooks', expect.any(Function));
  });

  it('calls the corresponding handler when an event is published', () => {
    const mockRootHandler = jest.fn();
    const mockHooksHandler = jest.fn();

    const handlers = {
      'root': mockRootHandler,
      'hooks': mockHooksHandler,
    } as Partial<Record<ThreatId, (e: ThreatEvent) => void>>;

    renderHook(() => useThreatHandler(handlers));

    const mockEvent: ThreatEvent = {
      threatId: 'root',
      severity: 'high',
      confidence: 1.0,
      evidence: {},
      ts: 123456789,
      engineId: 'test',
    };

    // Simulate an event being published
    registeredHandlers['root']!(mockEvent);

    expect(mockRootHandler).toHaveBeenCalledTimes(1);
    expect(mockRootHandler).toHaveBeenCalledWith(mockEvent);
    expect(mockHooksHandler).not.toHaveBeenCalled();
  });

  it('always calls the latest handler reference without resubscribing', () => {
    const initialHandler = jest.fn();
    const updatedHandler = jest.fn();

    let currentHandlers = {
      'root': initialHandler,
    } as Partial<Record<ThreatId, (e: ThreatEvent) => void>>;

    const { rerender } = renderHook(() => useThreatHandler(currentHandlers));

    const mockEvent: ThreatEvent = {
      threatId: 'root',
      severity: 'high',
      confidence: 1.0,
      evidence: {},
      ts: 123456789,
      engineId: 'test',
    };

    // First render calls initial handler
    registeredHandlers['root']!(mockEvent);
    expect(initialHandler).toHaveBeenCalledTimes(1);

    // Update handlers and rerender
    currentHandlers = {
      'root': updatedHandler,
    } as Partial<Record<ThreatId, (e: ThreatEvent) => void>>;
    rerender();

    // Subscribe shouldn't be called again
    expect(mockSubscribe).toHaveBeenCalledTimes(1);

    // Trigger event again
    registeredHandlers['root']!(mockEvent);

    // Initial handler shouldn't be called again
    expect(initialHandler).toHaveBeenCalledTimes(1);

    // Updated handler should be called
    expect(updatedHandler).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes from all handlers on unmount', () => {
    const handlers = {
      'root': jest.fn(),
      'hooks': jest.fn(),
    } as Partial<Record<ThreatId, (e: ThreatEvent) => void>>;

    const { unmount } = renderHook(() => useThreatHandler(handlers));

    expect(mockUnsubscribe).not.toHaveBeenCalled();

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalledTimes(2);
  });

  it('does not throw when globalSubscribe is not initialized', () => {
    // Override beforeEach behavior for this specific test
    __setGlobalSubscribe(null as any);

    const handlers = {
      'root': jest.fn(),
    } as Partial<Record<ThreatId, (e: ThreatEvent) => void>>;

    const { unmount } = renderHook(() => useThreatHandler(handlers));

    // Unmounting should trigger the no-op unsubscribe without throwing
    expect(() => unmount()).not.toThrow();
  });
});
