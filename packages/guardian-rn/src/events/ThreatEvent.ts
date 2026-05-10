import type { ThreatId } from '../generated/ThreatId.js';
import type { Severity } from '../generated/Severity.js';

export interface ThreatEvent {
  readonly threatId: ThreatId;
  readonly severity: Severity;
  readonly confidence: number;
  readonly evidence: Readonly<Record<string, string>>;
  readonly ts: number;
  readonly engineId: string;
}
