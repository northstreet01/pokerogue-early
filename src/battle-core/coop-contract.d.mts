export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Projection = { shared: Record<string, Json>; personal: Record<string, Json> };
export type Seat = 0 | 1;
export interface Versions { protocolVersion: number; checkpointVersion: number; rulesVersion: string; contentHash: string }
export interface Identity { roomId: string; runId: string }
export interface StateIdentity extends Identity { revision: number; decisionId: string }
export interface Grant { id: string; seat: Seat; payload: Record<string, Json> }
export interface Action { kind: string; [key: string]: Json }
export type ClientMessage =
  | ({ type: 'hello' } & Versions)
  | { type: 'createRoom'; name: string }
  | { type: 'joinRoom'; roomId: string; name: string }
  | { type: 'resumeSeat'; roomId: string; resumeToken: string }
  | ({ type: 'submitAction'; decisionId: string; expectedRevision: number; actionId: string; action: Action } & Identity)
  | ({ type: 'stateAck'; connectionEpoch: string; sharedHash: string; personalHash: string } & StateIdentity)
  | ({ type: 'grantAck'; connectionEpoch: string; grantIds: string[] } & Identity)
  | ({ type: 'requestSnapshot'; knownRevision: number; reason: string } & Identity);
export type Snapshot = { type: 'snapshot'; connectionEpoch: string; seat: Seat; sharedHash: string; personalHash: string; events: Json[]; grants: Grant[] } & Versions & StateIdentity & Projection;
export type ServerMessage = Snapshot
  | ({ type: 'welcome'; roomId: string | null; seat: Seat | null; connectionEpoch: string | null; resumeToken: string | null } & Versions)
  | ({ type: 'actionReceipt'; actionId: string; accepted: boolean; code: string } & StateIdentity)
  | ({ type: 'syncStatus'; revision: number; online: boolean[]; acked: boolean[]; submitted: boolean[]; blocked: boolean; reason: string } & Identity)
  | { type: 'error'; code: string };
export interface ServerAdapter<Context, Checkpoint extends Json> {
  rulesVersion: string;
  contentHash: string;
  createInitialContext(input: { runId: string }): Context | Promise<Context>;
  /** Must be pure: no mutations or random consumption. Throw on rejection. */
  validateAction(context: Context, seat: Seat, action: Action): void | Promise<void>;
  advanceToDecision(context: Context, inputs: Partial<Record<Seat, Action>>): { context: Context; events: Json[]; grants: Grant[] } | Promise<{ context: Context; events: Json[]; grants: Grant[] }>;
  captureCheckpoint(context: Context): Checkpoint | Promise<Checkpoint>;
  validateCheckpoint(checkpoint: Checkpoint): void | Promise<void>;
  restoreCheckpoint(checkpoint: Checkpoint): Context | Promise<Context>;
  projectSnapshot(context: Context, seat: Seat): Projection | Promise<Projection>;
  describeDecision(context: Context): { id: string; requiredSeats: Seat[] } | Promise<{ id: string; requiredSeats: Seat[] }>;
}
export interface ClientAdapter {
  applySnapshot(snapshot: Snapshot): void | Promise<void>;
  captureAppliedState(): Projection | Promise<Projection>;
  /** Atomic collection + dedup ledger write; resolves only after commit. */
  applyGrantsTransaction(grants: Grant[], identity: { runId: string; seat: Seat }): void | Promise<void>;
}
export const PROTOCOL_VERSION: number;
export const CHECKPOINT_VERSION: number;
export class ContractError extends Error { code: string; constructor(code: string) }
export function requireContract(condition: unknown, code?: string): asserts condition;
export function canonical(value: unknown): string;
export function copy<T>(value: T): T;
export function validateMessage(message: unknown, direction?: 'client'): ClientMessage;
export function validateMessage(message: unknown, direction: 'server'): ServerMessage;
export function assertVersions(actual: Versions, expected: Versions): void;
export const SERVER_METHODS: string[];
export const CLIENT_METHODS: string[];
export function requireAdapter<T>(adapter: T, methods: string[]): T;
