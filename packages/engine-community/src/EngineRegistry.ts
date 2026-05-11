import type { Engine, EngineContext } from '@guardian/rn/src/engine/Engine.js';

export class EngineRegistry {
  private readonly engines = new Map<string, Engine>();
  private context: EngineContext | null = null;
  private started = false;

  register(engine: Engine): void {
    if (this.engines.has(engine.id)) {
      throw new Error(`Engine '${engine.id}' is already registered`);
    }
    this.engines.set(engine.id, engine);
  }

  async startAll(context: EngineContext): Promise<void> {
    if (this.started) return;
    this.context = context;
    this.started = true;
    // Start all engines in parallel (per ADR-0004)
    await Promise.all([...this.engines.values()].map((e) => e.start(context)));
  }

  async stopAll(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.context = null;
    await Promise.all([...this.engines.values()].map((e) => e.stop()));
  }

  get(id: string): Engine | undefined {
    return this.engines.get(id);
  }

  get size(): number {
    return this.engines.size;
  }
}
