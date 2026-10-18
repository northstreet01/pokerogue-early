import { createOriginalRuleHost } from './original-rule-host.mjs';
import { ContractError, canonical, requireContract as check } from '../src/battle-core/coop-contract.mjs';

// VS-02 bridge. The legacy fixture.parties mode is retained only for the
// accepted VS-01 seam tests; production/VS-02 initialization uses the lobby
// envelope (no fixed parties), selected by fixture.lobby.
export const ADAPTER_FORMAT_VERSION = 2;
const DEFAULT_FIXTURE = Object.freeze({
  seed: 'vs01-original-coop',
  identities: [{ trainerId: 1, secretId: 2 }, { trainerId: 3, secretId: 4 }],
  parties: [[1, 4, 7], [906, 909, 912]],
  eggState: { players: [[], []] },
});
const COPY = value => JSON.parse(canonical(value));
const clone = value => JSON.parse(JSON.stringify(value));

function stageOf(context) {
  if (context.lobby) return 'lobby';
  const decision = context.checkpoint?.decision;
  if (!decision) return 'initializing';
  if (decision.kind === 'preparation') return 'preparation';
  if (decision.kind === 'switch-confirm' || decision.kind === 'switch-select') return 'switch';
  if (decision.kind === 'wait-actions') return 'battle';
  if (decision.kind === 'wait-target') return 'target';
  if (decision.kind === 'continuing') return decision.reason === 'next-battle' ? 'next-battle' : 'resolving';
  if (decision.kind === 'ended') return 'ended';
  return 'unknown';
}
const frontPhase = checkpoint =>
  (checkpoint.continuation.phaseQueuePrepend.at(-1) ?? checkpoint.continuation.phaseQueue[0])?.phase?.type ?? null;
const lobbyId = context => `lobby-${context.runId}-${context.lobby.step}`;

