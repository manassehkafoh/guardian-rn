/**
 * Tracks per-session sequence numbers and detects replays and gaps.
 * Per ADR-0003: seq is uint32 [1, 0xFFFFFFFF]; rollover resets the tracker.
 */
export class SequenceTracker {
  private lastSeq = 0;
  private readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * Returns null if the sequence is valid.
   * Returns an error string if the event should be flagged.
   * 'replay'  — seq ≤ lastSeq (same or earlier: dropped)
   * 'gap'     — seq > lastSeq + 1 (events were lost)
   * 'rollover'— seq wraps from 0xFFFFFFFF to 1 (expected, not an error)
   */
  check(seq: number, incomingSessionId: string): null | 'replay' | 'gap' | 'rollover' | 'wrong_session' {
    if (incomingSessionId !== this.sessionId) return 'wrong_session';

    // Rollover detection: last was near max, new starts near 1
    if (this.lastSeq > 0xffff0000 && seq < 0x0000ffff) {
      this.lastSeq = seq;
      return 'rollover';
    }

    if (seq <= this.lastSeq) return 'replay';
    if (seq > this.lastSeq + 1) {
      this.lastSeq = seq;
      return 'gap';
    }

    this.lastSeq = seq;
    return null;
  }

  reset(): void {
    this.lastSeq = 0;
  }

  get last(): number {
    return this.lastSeq;
  }
}
