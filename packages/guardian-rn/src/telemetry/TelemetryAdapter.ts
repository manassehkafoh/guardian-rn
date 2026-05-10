import type { ThreatEvent } from '../events/ThreatEvent.js';
import type { EngineHealthTick } from '../engine/Engine.js';

export interface TelemetryAdapter {
  recordThreat(event: ThreatEvent): void;
  recordHealthTick(tick: EngineHealthTick): void;
  flush(): Promise<void>;
}
