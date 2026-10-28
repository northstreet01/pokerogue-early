import { createOriginalRuleHost } from './original-rule-host.mjs';
import {randomUUID} from 'node:crypto';
import { ContractError, canonical, requireContract as check } from '../src/battle-core/coop-contract.mjs';

// Original-rule adapter. Production always enters the profile lobby; seam tests
// may supply an explicit fixture, but no test party is a production default.
export const ADAPTER_FORMAT_VERSION = 3;
const COPY = value => JSON.parse(canonical(value));
const clone = value => JSON.parse(JSON.stringify(value));

// The desktop host, local development server and standalone server share one
// production configuration. Player identity/team arrive through verified profiles.
export function createPlayerHostAdapter({seedFactory=()=>randomUUID(),hostFactory}={}) {
  return createOriginalCoopAdapter({hostFactory,seedFactory,fixture:{profileLobby:true,sharedPreparation:true,roomSharing:true,
    identities:[{trainerId:0,secretId:0},{trainerId:0,secretId:0}]}});
}

function stageOf(context) {
  if (context.lobby) return 'lobby';
  const decision = context.checkpoint?.decision;
  if (!decision) return 'initializing';
  if (decision.kind === 'preparation') return 'preparation';
  if (decision.kind === 'switch-confirm' || decision.kind === 'switch-select' || decision.kind === 'wait-switch' || decision.kind === 'capture-choice') return 'switch';
  if (decision.kind === 'wait-actions') return 'battle';
  if (decision.kind === 'wait-target') return 'target';
  if (decision.kind === 'learn-move' || decision.kind === 'evolution') return 'learning';
  if (decision.kind === 'continuing') return decision.reason === 'next-battle' ? 'next-battle' : 'resolving';
  if (decision.kind === 'ended') return 'ended';
  return 'unknown';
}
const frontPhase = checkpoint =>
  (checkpoint.continuation.phaseQueuePrepend.at(-1) ?? checkpoint.continuation.phaseQueue[0])?.phase?.type ?? null;
const lobbyId = context => `lobby-${context.runId}-${context.lobby.step}`;
const PROFILE_FORMAT = 3;
const SHARED_BUDGET = 14;
const PERSONAL_BUDGET = 10;
const PROFILE_KEYS = ['kind', 'profile', 'ready'];
const budgetOf = players => players.reduce((sum, player) => sum + (player.priced?.total ?? 0), 0);
function profileLobbyState(players = null) {
  return {
    mode: 'profile-v1',
    step: 0,
    budget: { personal: PERSONAL_BUDGET, shared: SHARED_BUDGET },
    players: players ?? [
      { profile: null, priced: null, ready: false },
      { profile: null, priced: null, ready: false },
    ],
  };
}

