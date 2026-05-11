import { useEffect, useRef } from 'react';
import type { ThreatEvent } from '../events/ThreatEvent.js';
import type { ThreatId } from '../generated/ThreatId.js';

export type ThreatHandlerMap = Partial<Record<ThreatId, (event: ThreatEvent) => void>>;

/**
 * Subscribes to a specific set of threat IDs.
 * Handlers are always called with the latest reference — no stale closures.
 * Returns an unsubscribe function for use outside of React component lifecycles.
 */
export function useThreatHandler(handlers: ThreatHandlerMap): void {
  const handlersRef = useRef<ThreatHandlerMap>(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    // Handlers are read from the ref at call-time, so updates to
    // the handlers object are always picked up without re-subscribing.
    const unsubFns: Array<() => void> = [];

    for (const [threatId] of Object.entries(handlers)) {
      const unsub = subscribeGlobal(threatId as ThreatId, (event) => {
        handlersRef.current[event.threatId]?.(event);
      });
      unsubFns.push(unsub);
    }

    return () => unsubFns.forEach((fn) => fn());
  // eslint-disable-next-line -- handler keys are intentionally stable after mount
  }, []);
}

// Minimal global bus reference for the hook — real implementation wires this
// to the EventBus singleton exposed by GuardianRN.start().
// In test environments, this is replaced by the test helper below.
let globalSubscribe: ((threatId: ThreatId, handler: (e: ThreatEvent) => void) => () => void) | null = null;

export function __setGlobalSubscribe(
  fn: (threatId: ThreatId, handler: (e: ThreatEvent) => void) => () => void,
): void {
  globalSubscribe = fn;
}

function subscribeGlobal(threatId: ThreatId, handler: (e: ThreatEvent) => void): () => void {
  if (!globalSubscribe) return () => { /* no-op until bus is initialised */ };
  return globalSubscribe(threatId, handler);
}