export function createOriginalCoopAdapter({ fixture = DEFAULT_FIXTURE, hostFactory = createOriginalRuleHost,
  rulesVersion = 'early-vs02', contentHash = 'vs02-original-coop' } = {}) {
  const rooms = new Map();
  const failed = new Set();

  async function createRoom(runId, provisioning) {
    const host = await hostFactory({ seed: provisioning.seed, identity: provisioning.identities[0] });
    const room = { runId, host, provisioning: clone(provisioning), species: null, diagnosticCheckpoint: null };
    rooms.set(runId, room);
    try {
      const catalogs = await host.request('catalogs');
      room.species = new Set(catalogs.species.map(species => species.id));
      return room;
    } catch (error) {
      if (rooms.get(runId) === room) rooms.delete(runId);
      await host.close();
      throw error;
    }
  }
  async function roomFor(runId, provisioning) {
    check(!failed.has(runId), 'ROOM_WORKER_FAILED');
    let room = rooms.get(runId);
    if (room) check(canonical(room.provisioning) === canonical(provisioning), 'ROOM_PROVISIONING_MISMATCH');
    if (!room) room = await createRoom(runId, provisioning);
    return room;
  }
  async function request(room, operation, payload) {
    const originalHost = room.host;
    try { return await originalHost.request(operation, payload); }
    catch (error) {
      if (!['ORIGINAL_RUNTIME_CLOSED', 'ORIGINAL_RUNTIME_FAILED', 'ORIGINAL_RUNTIME_EXITED'].includes(error.code)) throw error;
      // Explicit disposal must never resurrect an orphan Worker.
      check(!failed.has(room.runId) && rooms.get(room.runId) === room, 'ROOM_WORKER_FAILED');
      if (room.host === originalHost) {
        if (!room.recovery) room.recovery = (async () => {
          await originalHost.close().catch(() => {});
          const replacement = await hostFactory({ seed: room.provisioning.seed, identity: room.provisioning.identities[0] });
          try {
            check(!failed.has(room.runId) && rooms.get(room.runId) === room, 'ROOM_WORKER_FAILED');
            const catalogs = await replacement.request('catalogs');
            check(!failed.has(room.runId) && rooms.get(room.runId) === room, 'ROOM_WORKER_FAILED');
            room.species = new Set(catalogs.species.map(species => species.id));
            room.host = replacement;
          } catch (replacementError) {
            await replacement.close();
            throw replacementError;
          }
        })().finally(() => { room.recovery = null; });
        await room.recovery;
      }
      check(!failed.has(room.runId) && rooms.get(room.runId) === room, 'ROOM_WORKER_FAILED');
      return room.host.request(operation, payload);
    }
  }
  function contextFor(room, lobby, checkpoint, intents) {
    return { runId: room.runId, provisioning: clone(room.provisioning), lobby: lobby ? clone(lobby) : null,
      checkpoint: checkpoint ? clone(checkpoint) : null, intents: intents ? clone(intents) : [] };
  }
  function normalizeIntents(checkpoint, existing, incoming) {
    const byId = new Map((existing ?? []).map(intent => [intent.id, intent]));
    for (const raw of incoming ?? []) {
      const pokemonId = Number.isInteger(raw.pokemonId) ? raw.pokemonId : null;
      const entry = pokemonId === null ? null
        : checkpoint.roster.entries.find(item => (item.pokemon?.fields?.id ?? item.pokemon?.id) === pokemonId);
      const intent = {
        id: `${checkpoint.battle?.waveIndex ?? 0}:${raw.kind}:${pokemonId ?? raw.waveIndex ?? raw.id ?? raw.kind}`,
        owner: entry ? entry.owner : null,
        source: 'scene',
        recipient: null,
        type: raw.kind,
        payload: clone(raw),
        status: 'pending',
      };
      if (!byId.has(intent.id)) byId.set(intent.id, intent);
    }
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  function scopeEvent(event, checkpoint) {
    if (event.kind === 'preparation-open' && (event.seat === 0 || event.seat === 1))
      return { ...event, scope: event.seat };
    if (event.pokemonId !== undefined) {
      const entry = checkpoint.roster.entries.find(item => (item.pokemon?.fields?.id ?? item.pokemon?.id) === event.pokemonId);
      if (entry && (entry.owner === 0 || entry.owner === 1)) return { ...event, scope: entry.owner };
    }
    return { ...event, scope: 'shared' };
  }
  async function project(room, context, seat) {
    return request(room, 'native-project', { checkpoint: context.checkpoint, seat });
  }
  async function runToStable(room, context) {
    let checkpoint = context.checkpoint, intents = context.intents, events = [];
    const apply = async (operation, payload = checkpoint) => {
      const result = await request(room, operation, payload);
      checkpoint = result.checkpoint;
      intents = normalizeIntents(checkpoint, intents, result.intents);
      events.push(...(result.events ?? []).map(event => scopeEvent(event, checkpoint)));
    };
    for (let budget = 0; budget < 24; budget++) {
      const decision = checkpoint.decision;
      if (decision.kind === 'wait-actions' || decision.kind === 'preparation'
        || decision.kind === 'wait-target' || decision.kind === 'ended'
        || decision.kind === 'switch-confirm' || decision.kind === 'switch-select') break;
      check(decision.kind === 'continuing', 'UNSUPPORTED_DECISION');
      if (decision.reason === 'next-battle') await apply('native-next');
      else if (frontPhase(checkpoint) === 'SelectModifierPhase') await apply('native-preparation');
      else await apply('native-run-to-boundary');
    }
    return { context: contextFor(room, null, checkpoint, intents), events, intents, grants: [] };
  }
  async function validateLobbyAction(room, action) {
    check(action && typeof action === 'object' && Object.keys(action).sort().join(',') === 'eggs,kind,ready,starters'
      && action.kind === 'starter-ready' && typeof action.ready === 'boolean', 'INVALID_SAFE_DECISION');
    check(Array.isArray(action.starters) && action.starters.length === 3
      && new Set(action.starters).size === 3 && action.starters.every(id => Number.isSafeInteger(id) && room.species.has(id)),
      'INVALID_POKEMON_SELECTION');
    check(Array.isArray(action.eggs), 'INVALID_EGG_STATE');
    await request(room, 'native-validate-eggs', { players: [clone(action.eggs), []] });
  }

  return Object.freeze({
    rulesVersion,
    contentHash,
    formatVersion: ADAPTER_FORMAT_VERSION,

    async createInitialContext({ runId }) {
      check(typeof runId === 'string' && runId.length > 0, 'INVALID_RUN_ID');
      const fixtureIdentities = fixture.identities ?? (fixture.identity
        ? [fixture.identity, { trainerId: (fixture.identity.trainerId + 1) % 65536,
          secretId: (fixture.identity.secretId + 1) % 65536 }] : null);
      check(Array.isArray(fixtureIdentities) && fixtureIdentities.length === 2, 'INVALID_TRAINER_IDENTITY');
      const provisioning = { seed: fixture.seed, identities: clone(fixtureIdentities) };
      const room = await roomFor(runId, provisioning);
      if (fixture.lobby) {
        const lobby = { step: 0, players: [
          { starters: null, eggs: [], ready: false }, { starters: null, eggs: [], ready: false },
        ] };
        return contextFor(room, lobby, null, []);
      }
      check(Array.isArray(fixture.parties) && fixture.parties.length === 2, 'INVALID_NATIVE_PARTIES');
      const opened = await request(room, 'native-open-to-input', {
        parties: clone(fixture.parties), eggState: clone(fixture.eggState), identities: provisioning.identities,
      });
      const context = contextFor(room, null, opened.checkpoint, []);
      context.intents = normalizeIntents(opened.checkpoint, [], opened.intents);
      return context;
    },

    async describeDecision(context) {
      if (context.lobby) return { id: lobbyId(context), requiredSeats: [0, 1], collection: 'incremental' };
      const decision = context.checkpoint.decision;
      if (decision.kind === 'preparation')
        return { id: decision.id, requiredSeats: [...decision.requiredSeats], collection: 'incremental' };
      if (decision.kind === 'wait-actions' || decision.kind === 'wait-target'
        || decision.kind === 'switch-confirm' || decision.kind === 'switch-select')
        return { id: decision.id, requiredSeats: [...decision.requiredSeats], collection: 'all' };
      if (decision.kind === 'continuing')
        return { id: decision.id, requiredSeats: [], collection: 'auto' };
      if (decision.kind === 'ended')
        return { id: decision.id, requiredSeats: [], collection: 'all' };
      throw Object.assign(new Error('UNSUPPORTED_DECISION'), { code: 'UNSUPPORTED_DECISION' });
    },

    async validateAction(context, seat, action) {
      check(seat === 0 || seat === 1, 'INVALID_SEAT');
      const room = await roomFor(context.runId, context.provisioning);
      if (context.lobby) { await validateLobbyAction(room, action); return; }
      const decision = context.checkpoint.decision;
      if (decision.kind === 'wait-actions') {
        check(action?.kind === 'fight', 'INVALID_ACTION');
        await request(room, 'native-validate', { checkpoint: context.checkpoint, seat, action: COPY(action) });
        return;
      }
      if (decision.kind === 'preparation') {
        await request(room, 'native-validate-preparation', { checkpoint: context.checkpoint, seat, action: COPY(action) });
        return;
      }
      if (decision.kind === 'switch-confirm' || decision.kind === 'switch-select') {
        await request(room, 'native-validate-switch', { checkpoint: context.checkpoint, seat, action: COPY(action) });
        return;
      }
      throw Object.assign(new Error('INVALID_ACTION'), { code: 'INVALID_ACTION' });
    },

    async advanceToDecision(context, inputs) {
      const room = await roomFor(context.runId, context.provisioning);
      if (context.lobby) {
        const seats = Object.keys(inputs ?? {});
        check(seats.length === 1 && (seats[0] === '0' || seats[0] === '1'), 'INCOMPLETE_LOBBY_INPUTS');
        const seat = Number(seats[0]);
        await validateLobbyAction(room, inputs[seat]);
        const players = context.lobby.players.map((player, index) => index === seat
          ? { starters: [...inputs[seat].starters], eggs: clone(inputs[seat].eggs), ready: inputs[seat].ready }
          : player);
        const nextLobby = { step: context.lobby.step + 1, players };
        if (players.every(player => player.ready && player.starters)) {
          const opened = await request(room, 'native-open-to-input', {
            parties: players.map(player => [...player.starters]),
            eggState: { players: players.map(player => clone(player.eggs)) },
            identities: context.provisioning.identities,
          });
          const battle = contextFor(room, null, opened.checkpoint, []);
          battle.intents = normalizeIntents(opened.checkpoint, context.intents, opened.intents);
          const events = (opened.events ?? []).map(event => scopeEvent(event, opened.checkpoint));
          return { context: battle, events, intents: battle.intents, grants: [] };
        }
        return {
          context: contextFor(room, nextLobby, null, context.intents),
          events: [{ kind: 'starter-ready', seat, ready: inputs[seat].ready, scope: 'shared' }],
          intents: context.intents, grants: [],
        };
      }
      const decision = context.checkpoint.decision;
      let checkpoint = context.checkpoint, intents = context.intents, events = [];
      const apply = async (operation, payload = checkpoint) => {
        const result = await request(room, operation, payload);
        checkpoint = result.checkpoint;
        intents = normalizeIntents(checkpoint, intents, result.intents);
        events.push(...(result.events ?? []).map(event => scopeEvent(event, checkpoint)));
      };
      if (decision.kind === 'wait-actions') {
        check(inputs && Object.keys(inputs).sort().join(',') === '0,1', 'INCOMPLETE_COMMAND_INPUTS');
        await apply('native-submit', { checkpoint, inputs: COPY(inputs) });
      } else if (decision.kind === 'preparation') {
        const seats = Object.keys(inputs ?? {});
        check(seats.length === 1 && (seats[0] === '0' || seats[0] === '1'), 'INCOMPLETE_PREPARATION_INPUTS');
        await apply('native-prepare-action', { checkpoint, seat: Number(seats[0]), action: COPY(inputs[seats[0]]) });
      } else if (decision.kind === 'switch-confirm' || decision.kind === 'switch-select') {
        check(inputs && Object.keys(inputs).length === 1, 'INCOMPLETE_SWITCH_INPUTS');
        await apply('native-switch', { checkpoint, inputs: COPY(inputs) });
      } else check(decision.kind === 'continuing', 'UNSAFE_ADVANCE');
      const intermediate = contextFor(room, null, checkpoint, intents);
      const result = await runToStable(room, intermediate);
      result.events = [...events, ...result.events];
      result.intents = result.context.intents;
      return result;
    },

    async captureCheckpoint(context) {
      return {
        formatVersion: ADAPTER_FORMAT_VERSION,
        runId: context.runId,
        stage: stageOf(context),
        provisioning: COPY(context.provisioning),
        lobby: context.lobby ? COPY(context.lobby) : null,
        nativeCheckpoint: context.checkpoint ? COPY(context.checkpoint) : null,
        intents: COPY(context.intents),
      };
    },

    async validateCheckpoint(checkpoint) {
      check(checkpoint && typeof checkpoint === 'object' && !Array.isArray(checkpoint), 'INVALID_CHECKPOINT');
      canonical(checkpoint);
      check(Object.keys(checkpoint).sort().join(',') === 'formatVersion,intents,lobby,nativeCheckpoint,provisioning,runId,stage', 'INVALID_CHECKPOINT');
      check(checkpoint.formatVersion === ADAPTER_FORMAT_VERSION && typeof checkpoint.runId === 'string'
        && checkpoint.runId.length > 0, 'INVALID_CHECKPOINT');
      check(checkpoint.provisioning && Object.keys(checkpoint.provisioning).sort().join(',') === 'identities,seed'
        && typeof checkpoint.provisioning.seed === 'string' && checkpoint.provisioning.seed.length > 0
        && Array.isArray(checkpoint.provisioning.identities) && checkpoint.provisioning.identities.length === 2
        && checkpoint.provisioning.identities.every(identity => identity && Object.keys(identity).sort().join(',') === 'secretId,trainerId' && Number.isInteger(identity.trainerId)
          && identity.trainerId >= 0 && identity.trainerId < 65536 && Number.isInteger(identity.secretId)
          && identity.secretId >= 0 && identity.secretId < 65536), 'INVALID_CHECKPOINT');
      check(Array.isArray(checkpoint.intents) && typeof checkpoint.stage === 'string', 'INVALID_CHECKPOINT');
      const intentIds = new Set();
      for (const intent of checkpoint.intents) {
        check(intent && Object.keys(intent).sort().join(',') === 'id,owner,payload,recipient,source,status,type'
          && typeof intent.id === 'string' && intent.id.length > 0 && !intentIds.has(intent.id)
          && [null, 0, 1].includes(intent.owner) && intent.recipient === null
          && intent.source === 'scene' && intent.status === 'pending'
          && typeof intent.type === 'string' && intent.type.length > 0
          && intent.payload && typeof intent.payload === 'object' && !Array.isArray(intent.payload)
          && intent.payload.kind === intent.type, 'INVALID_CHECKPOINT');
        intentIds.add(intent.id);
      }
      if (checkpoint.nativeCheckpoint === null) {
        check(checkpoint.stage === 'lobby' && checkpoint.lobby, 'INVALID_CHECKPOINT');
        check(Object.keys(checkpoint.lobby).sort().join(',') === 'players,step'
          && Number.isSafeInteger(checkpoint.lobby.step) && checkpoint.lobby.step >= 0
          && Array.isArray(checkpoint.lobby.players) && checkpoint.lobby.players.length === 2
          && checkpoint.lobby.players.every(player => player && Object.keys(player).sort().join(',') === 'eggs,ready,starters'
            && typeof player.ready === 'boolean' && (!player.ready || player.starters !== null)
            && Array.isArray(player.eggs) && (player.starters === null
              || Array.isArray(player.starters) && player.starters.length === 3)), 'INVALID_CHECKPOINT');
        check(!checkpoint.lobby.players.every(player => player.ready), 'INVALID_CHECKPOINT');
        const room = await roomFor(checkpoint.runId, checkpoint.provisioning);
        for (const player of checkpoint.lobby.players) {
          if (player.starters) check(new Set(player.starters).size === 3
            && player.starters.every(id => room.species.has(id)), 'INVALID_POKEMON_SELECTION');
          await request(room, 'native-validate-eggs', { players: [clone(player.eggs), []] });
        }
        return true;
      }
      check(checkpoint.lobby === null && checkpoint.nativeCheckpoint
        && checkpoint.stage === stageOf({ checkpoint: checkpoint.nativeCheckpoint })
        && !['unknown', 'initializing'].includes(checkpoint.stage), 'INVALID_CHECKPOINT');
      check(checkpoint.nativeCheckpoint.scene?.seed === checkpoint.provisioning.seed, 'INVALID_CHECKPOINT');
      const room = await roomFor(checkpoint.runId, checkpoint.provisioning);
      await request(room, 'native-validate-checkpoint', checkpoint.nativeCheckpoint);
      return true;
    },

    async restoreCheckpoint(checkpoint) {
      await this.validateCheckpoint(checkpoint);
      const room = await roomFor(checkpoint.runId, checkpoint.provisioning);
      // restore is also used for uncommitted candidates by the formal service.
      // This cache is diagnostic only; it is never a source for restoration.
      room.diagnosticCheckpoint = checkpoint.nativeCheckpoint;
      return contextFor(room, checkpoint.lobby, checkpoint.nativeCheckpoint, checkpoint.intents);
    },

    async projectSnapshot(context, seat) {
      check(seat === 0 || seat === 1, 'INVALID_SEAT');
      const room = await roomFor(context.runId, context.provisioning);
      if (context.lobby) {
        const id = lobbyId(context);
        return {
          shared: { format: 2, stage: 'lobby', decision: { id, kind: 'lobby', requiredSeats: [0, 1] },
            ready: context.lobby.players.map(player => player.ready) },
          personal: { format: 2, stage: 'lobby', seat,
            selection: { starters: clone(context.lobby.players[seat].starters), eggs: clone(context.lobby.players[seat].eggs) },
            party: [], eggs: clone(context.lobby.players[seat].eggs), resources: null,
            decision: { id, kind: 'lobby', requiredSeats: [0, 1], options: null, players: null, switch: null } },
        };
      }
      return project(room, context, seat);
    },

    async measureProjection(runId, seat = 0) {
      check(!failed.has(runId), 'ROOM_WORKER_FAILED');
      const room = rooms.get(runId);
      check(room && room.diagnosticCheckpoint, 'INVALID_CHECKPOINT');
      const start = performance.now();
      const view = await request(room, 'native-project', { checkpoint: room.diagnosticCheckpoint, seat });
      return {
        rpcMs: performance.now() - start,
        checkpointBytes: Buffer.byteLength(JSON.stringify(room.diagnosticCheckpoint)),
        sharedBytes: Buffer.byteLength(canonical(view.shared)),
        personalBytes: Buffer.byteLength(canonical(view.personal)),
      };
    },

    async failRoom(runId) {
      failed.add(runId);
      const room = rooms.get(runId);
      if (room) { rooms.delete(runId); await room.host.close(); }
    },
    async closeRoom(runId) {
      const room = rooms.get(runId);
      if (!room) return;
      rooms.delete(runId); await room.host.close();
    },
    async closeAll() {
      const all = [...rooms.values()]; rooms.clear();
      await Promise.all(all.map(room => room.host.close()));
    },
  });
}