export function createOriginalCoopAdapter({ fixture, hostFactory = createOriginalRuleHost,
  seedFactory = null, rulesVersion = 'early-vs02', contentHash = 'vs02-original-coop' } = {}) {
  check(fixture && typeof fixture === 'object', 'ADAPTER_CONFIGURATION_REQUIRED');
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
  async function roomFor(runId, provisioning, profileMode = false) {
    check(!failed.has(runId), 'ROOM_WORKER_FAILED');
    let room = rooms.get(runId);
    if (room && canonical(room.provisioning) !== canonical(provisioning)) {
      // Profile import may replace bootstrap identities. The cache is disposable:
      // both a candidate and its uncommitted predecessor must remain restorable.
      check(profileMode && room.provisioning.seed === provisioning.seed, 'ROOM_PROVISIONING_MISMATCH');
      rooms.delete(runId);
      await room.host.close();
      room = null;
    }
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
  function contextFor(room, lobby, checkpoint, intents, formatVersion = 2) {
    return { runId: room.runId, provisioning: clone(room.provisioning), lobby: lobby ? clone(lobby) : null,
      checkpoint: checkpoint ? clone(checkpoint) : null, intents: intents ? clone(intents) : [],
      formatVersion, profileLobby: formatVersion === PROFILE_FORMAT && !!lobby };
  }
  function normalizeIntents(checkpoint, existing, incoming) {
    const byId = new Map((existing ?? []).map(intent => [intent.id, intent]));
    for (const raw of incoming ?? []) {
      const pokemonId = Number.isInteger(raw.pokemonId) ? raw.pokemonId : null;
      const entry = pokemonId === null ? null
        : checkpoint.roster.entries.find(item => (item.pokemon?.fields?.id ?? item.pokemon?.id) === pokemonId);
      const intent = {
        id: `${checkpoint.battle?.waveIndex ?? 0}:${raw.kind}:${['achievement-check','voucher-pending','completion-pending'].includes(raw.kind)&&[0,1].includes(raw.owner)?raw.owner+':':''}${raw.sourcePokemonId ?? pokemonId ?? raw.waveIndex ?? raw.id ?? raw.kind}`,
        owner: [0, 1].includes(raw.owner) ? raw.owner : entry ? entry.owner : null,
        source: 'scene',
        recipient: null,
        type: raw.kind,
        payload: clone(raw),
        status: 'pending',
      };
      const previous = byId.get(intent.id);
      if (!previous) byId.set(intent.id, intent);
      else if (['capture-pending','dex-ivs'].includes(raw.kind)) {
        check(previous.status === 'pending' && previous.owner === intent.owner
          && previous.payload.sourcePokemonId === raw.sourcePokemonId, 'CAPTURE_FACT_CONFLICT');
        byId.set(intent.id, intent);
      }
    }
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  function scopeEvent(event, checkpoint) {
    if (event.scope === 'shared' && ['damage-display','pokemon-hp','faint-cry','pokemon-enter','pokemon-exit','showInfo','form-change'].includes(event.kind)) return {...event};
    if (event.kind === 'message' && [0,1].includes(event.scope)) return { ...event };
    if (['preparation-open', 'legacy-capture-choice', 'capture-result'].includes(event.kind) && (event.seat === 0 || event.seat === 1))
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
        || decision.kind === 'switch-confirm' || decision.kind === 'switch-select' || decision.kind === 'wait-switch'
        || decision.kind === 'capture-choice' || decision.kind === 'learn-move' || decision.kind === 'evolution') break;
      check(decision.kind === 'continuing', 'UNSUPPORTED_DECISION');
      if (decision.reason === 'next-battle') await apply('native-next');
      else if (frontPhase(checkpoint) === 'SelectModifierPhase') await apply(context.provisioning.sharedPreparation ? 'native-preparation-shared' : 'native-preparation');
      else await apply('native-run-to-boundary');
    }
    return { context: contextFor(room, null, checkpoint, intents, context.formatVersion), events, intents, grants: [] };
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
  async function normalizeProfileAction(room, action) {
    const draft = action?.kind === 'profile-draft';
    check(action && typeof action === 'object' && Object.keys(action).sort().join(',') === PROFILE_KEYS.join(',')
      && (draft || action.kind === 'profile-ready') && typeof action.ready === 'boolean'
      && (!draft || action.ready === false), 'INVALID_PROFILE_ACTION');
    const normalized = await request(room, draft ? 'normalize-profile-draft' : 'normalize-profile', action.profile);
    check(normalized && normalized.profile && normalized.priced, 'INVALID_PROFILE');
    check(normalized.priced.total <= PERSONAL_BUDGET, 'PERSONAL_BUDGET_EXCEEDED');
    return { profile: normalized.profile, priced: normalized.priced, ready: action.ready,
      ...(draft ? { selectionState: 'draft' } : {}) };
  }
  async function withProfilePlayers(context, seat, candidate) {
    const players = context.lobby.players.map((player, index) => index === seat ? candidate : player);
    if(context.provisioning.roomSharing)check(candidate.profile.catalog,'ROOM_CATALOG_REQUIRED');
    if(context.provisioning.roomSharing&&candidate.profile.starters.length)
      check(players.every(p=>p.profile?.catalog),'ROOM_CATALOG_NOT_READY');
    const catalogs=players.flatMap(p=>p.profile?.catalog?[p.profile.catalog]:[]);
    if(catalogs.length){
      const occupied=new Set();
      for(const p of players)for(const starter of p.profile?.starters??[]){
        check(!occupied.has(starter.speciesId),'ROOM_SPECIES_OCCUPIED');occupied.add(starter.speciesId);
      }
      const room=await roomFor(context.runId,context.provisioning,true);
      await request(room,'validate-room-selection',{profile:candidate.profile,catalogs});
    }
    check(budgetOf(players) <= SHARED_BUDGET, 'SHARED_BUDGET_EXCEEDED');
    return players;
  }
  function checkProfileIdentity(context, seat, normalized) {
    const player = context.lobby.players[seat], current = player.profile;
    if(current?.catalog)check(canonical(current.catalog)===canonical(normalized.profile.catalog),'ROOM_CATALOG_CHANGED');
    check(!current || canonical(current.trainer) === canonical(normalized.profile.trainer), 'PROFILE_IDENTITY_MISMATCH');
    check(!player.ready || (normalized.selectionState !== 'draft' && canonical(current) === canonical(normalized.profile)),
      'PROFILE_READY_SELECTION_LOCKED');
    if (player.selectionState === 'draft' && normalized.ready)
      check(canonical(current) === canonical(normalized.profile), 'PROFILE_DRAFT_NOT_ACCEPTED');
  }
  async function validateProfileCheckpoint(checkpoint) {
    check(checkpoint.provisioning && checkpoint.provisioning.identities
      && checkpoint.provisioning.identities.length === 2, 'INVALID_CHECKPOINT');
    if (checkpoint.nativeCheckpoint === null) {
      check(checkpoint.stage === 'lobby' && checkpoint.lobby, 'INVALID_CHECKPOINT');
      const lobby = checkpoint.lobby;
      check(Object.keys(lobby).sort().join(',') === 'budget,mode,players,step' && lobby.mode === 'profile-v1'
        && Number.isSafeInteger(lobby.step) && lobby.step >= 0
        && Object.keys(lobby.budget).sort().join(',') === 'personal,shared'
        && lobby.budget.personal === PERSONAL_BUDGET && lobby.budget.shared === SHARED_BUDGET
        && Array.isArray(lobby.players) && lobby.players.length === 2, 'INVALID_CHECKPOINT');
      const room = await roomFor(checkpoint.runId, checkpoint.provisioning, true);
      for (const player of lobby.players) {
        check(player && ['priced,profile,ready', 'priced,profile,ready,selectionState'].includes(Object.keys(player).sort().join(','))
          && (!Object.hasOwn(player, 'selectionState') || player.selectionState === 'draft')
          && (player.selectionState !== 'draft' || player.ready === false && player.profile !== null)
          && typeof player.ready === 'boolean', 'INVALID_CHECKPOINT');
        if (player.profile === null) {
          check(player.priced === null && player.ready === false, 'INVALID_CHECKPOINT');
          continue;
        }
        const normalized = await request(room, player.selectionState === 'draft' ? 'normalize-profile-draft' : 'normalize-profile', player.profile);
        check(canonical(normalized.profile) === canonical(player.profile)
          && canonical(normalized.priced) === canonical(player.priced), 'INVALID_CHECKPOINT');
        check(player.priced.total <= PERSONAL_BUDGET, 'PERSONAL_BUDGET_EXCEEDED');
        if (player.ready) check(player.profile !== null, 'INVALID_CHECKPOINT');
      }
      check(budgetOf(lobby.players) <= SHARED_BUDGET, 'SHARED_BUDGET_EXCEEDED');
      if(checkpoint.provisioning.roomSharing){
        const catalogs=lobby.players.flatMap(p=>p.profile?.catalog?[p.profile.catalog]:[]),occupied=new Set();
        for(const player of lobby.players)if(player.profile){
          check(player.profile.catalog,'ROOM_CATALOG_REQUIRED');
          for(const starter of player.profile.starters){check(!occupied.has(starter.speciesId),'ROOM_SPECIES_OCCUPIED');occupied.add(starter.speciesId);}
          await request(room,'validate-room-selection',{profile:player.profile,catalogs});
        }
      }
      check(!lobby.players.every(player => player.ready), 'INVALID_CHECKPOINT');
      return true;
    }
    check(checkpoint.lobby === null && checkpoint.nativeCheckpoint
      && checkpoint.stage === stageOf({ checkpoint: checkpoint.nativeCheckpoint })
      && !['unknown', 'initializing'].includes(checkpoint.stage)
      && checkpoint.nativeCheckpoint.scene?.seed === checkpoint.provisioning.seed, 'INVALID_CHECKPOINT');
    const room = await roomFor(checkpoint.runId, checkpoint.provisioning, true);
    await request(room, 'native-validate-checkpoint', checkpoint.nativeCheckpoint);
    return true;
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
      const seed = fixture.profileLobby && typeof seedFactory === 'function' ? seedFactory() : fixture.seed;
      check(typeof seed === 'string' && seed.length > 0, 'INVALID_ROOM_SEED');
      const provisioning = { seed, identities: clone(fixtureIdentities), ...(fixture.sharedPreparation ? {sharedPreparation:true} : {}),...(fixture.roomSharing?{roomSharing:true}:{}) };
      const room = await roomFor(runId, provisioning);
      if (fixture.profileLobby) {
        const context = contextFor(room, profileLobbyState(), null, []);
        context.formatVersion = PROFILE_FORMAT;
        context.profileLobby = true;
        return context;
      }
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
        || decision.kind === 'switch-confirm' || decision.kind === 'switch-select' || decision.kind === 'wait-switch' || decision.kind === 'capture-choice'
        || decision.kind === 'learn-move' || decision.kind === 'evolution')
        return { id: decision.id, requiredSeats: [...decision.requiredSeats], collection: 'all' };
      if (decision.kind === 'continuing')
        return { id: decision.id, requiredSeats: [], collection: 'auto' };
      if (decision.kind === 'ended')
        return { id: decision.id, requiredSeats: [], collection: 'all' };
      throw Object.assign(new Error('UNSUPPORTED_DECISION'), { code: 'UNSUPPORTED_DECISION' });
    },

    async validateAction(context, seat, action) {
      check(seat === 0 || seat === 1, 'INVALID_SEAT');
      const room = await roomFor(context.runId, context.provisioning, context.formatVersion === PROFILE_FORMAT);
      if (context.profileLobby) {
        const normalized = await normalizeProfileAction(room, action);
        checkProfileIdentity(context, seat, normalized);
        await withProfilePlayers(context, seat, normalized);
        return;
      }
      if (context.lobby) { await validateLobbyAction(room, action); return; }
      const decision = context.checkpoint.decision;
      if (decision.kind === 'wait-actions' || decision.kind === 'wait-target') {
        check((decision.kind === 'wait-target' ? ['target'] : ['fight', 'switch', 'ball']).includes(action?.kind), 'INVALID_ACTION');
        await request(room, 'native-validate', { checkpoint: context.checkpoint, seat, action: COPY(action) });
        return;
      }
      if (decision.kind === 'preparation') {
        await request(room, 'native-validate-preparation', { checkpoint: context.checkpoint, seat, action: COPY(action) });
        return;
      }
      if (decision.kind === 'switch-confirm' || decision.kind === 'switch-select' || decision.kind === 'wait-switch' || decision.kind === 'capture-choice') {
        await request(room, 'native-validate-switch', { checkpoint: context.checkpoint, seat, action: COPY(action) });
        return;
      }
      if (decision.kind === 'learn-move' || decision.kind === 'evolution') {
        await request(room, 'native-validate-progression', { checkpoint: context.checkpoint, seat, action: COPY(action) });
        return;
      }
      throw Object.assign(new Error('INVALID_ACTION'), { code: 'INVALID_ACTION' });
    },

    async advanceToDecision(context, inputs) {
      const room = await roomFor(context.runId, context.provisioning, context.formatVersion === PROFILE_FORMAT);
      if (context.profileLobby) {
        const seats = Object.keys(inputs ?? {});
        check(seats.length === 1 && (seats[0] === '0' || seats[0] === '1'), 'INCOMPLETE_PROFILE_INPUTS');
        const seat = Number(seats[0]);
        const normalized = await normalizeProfileAction(room, inputs[seat]);
        checkProfileIdentity(context, seat, normalized);
        const players = await withProfilePlayers(context, seat, normalized);
        const nextLobby = { ...clone(context.lobby), step: context.lobby.step + 1, players };
        if (players.every(player => player.ready && player.profile)) {
          const identities = players.map(player => clone(player.profile.trainer));
          const candidateRoom = await roomFor(context.runId, { ...context.provisioning, identities }, true);
          const opened = await request(candidateRoom, 'native-open-selected-to-input', {
            starterSelections: players.map(player => clone(player.profile.starters)),
            identities: clone(identities),
            eggState: { players: players.map(player => clone(player.profile.eggs)) },
          });
          const battle = contextFor(candidateRoom, null, opened.checkpoint, [], PROFILE_FORMAT);
          battle.formatVersion = PROFILE_FORMAT;
          battle.profileLobby = false;
          battle.intents = normalizeIntents(opened.checkpoint, context.intents, opened.intents);
          const events = (opened.events ?? []).map(event => scopeEvent(event, opened.checkpoint));
          return { context: battle, events, intents: battle.intents, grants: [] };
        }
        const next = contextFor(room, nextLobby, null, context.intents);
        next.formatVersion = PROFILE_FORMAT;
        next.profileLobby = true;
        return {
          context: next,
          events: [{ kind: normalized.selectionState === 'draft' ? 'profile-draft' : 'profile-ready', seat, ready: normalized.ready, scope: 'shared' }],
          intents: context.intents, grants: [],
        };
      }
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
      if (decision.kind === 'wait-actions' || decision.kind === 'wait-target') {
        check(inputs && canonical(Object.keys(inputs).sort()) === canonical(decision.requiredSeats.map(String).sort()), 'INCOMPLETE_COMMAND_INPUTS');
        await apply('native-submit', { checkpoint, inputs: COPY(inputs) });
      } else if (decision.kind === 'preparation') {
        const seats = Object.keys(inputs ?? {});
        check(seats.length === 1 && (seats[0] === '0' || seats[0] === '1'), 'INCOMPLETE_PREPARATION_INPUTS');
        await apply('native-prepare-action', { checkpoint, seat: Number(seats[0]), action: COPY(inputs[seats[0]]) });
      } else if (decision.kind === 'switch-confirm' || decision.kind === 'switch-select' || decision.kind === 'wait-switch' || decision.kind === 'capture-choice') {
        check(inputs && Object.keys(inputs).length === 1, 'INCOMPLETE_SWITCH_INPUTS');
        await apply('native-switch', { checkpoint, inputs: COPY(inputs) });
      } else if (decision.kind === 'learn-move' || decision.kind === 'evolution') {
        check(inputs && Object.keys(inputs).length === 1, 'INCOMPLETE_PROGRESSION_INPUTS');
        const seat = Number(Object.keys(inputs)[0]);
        check(seat === 0 || seat === 1, 'INVALID_SEAT');
        await apply('native-progression', { checkpoint, seat, action: COPY(inputs[seat]) });
      } else check(decision.kind === 'continuing', 'UNSAFE_ADVANCE');
      const intermediate = contextFor(room, null, checkpoint, intents, context.formatVersion);
      const result = await runToStable(room, intermediate);
      result.events = [...events, ...result.events];
      result.intents = result.context.intents;
      return result;
    },

    async captureCheckpoint(context) {
      return {
        formatVersion: context.formatVersion ?? 2,
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
      check([2, 3].includes(checkpoint.formatVersion) && typeof checkpoint.runId === 'string'
        && checkpoint.runId.length > 0, 'INVALID_CHECKPOINT');
      check(checkpoint.provisioning && ['identities,seed','identities,seed,sharedPreparation','identities,roomSharing,seed','identities,roomSharing,seed,sharedPreparation'].includes(Object.keys(checkpoint.provisioning).sort().join(','))
        && (!Object.hasOwn(checkpoint.provisioning,'roomSharing') || checkpoint.provisioning.roomSharing===true)
        && (!Object.hasOwn(checkpoint.provisioning,'sharedPreparation') || checkpoint.provisioning.sharedPreparation === true)
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
      if (checkpoint.formatVersion === 3) return validateProfileCheckpoint(checkpoint);
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
      const room = await roomFor(checkpoint.runId, checkpoint.provisioning, checkpoint.formatVersion === PROFILE_FORMAT);
      // restore is also used for uncommitted candidates by the formal service.
      // This cache is diagnostic only; it is never a source for restoration.
      room.diagnosticCheckpoint = checkpoint.nativeCheckpoint;
      const context = contextFor(room, checkpoint.lobby, checkpoint.nativeCheckpoint, checkpoint.intents);
      context.formatVersion = checkpoint.formatVersion;
      context.profileLobby = checkpoint.formatVersion === 3 && checkpoint.lobby !== null;
      return context;
    },

    async projectSnapshot(context, seat) {
      check(seat === 0 || seat === 1, 'INVALID_SEAT');
      const room = await roomFor(context.runId, context.provisioning, context.formatVersion === PROFILE_FORMAT);
      if (context.profileLobby) {
        const id = lobbyId(context);
        const used = budgetOf(context.lobby.players);
        const selections = await Promise.all(context.lobby.players.map(async (player, owner) => ({
          seat: owner, state: player.profile ? player.selectionState ?? 'confirmed' : 'empty',
          ready: player.ready, total: player.priced?.total ?? 0,
          starters: player.profile ? await request(room, 'project-profile-selection', player.profile) : [],
        })));
        return {
          shared: { format: 3, stage: 'lobby', decision: { id, kind: 'lobby', requiredSeats: [0, 1] },
            ...(context.provisioning.roomSharing?{catalogReady:context.lobby.players.map(p=>!!p.profile?.catalog)}:{}),
            ready: context.lobby.players.map(player => player.ready),
            selections,
            budget: { shared: SHARED_BUDGET, personal: PERSONAL_BUDGET, used, remaining: SHARED_BUDGET - used } },
          personal: { format: 3, stage: 'lobby', seat,
            ...(context.provisioning.roomSharing?{roomSharing:true}:{}),
            profile: context.lobby.players[seat].profile ? clone(context.lobby.players[seat].profile) : null,
            priced: context.lobby.players[seat].priced ? clone(context.lobby.players[seat].priced) : null,
            ...(context.lobby.players.some(p=>p.profile?.catalog)?{roomCatalog:await request(room,'merge-room-catalogs',context.lobby.players.flatMap(p=>p.profile?.catalog?[p.profile.catalog]:[]))}:{}),
            party: [], eggs: context.lobby.players[seat].profile
              ? clone(context.lobby.players[seat].profile.eggs) : null, resources: null,
            decision: { id, kind: 'lobby', requiredSeats: [0, 1], options: null, players: null, switch: null } },
        };
      }
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
