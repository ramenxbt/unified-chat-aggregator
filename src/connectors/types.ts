import type { ConnectorStatus, SourcePlatform, UnifiedEvent } from "../domain/unifiedEvent";

export type ConnectorEventListener = (event: UnifiedEvent) => void;
export type ConnectorStatusListener = (status: ConnectorStatus) => void;

export type ConnectorHealth = ConnectorStatus & {
  startedAt?: string;
  lastError?: string;
};

export type Connector = {
  platform: SourcePlatform;
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): ConnectorHealth;
  subscribe(listener: ConnectorEventListener): () => void;
  subscribeStatus(listener: ConnectorStatusListener): () => void;
};

export type ConnectorRuntimeOptions = {
  now?: () => Date;
};

