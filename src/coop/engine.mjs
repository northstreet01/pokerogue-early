import CryptoJS from 'crypto-js';
import { species, moves } from './catalog.mjs';
import { getTypeDamageMultiplier } from './original-type.mjs';
import { getLevelTotalExp } from './original-exp.mjs';

export const ENGINE_VERSION = 'early-coop-0.1';
export const RULES = { version: ENGINE_VERSION, species, moves, levelCap: 10, waves: 10, abilities: false, evolution: false };
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
export const stateHash = value => CryptoJS.SHA256(canonical(value)).toString();
export const RULES_HASH = stateHash(RULES);
export const clone = value => JSON.parse(JSON.stringify(value));
function require(condition, reason) { if (!condition) throw new Error(reason); }
function random(state, limit) {
  let x = state.rng >>> 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  state.rng = x >>> 0;
  return Math.floor(state.rng / 4294967296 * limit);
}
const natureOrder = [1, 2, 5, 3, 4];
function stats(mon) {
  return species[mon.species].stats.map((base, i) => {
    const value = Math.floor((2 * base + mon.ivs[i]) * mon.level / 100);
    if (!i) return value + mon.level + 10;
    const up = natureOrder[Math.floor(mon.nature / 5)], down = natureOrder[mon.nature % 5];
    return Math.floor((value + 5) * (up === down ? 1 : i === up ? 1.1 : i === down ? 0.9 : 1));
  });
}
export function createMon(id, choice, level = 5) {
  require(Number.isInteger(choice.species) && species[choice.species], '尚未接入此精灵');
  require(Array.isArray(choice.ivs) && choice.ivs.length === 6 && choice.ivs.every(v => Number.isInteger(v) && v >= 0 && v <= 31), '个体值无效');
  require(Number.isInteger(choice.nature) && choice.nature >= 0 && choice.nature < 25, '性格无效');
  const dexAttr = BigInt(choice.dexAttr ?? 149);
  require(dexAttr >= 0n && dexAttr <= 255n && (dexAttr & 128n) && (dexAttr & 3n) && (dexAttr & 12n) && (dexAttr & 112n), '仅支持普通形态');
  const learned = [...new Set(species[choice.species].learnset.filter(([at]) => at <= level).map(([, move]) => move))].slice(-4);
  require(learned.length > 0, '此精灵尚无可用招式');
  const mon = { id, species: choice.species, level, exp: getLevelTotalExp(level, species[choice.species].growth), ivs: [...choice.ivs], nature: choice.nature,
    dexAttr: dexAttr.toString(), status: null, stages: [0, 0, 0, 0, 0, 0], moves: learned.map(id => ({ id, pp: moves[id].pp })), pendingLearn: [] };
  mon.stats = stats(mon); mon.hp = mon.stats[0];
  return mon;
}
export function createRun(id, seed, choices, names = ['玩家 1', '玩家 2']) {
  require(choices.length === 2, '需要两名玩家');
  const state = { version: ENGINE_VERSION, rulesHash: RULES_HASH, id, rng: (seed >>> 0) || 1, revision: 1,
    phase: 'input', wave: 1, round: 1, players: [], enemies: [], grants: [], events: [] };
  choices.forEach((team, seat) => {
    require(team.length === 3 && new Set(team.map(m => m.species)).size === 3, '每人选择 3 种不同精灵');
    const party = team.map((mon, i) => createMon(`${id}:p${seat}:${i}`, mon));
    state.players.push({ name: names[seat], party, reserve: [], active: party[0].id, money: 1000, bag: { ball: 5, potion: 2, revive: 0, ether: 0 }, ready: false, rewardTaken: false });
  });
  spawnWave(state);
  return state;
}
function event(state, text) { state.events.push(text); }
const living = player => player.party.filter(mon => mon.hp > 0);
export const activeMon = player => player.party.find(mon => mon.id === player.active && mon.hp > 0);
export function requiredSeats(state) {
  return state.players.flatMap((player, seat) => state.phase === 'input' ? (activeMon(player) ? [seat] : []) : state.phase === 'replace' ? (!activeMon(player) && living(player).length ? [seat] : []) : []);
}
function spawnWave(state) {
  const pool = [10, 16, 19, 25, 74, 133];
  state.enemies = [0, 1].map(slot => createMon(`${state.id}:w${state.wave}:e${slot}`, {
    species: pool[random(state, pool.length)], ivs: Array.from({ length: 6 }, () => random(state, 32)), nature: random(state, 25), dexAttr: random(state, 2) ? '149' : '153'
  }, Math.min(10, 4 + Math.ceil(state.wave / 2))));
  state.players.forEach(player => { player.ready = false; player.rewardTaken = false; player.party.forEach(mon => mon.stages.fill(0)); });
  state.phase = 'input'; state.round = 1;
  event(state, `第 ${state.wave} 波，两只野生精灵出现。`);
  state.players.forEach((player, seat) => state.enemies.forEach(mon => state.grants.push({ id: `${mon.id}:seen:${seat}`, seat, kind: 'seen', mon: clone(mon) })));
}
function validateItem(player, action, battle) {
  require(['potion', 'revive', 'ether'].includes(action.item) && player.bag[action.item] > 0, '道具不足');
  const mon = player.party.find(mon => mon.id === action.mon);
  require(mon, '只能使用于自己的队伍');
  if (action.item === 'potion') require(mon.hp > 0 && mon.hp < mon.stats[0], '不需要回复 HP');
  if (action.item === 'revive') require(!battle && mon.hp === 0, '复活仅可在战后使用');
  if (action.item === 'ether') require(mon.moves.some(move => move.pp < moves[move.id].pp), '不需要回复 PP');
}
export function validateAction(state, seat, action) {
  require(state.phase === 'input' && requiredSeats(state).includes(seat), '当前不能行动');
  const player = state.players[seat], mon = activeMon(player);
  require(action && typeof action === 'object', '行动无效');
  if (action.kind === 'move') {
    const move = mon.moves.find(move => move.id === action.move);
    require(action.move === 165 ? mon.moves.every(move => move.pp === 0) : move?.pp > 0, '招式无效或 PP 用尽');
    require(Number.isInteger(action.target) && action.target >= 0 && action.target <= 1 && state.enemies[action.target]?.hp > 0, '目标无效');
  } else if (action.kind === 'capture') {
    require(player.bag.ball > 0 && state.enemies.some(mon => mon.id === action.target && mon.hp > 0), '精灵球不足或目标已离场');
  } else if (action.kind === 'switch') {
    require(player.party.some(next => next.id === action.mon && next.hp > 0 && next.id !== mon.id), '替换精灵无效');
  } else if (action.kind === 'item') validateItem(player, action, true);
  else throw new Error('不支持的行动');
}
const stageMultiplier = stage => stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
function speed(mon) { return mon.stats[5] * stageMultiplier(mon.stages[5]) * (mon.status === 'paralysis' ? 0.5 : 1); }
function useItem(player, action) {
  const mon = player.party.find(mon => mon.id === action.mon);
  if (action.item === 'potion') { if (!mon.hp || mon.hp === mon.stats[0]) return false; mon.hp = Math.min(mon.stats[0], mon.hp + 20); }
  if (action.item === 'revive') { if (mon.hp) return false; mon.hp = Math.ceil(mon.stats[0] / 2); mon.status = null; }
  if (action.item === 'ether') mon.moves.forEach(move => { move.pp = Math.min(moves[move.id].pp, move.pp + 10); });
  player.bag[action.item]--; return true;
}
function attack(state, source, targets, moveId) {
  const move = moves[moveId], live = targets.filter(mon => mon?.hp > 0);
  if (!live.length) { event(state, `${species[source.species].name} 的目标离场，本回合行动取消，未消耗 PP。`); return; }
  if (source.status === 'paralysis' && random(state, 4) === 0) { event(state, `${species[source.species].name} 麻痹，无法行动。`); return; }
  if (moveId !== 165) source.moves.find(slot => slot.id === moveId).pp--;
  if (move.key === 'SPLASH') { event(state, 'Splash 没有产生效果。'); return; }
  for (const target of live) {
    if (move.accuracy >= 0 && random(state, 100) >= move.accuracy) { event(state, `${move.name} 未命中。`); continue; }
    if (move.category === 'STATUS') {
      const stat = move.key === 'GROWL' ? 1 : 2; target.stages[stat] = Math.max(-6, target.stages[stat] - 1);
      event(state, `${move.name} 降低了 ${species[target.species].name} 的${stat === 1 ? '攻击' : '防御'}。`); continue;
    }
    const effectiveness = moveId === 165 ? 1 : species[target.species].types.reduce((n, type) => n * getTypeDamageMultiplier(move.type, type), 1);
    if (!effectiveness) { event(state, `${move.name} 对目标无效。`); continue; }
    const critical = random(state, 24) === 0;
    const index = move.category === 'PHYSICAL' ? 1 : 3, defense = index + 1;
    const atkStage = critical ? Math.max(0, source.stages[index]) : source.stages[index];
    const defStage = critical ? Math.min(0, target.stages[defense]) : target.stages[defense];
    const atk = source.stats[index] * stageMultiplier(atkStage), def = target.stats[defense] * stageMultiplier(defStage);
    const stab = moveId !== 165 && species[source.species].types.includes(move.type) ? 1.5 : 1;
    const burn = source.status === 'burn' && index === 1 ? 0.5 : 1;
    const damage = Math.max(1, Math.ceil(((2 * source.level / 5 + 2) * move.power * atk / def / 50 + 2) * stab * effectiveness * (85 + random(state, 16)) / 100 * burn * (critical ? 1.5 : 1)));
    target.hp = Math.max(0, target.hp - damage);
    event(state, `${species[source.species].name} 使用 ${move.name}，${species[target.species].name} 损失 ${damage} HP${critical ? '（击中要害）' : ''}。`);
    if (target.hp && !target.status && ['EMBER', 'THUNDER_SHOCK'].includes(move.key) && random(state, 100) < 10) {
      if (move.key === 'EMBER' && !species[target.species].types.includes(9)) target.status = 'burn';
      if (move.key === 'THUNDER_SHOCK' && !species[target.species].types.includes(12)) target.status = 'paralysis';
    }
  }
  if (moveId === 165) source.hp = Math.max(0, source.hp - Math.ceil(source.stats[0] / 4));
}
function awardExp(state, enemies) {
  const total = enemies.reduce((sum, mon) => sum + Math.floor(species[mon.species].baseExp * mon.level / 7), 0);
  for (const player of state.players) for (const mon of player.party) {
    if (!mon.hp) continue;
    mon.exp += Math.floor(total / 3);
    while (mon.level < 10 && mon.exp >= getLevelTotalExp(mon.level + 1, species[mon.species].growth)) {
      const oldMax = mon.stats[0]; mon.level++; mon.stats = stats(mon); mon.hp += mon.stats[0] - oldMax;
      for (const [level, id] of species[mon.species].learnset) if (level === mon.level && !mon.moves.some(move => move.id === id)) {
        if (mon.moves.length < 4) mon.moves.push({ id, pp: moves[id].pp }); else mon.pendingLearn.push(id);
      }
    }
  }
}
function finish(state) {
  if (state.players.every(player => !living(player).length)) { state.phase = 'over'; event(state, '两人队伍全部倒下，本次冒险结束。'); }
  else if (state.enemies.every(mon => mon.hp <= 0)) {
    awardExp(state, state.enemies); state.phase = 'prep';
    state.players.forEach(player => {
      player.money += 200 + state.wave * 20;
      if (!living(player).length) { player.party[0].hp = Math.ceil(player.party[0].stats[0] / 2); player.party[0].status = null; }
      if (!activeMon(player)) player.active = living(player)[0].id;
    });
    event(state, '战斗结束，各自领取奖励、购物和整备；倒下玩家获得一次半血恢复。');
  } else if (state.players.some(player => !activeMon(player) && living(player).length)) state.phase = 'replace';
}
/** One resolution consumes inputs in seat order, never socket arrival order. */
export function resolveRound(input, actions) {
  const state = clone(input); state.events = [];
  const required = requiredSeats(state); required.forEach(seat => validateAction(state, seat, actions[seat]));
  const queue = required.map(seat => {
    const mon = activeMon(state.players[seat]), action = actions[seat];
    return { seat, actor: mon.id, action, priority: action.kind === 'switch' ? 7 : ['capture', 'item'].includes(action.kind) ? 6 : moves[action.move].priority, speed: speed(mon), tie: random(state, 4294967296) };
  });
  state.enemies.forEach((mon, slot) => {
    if (!mon.hp) return;
    const available = mon.moves.filter(move => move.pp > 0), move = available.length ? available[random(state, available.length)].id : 165;
    const targets = required.filter(seat => activeMon(state.players[seat]));
    queue.push({ enemy: slot, actor: mon.id, action: { kind: 'move', move, target: targets[random(state, targets.length)] }, priority: moves[move].priority, speed: speed(mon), tie: random(state, 4294967296) });
  });
  queue.sort((a, b) => b.priority - a.priority || b.speed - a.speed || b.tie - a.tie);
  for (const entry of queue) {
    const player = entry.seat === undefined ? null : state.players[entry.seat];
    const actor = player ? activeMon(player) : state.enemies[entry.enemy];
    if (!actor?.hp || actor.id !== entry.actor) continue;
    const action = entry.action;
    if (action.kind === 'switch') { actor.stages.fill(0); player.active = action.mon; event(state, `${player.name} 替换精灵。`); }
    else if (action.kind === 'item') { event(state, useItem(player, action) ? `${player.name} 使用 ${action.item}。` : '道具目标状态改变，行动取消，未消耗道具。'); }
    else if (action.kind === 'capture') {
      const target = state.enemies.find(mon => mon.id === action.target && mon.hp > 0);
      if (!target) { event(state, '捕获目标已离场，行动取消，未消耗精灵球。'); continue; }
      player.bag.ball--;
      const x = Math.round((3 * target.stats[0] - 2 * target.hp) * species[target.species].catchRate / (3 * target.stats[0]) * (target.status ? 1.5 : 1));
      const y = Math.round(65536 / Math.sqrt(Math.sqrt(255 / x)));
      let caught = true;
      for (let shake = 0; shake < 4; shake++) if (random(state, 65536) >= y) { caught = false; break; }
      if (caught) {
        const captured = clone(target); captured.stages.fill(0); player.reserve.push(captured); target.hp = 0; target.captured = true;
        state.grants.push({ id: `${target.id}:caught`, seat: entry.seat, kind: 'caught', mon: captured });
        event(state, `${player.name} 捕获 ${species[target.species].name}，收入本局备用列表。`);
      } else event(state, '捕获失败。');
    } else {
      let targets = player ? [state.enemies[action.target]] : [activeMon(state.players[action.target])];
      if (['GROWL', 'TAIL_WHIP'].includes(moves[action.move].key)) targets = player ? state.enemies : state.players.map(activeMon);
      if (moves[action.move].key === 'SPLASH') targets = [actor];
      attack(state, actor, targets, action.move);
    }
  }
  const field = [...state.players.map(activeMon).filter(Boolean), ...state.enemies.filter(mon => mon.hp > 0)];
  field.forEach(mon => { if (mon.status === 'burn') { mon.hp = Math.max(0, mon.hp - Math.max(1, Math.floor(mon.stats[0] / 16))); event(state, `${species[mon.species].name} 受到灼伤伤害。`); } });
  finish(state); state.round++; state.revision++;
  return state;
}
export function replaceFainted(input, choices) {
  const state = clone(input); require(state.phase === 'replace', '当前不需要替换');
  requiredSeats(state).forEach(seat => {
    require(state.players[seat].party.some(mon => mon.id === choices[seat] && mon.hp > 0), '替换精灵无效');
    state.players[seat].active = choices[seat];
  });
  state.phase = 'input'; state.revision++; state.events = ['双方完成战斗后替换。']; return state;
}
export const SHOP = { ball: 200, potion: 300, revive: 600, ether: 400 };
export function prepare(input, seat, action) {
  const state = clone(input), player = state.players[seat];
  require(state.phase === 'prep', '当前不是整备阶段');
  require(!player.ready || action.kind === 'unready', '请先取消准备');
  state.events = [];
  if (action.kind === 'buy') {
    require(SHOP[action.item] && player.money >= SHOP[action.item], '金钱不足或商品无效');
    player.money -= SHOP[action.item]; player.bag[action.item]++;
  } else if (action.kind === 'reward') {
    require(!player.rewardTaken && ['ball', 'potion', 'ether'].includes(action.item), '奖励无效或已领取');
    player.bag[action.item]++; player.rewardTaken = true;
  } else if (action.kind === 'item') { validateItem(player, action, false); useItem(player, action); }
  else if (action.kind === 'reserve') {
    const index = player.reserve.findIndex(mon => mon.id === action.mon), target = player.party.findIndex(mon => mon.id === action.replace);
    require(index >= 0 && target >= 0, '只能替换自己的本局队伍');
    [player.party[target], player.reserve[index]] = [player.reserve[index], player.party[target]];
    if (player.active === action.replace) player.active = player.party[target].hp ? player.party[target].id : living(player)[0]?.id ?? null;
  } else if (action.kind === 'active') {
    require(player.party.some(mon => mon.id === action.mon && mon.hp > 0), '出场精灵无效'); player.active = action.mon;
  } else if (action.kind === 'learn') {
    const mon = player.party.find(mon => mon.id === action.mon);
    require(mon?.pendingLearn.length && Number.isInteger(action.slot) && action.slot >= -1 && action.slot < mon.moves.length, '学习决策无效');
    const id = mon.pendingLearn.shift(); if (action.slot >= 0) mon.moves[action.slot] = { id, pp: moves[id].pp };
  } else if (action.kind === 'ready') {
    require(player.rewardTaken && living(player).length && !player.party.some(mon => mon.pendingLearn.length), '请先领取奖励、恢复队伍并处理招式学习'); player.ready = true;
  } else if (action.kind === 'unready') player.ready = false;
  else throw new Error('整备指令无效');
  state.revision++; return state;
}
export function nextWave(input) {
  const state = clone(input); require(state.phase === 'prep' && state.players.every(player => player.ready), '两人尚未准备');
  state.events = [];
  if (state.wave === RULES.waves) { state.phase = 'over'; event(state, '10 波验证冒险完成。'); }
  else { state.wave++; spawnWave(state); }
  state.revision++; return state;
}
