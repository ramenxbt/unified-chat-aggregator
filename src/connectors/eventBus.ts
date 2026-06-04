import type { ConnectorEventListener, ConnectorStatusListener } from "./types";
import type { ConnectorStatus, UnifiedEvent } from "../domain/unifiedEvent";

export class ConnectorEventBus {
  private readonly eventListeners = new Set<ConnectorEventListener>();
  private readonly statusListeners = new Set<ConnectorStatusListener>();

  subscribe(listener: ConnectorEventListener) {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  subscribeStatus(listener: ConnectorStatusListener) {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  emit(event: UnifiedEvent) {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  emitStatus(status: ConnectorStatus) {
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }
}

