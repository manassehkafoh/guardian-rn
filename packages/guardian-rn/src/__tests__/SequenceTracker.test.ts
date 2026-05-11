import { SequenceTracker } from '../core/SequenceTracker.js';

const SESSION = 'test-session-id';

describe('SequenceTracker', () => {
  // T-HMAC-2: replay — same seq ≤ lastSeq
  test('T-HMAC-2: replay of same sequence number is detected', () => {
    const tracker = new SequenceTracker(SESSION);
    expect(tracker.check(1, SESSION)).toBeNull();   // first event: ok
    expect(tracker.check(1, SESSION)).toBe('replay'); // same seq: replay
  });

  test('T-HMAC-2: earlier sequence number is detected as replay', () => {
    const tracker = new SequenceTracker(SESSION);
    tracker.check(5, SESSION);
    expect(tracker.check(3, SESSION)).toBe('replay');
  });

  // T-HMAC-3: gap — seq skips a number
  test('T-HMAC-3: sequence gap is detected', () => {
    const tracker = new SequenceTracker(SESSION);
    tracker.check(1, SESSION);
    expect(tracker.check(3, SESSION)).toBe('gap'); // 2 was skipped
  });

  test('sequential events pass with null', () => {
    const tracker = new SequenceTracker(SESSION);
    expect(tracker.check(1, SESSION)).toBeNull();
    expect(tracker.check(2, SESSION)).toBeNull();
    expect(tracker.check(3, SESSION)).toBeNull();
    expect(tracker.last).toBe(3);
  });

  test('wrong session is detected', () => {
    const tracker = new SequenceTracker(SESSION);
    expect(tracker.check(1, 'other-session')).toBe('wrong_session');
  });

  test('rollover from near-max to near-1 is detected and accepted', () => {
    const tracker = new SequenceTracker(SESSION);
    tracker.check(0xffff0001, SESSION);
    expect(tracker.check(1, SESSION)).toBe('rollover');
    expect(tracker.last).toBe(1);
  });

  test('reset clears state', () => {
    const tracker = new SequenceTracker(SESSION);
    tracker.check(10, SESSION);
    tracker.reset();
    expect(tracker.last).toBe(0);
    expect(tracker.check(1, SESSION)).toBeNull();
  });
});
