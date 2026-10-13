import type { Versions, ClientAdapter, ClientMessage, Snapshot } from './coop-contract.mjs';
export function digestProjection(value: unknown): Promise<string>;
export function createSnapshotConsumer(options: { versions: Versions; adapter: ClientAdapter; isCurrent(epoch: string): boolean; send(message: ClientMessage): void }): (snapshot: Snapshot) => Promise<boolean>;
