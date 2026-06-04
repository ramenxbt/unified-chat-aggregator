import { buildUnifiedEventId, type UnifiedEvent } from "../domain/unifiedEvent";

export class ReplayBuffer {
  private readonly events: UnifiedEvent[] = [];
  private readonly seen = new Set<string>();

  constructor(private readonly maxSize = 250) {}

  add(event: UnifiedEvent) {
    const key = buildUnifiedEventId(event.platform, event.platformEventId);

    if (this.seen.has(key)) {
      return false;
    }

    this.seen.add(key);
    this.events.unshift(event);

    if (this.events.length > this.maxSize) {
      const removed = this.events.pop();
      if (removed) {
        this.seen.delete(buildUnifiedEventId(removed.platform, removed.platformEventId));
      }
    }

    return true;
  }

  clear() {
    this.events.length = 0;
    this.seen.clear();
  }

  snapshot() {
    return [...this.events];
  }
}

