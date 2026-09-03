import type { Observable, Observer, Subscription } from '@guardian/rn/src/types/Observable.js';

export class SimpleSubject<T> implements Observable<T> {
  private readonly observers = new Set<Observer<T>>();

  subscribe(observer: Observer<T>): Subscription {
    this.observers.add(observer);
    return { unsubscribe: () => this.observers.delete(observer) };
  }

  emit(value: T): void {
    for (const obs of this.observers) obs.next(value);
  }
}
