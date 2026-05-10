/**
 * Minimal observable interface compatible with RxJS Subject and native implementations.
 * Engines use this as the onThreat / onHealthTick contract.
 */
export interface Observable<T> {
  subscribe(observer: Observer<T>): Subscription;
}

export interface Observer<T> {
  next(value: T): void;
  error?(err: unknown): void;
  complete?(): void;
}

export interface Subscription {
  unsubscribe(): void;
}
