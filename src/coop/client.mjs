import './style.css';
import { ENGINE_VERSION, RULES_HASH, activeMon, requiredSeats, SHOP } from './engine.mjs';
import { applySnapshot } from './snapshot-sync.mjs';
import { species, moves } from './catalog.mjs';
import { readLocalSave, mutateLocalSaves } from '../system/local-save-store';
import { acquireProfile, releaseProfile, prepareExperimentalProfile, applyCollectionGrants } from './local-profile';

const app = document.getElementById('app');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const id = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
// Duplicated tabs inherit sessionStorage: each document must have a distinct lease owner.
const owner = id();
let profile, socket, view, model, problem = '', halted = false, pending = false, connecting = false, renewal;
let selected = [1, 4, 7], selectedNatures = {}, chain = Promise.resolve();
let renderedSignature = '';
let roomCredentials = [];
const natureNames = ['勤奋','孤独','勇敢','固执','顽皮','大胆','坦率','悠闲','淘气','乐天','胆小','急躁','认真','爽朗','天真','内敛','慢吞吞','冷静','害羞','马虎','温和','温顺','自大','慎重','浮躁'];
function credential() { try { return JSON.parse(sessionStorage.getItem('coop-seat') ?? 'null'); } catch { return null; } }
function send(message) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ version: ENGINE_VERSION, rulesHash: RULES_HASH, ...message })); }
function command(type, action) {
  pending = true; send({ type, id: id(), revision: model?.revision, ...(type === 'team' ? { team: action } : { action }) }); render();
}
function natures(speciesId) { return natureNames.flatMap((name, index) => profile.dexData[speciesId].natureAttr & 2 ** (index + 1) ? [{ name, index }] : []); }
function selection() {
  return selected.map(speciesId => {
    const entry = profile.dexData[speciesId], attr = BigInt(entry.caughtAttr);
    if (!attr) throw new Error('只能选择自己的收藏');
    return { species: speciesId, ivs: entry.ivs, nature: selectedNatures[speciesId] ?? natures(speciesId)[0]?.index ?? 0,
      dexAttr: ((attr & 1n ? 1n : 2n) | (attr & 4n ? 4n : 8n) | (attr & 16n ? 16n : attr & 32n ? 32n : 64n) | 128n).toString() };
  });
}
async function connect(type) {
  if (connecting || socket?.readyState === WebSocket.OPEN) return;
  connecting = true;
  try {
    if (!profile) throw new Error('请先在单人入口完成初始设置，再刷新此页面');
    const name = document.getElementById('name').value.trim(), code = document.getElementById('room').value.trim().toUpperCase();
    const saved = roomCredentials.find(entry => entry.code === code) ?? credential();
    if (type === 'resume' && !saved) throw new Error('本机没有该房间的恢复凭据，请使用原设备或导入本地备份');
    if (type === 'resume' && code && saved.code !== code) throw new Error('本机没有所填房间的恢复凭据');
    await acquireProfile(owner);
    profile = await prepareExperimentalProfile(owner);
    if (type === 'resume' && saved.profileKey && saved.profileKey !== `${profile.trainerId}:${profile.secretId}`) throw new Error('当前收藏档案与该席位不匹配，请恢复对应本地备份');
    clearInterval(renewal);
    renewal = setInterval(() => acquireProfile(owner).catch(error => { halted = true; problem = error.message; socket?.close(); render(); }), 10000);
    socket?.close(); view = null; model = null; pending = false; problem = ''; halted = false;
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/coop/ws`);
    const current = socket;
    const isCurrent = () => socket === current && current.readyState === WebSocket.OPEN;
    const sendCurrent = message => { if (isCurrent()) send(message); };
    current.onopen = () => { if (!isCurrent()) return; connecting = false; sendCurrent(type === 'create' ? { type: 'create', name } : { type: 'join', name, code: type === 'resume' ? saved.code : code, ...(type === 'resume' ? { token: saved.token } : {}) }); };
    current.onmessage = event => {
      chain = chain.then(async () => {
        if (!isCurrent()) return;
        const message = JSON.parse(event.data);
        if (message.type === 'joined') {
          const entry = { code: message.code, seat: message.seat, token: message.token, profileKey: `${profile.trainerId}:${profile.secretId}` };
          await mutateLocalSaves(['coop-seats'], records => {
            const entries = records['coop-seats'] ? JSON.parse(records['coop-seats']).entries : [];
            roomCredentials = [...entries.filter(saved => saved.code !== entry.code), entry];
            return { 'coop-seats': JSON.stringify({ entries: roomCredentials }) };
          });
          if (!isCurrent()) return;
          sessionStorage.setItem('coop-seat', JSON.stringify(entry));
        }
        else if (message.type === 'snapshot') {
          const actual = await applySnapshot(message, { isCurrent, send: sendCurrent, canAcknowledge: () => !halted,
            saveGrants: async grants => { await acquireProfile(owner); await applyCollectionGrants(owner, grants); } });
          if (!isCurrent()) return;
          model = actual; view = message;
          if (message.storageError) problem = '服务器存档写入失败，已暂停；存储恢复后点击“重新获取完整状态”。';
        } else if (message.type === 'receipt') pending = false;
        else if (message.type === 'error') { problem = message.message; pending = false; }
        render();
      }).catch(error => { if (socket !== current) return; halted = true; pending = false; problem = '同步或本地保存失败，已停止确认状态：' + error.message; render(); });
    };
    current.onclose = () => { if (socket === current) { connecting = false; pending = false; problem = '连接已断开。战斗暂停，请使用“恢复本机席位”重连。'; render(); } };
    current.onerror = () => { if (socket !== current) return; problem = '无法连接联机服务，请确认使用了 npm run start 或 start:server'; render(); };
    render();
  } catch (error) { connecting = false; clearInterval(renewal); await releaseProfile(owner).catch(() => {}); problem = error.message; render(); }
}
function monCard(mon, label) {
  if (!mon) return `<div class="card muted">${escape(label)} · 没有出场精灵</div>`;
  return `<div class="card ${mon.hp ? '' : 'muted'}"><div class="row"><img src="/images/pokemon/icons/${mon.species}.png" alt=""><div><strong>${escape(species[mon.species].name)}</strong> <span class="tag">Lv.${mon.level}</span><p>${escape(label)}${mon.status ? ' · ' + escape(mon.status) : ''}</p></div></div><div class="hp"><span style="width:${Math.max(0, mon.hp / mon.stats[0] * 100)}%"></span></div>HP ${mon.hp}/${mon.stats[0]}</div>`;
}
function button(label, attrs, disabled = false) { return `<button ${attrs} ${disabled ? 'disabled' : ''}>${escape(label)}</button>`; }
function lobby() {
  const available = Object.values(species).filter(mon => BigInt(profile?.dexData?.[mon.id]?.caughtAttr ?? 0) > 0n);
  const options = chosen => available.map(mon => `<option value="${mon.id}" ${mon.id === chosen ? 'selected' : ''}>${escape(mon.name)}</option>`).join('');
  return `<section class="panel"><h2>房间 ${view.code} · 你是玩家 ${view.seat + 1}</h2><p>${view.lobby.map((entry, index) => `玩家 ${index + 1}：${entry ? escape(entry.name) + (entry.ready ? '（已选队伍）' : '（选队伍中）') : '等待加入'}`).join(' ／ ')}</p><p class="notice">从本地收藏选 3 种精灵。新冒险从 Lv.5、满 HP／PP 开始。个体值、已解锁性格和外观来自收藏。</p>${selected.map((choice, index) => `<div class="choice"><label>精灵 ${index + 1} <select data-team="${index}">${options(choice)}</select></label><label>性格 <select data-nature="${choice}">${natures(choice).map(nature => `<option value="${nature.index}" ${selectedNatures[choice] === nature.index ? 'selected' : ''}>${nature.name}</option>`).join('')}</select></label></div>`).join('')}${button('确认队伍并准备', 'id="team"', pending)}</section>`;
}
function battleControls(player, enabled) {
  if (view.submitted[view.seat]) return '<p class="status">你的行动已提交，等待另一位玩家。</p>';
  if (!requiredSeats(model).includes(view.seat)) return '<p>你的队伍全部倒下，正在观战。存活玩家继续，胜利后可恢复。</p>';
  if (model.phase === 'replace') return `<h2>选择替换精灵</h2><div class="row">${player.party.filter(mon => mon.hp > 0).map(mon => button(species[mon.species].name, `data-switch="${mon.id}"`, !enabled)).join('')}</div>`;
  const mon = activeMon(player), enemies = model.enemies.flatMap((enemy, slot) => enemy.hp > 0 ? [{ enemy, slot }] : []);
  return `<h2>本回合行动</h2><label>攻击／捕获目标 <select id="target" ${enabled ? '' : 'disabled'}>${enemies.map(({ enemy, slot }) => `<option value="${slot}">${slot + 1}：${escape(species[enemy.species].name)} (${enemy.hp} HP)</option>`).join('')}</select></label><div class="row" style="margin-top:14px">${mon.moves.map(move => button(`${moves[move.id].name} · PP ${move.pp}/${moves[move.id].pp}`, `data-move="${move.id}"`, !enabled || !move.pp)).join('')}${mon.moves.every(move => !move.pp) ? button('Struggle', 'data-move="165"', !enabled) : ''}${button(`捕获（精灵球 ${player.bag.ball}）`, 'id="capture"', !enabled || !player.bag.ball)}</div><h2>替换 / 道具（占用本回合）</h2><div class="row">${player.party.filter(next => next.hp > 0 && next.id !== mon.id).map(next => button(`换上 ${species[next.species].name}`, `data-switch="${next.id}"`, !enabled)).join('')}</div>${items(player, enabled, true)}`;
}
function items(player, enabled, battle) {
  return `<div class="row" style="margin-top:12px">${player.party.map(mon => ['potion','ether', ...(battle ? [] : ['revive'])].map(item => {
    const needed = item === 'potion' ? mon.hp > 0 && mon.hp < mon.stats[0] : item === 'revive' ? !mon.hp : mon.moves.some(move => move.pp < moves[move.id].pp);
    return button(`${species[mon.species].name}：${item}`, `data-item="${item}" data-mon="${mon.id}"`, !enabled || !player.bag[item] || !needed);
  }).join('')).join('')}</div>`;
}
function preparation(player, enabled) {
  return `<h2>个人整备</h2><p>你的金钱：${player.money} · 背包：${escape(JSON.stringify(player.bag))}</p><div class="row">${['ball','potion','ether'].map(item => button(`免费奖励：${item}`, `data-reward="${item}"`, !enabled || player.rewardTaken || player.ready)).join('')}</div><h2>个人商店</h2><div class="row">${Object.entries(SHOP).map(([item, price]) => button(`${item} · ${price}`, `data-buy="${item}"`, !enabled || player.money < price || player.ready)).join('')}</div>${items(player, enabled && !player.ready, false)}<h2>下一战出场</h2><div class="row">${player.party.map(mon => button(species[mon.species].name, `data-active="${mon.id}"`, !enabled || player.ready || !mon.hp || mon.id === player.active)).join('')}</div>${player.reserve.length ? '<h2>本局备用精灵（冒险结束后重置）</h2>' + player.reserve.map(mon => `<div class="row"><span>${escape(species[mon.species].name)} Lv.${mon.level}</span>${player.party.map(target => button(`替换 ${species[target.species].name}`, `data-reserve="${mon.id}" data-replace="${target.id}"`, !enabled || player.ready)).join('')}</div>`).join('') : ''}${player.party.filter(mon => mon.pendingLearn.length).map(mon => `<h2>${escape(species[mon.species].name)} 学习 ${escape(moves[mon.pendingLearn[0]].name)}</h2><div class="row">${mon.moves.map((move, slot) => button(`忘记 ${moves[move.id].name}`, `data-learn="${mon.id}" data-slot="${slot}"`, !enabled || player.ready)).join('')}${button('不学习', `data-learn="${mon.id}" data-slot="-1"`, !enabled || player.ready)}</div>`).join('')}<div class="row" style="margin-top:22px">${button(player.ready ? '取消准备' : '准备下一波', 'id="ready"', !enabled)}${button('战后保存并暂停', 'id="save"', !enabled)}${model.wave === 10 ? '<span>双方准备后结束验证冒险。</span>' : ''}</div>`;
}
function render() {
  const joined = !!view, online = socket?.readyState === WebSocket.OPEN;
  const enabled = online && !halted && !pending && view && !view.barrier && !view.paused && !view.saved;
  const saved = credential();
  const signature = JSON.stringify({ online, connecting, pending, halted, problem, profile: !!profile, saved: saved?.code, selected, selectedNatures,
    view: view && { code: view.code, hash: view.hash, lobby: view.lobby, barrier: view.barrier, acked: view.acked, online: view.online,
      saved: view.saved, ownSubmitted: view.submitted[view.seat] } });
  if (signature === renderedSignature) return;
  renderedSignature = signature;
  const previousTarget = document.getElementById('target')?.value;
  app.innerHTML = `<main><div class="row"><h1>Early · 联机实验室</h1><a href="/" id="solo">单人／扭蛋</a><a href="/save-tools.html" id="saves">本地备份</a></div><p class="notice">独立技术验证页，尚未接入原游戏。10 波 / 等级上限 10 / 10 种精灵 / 14 个招式仅为实验限制，不是正式玩法。首次连接复制本地收藏到实验副本；后续实验捕获不写回正式图鉴。</p><p id="message" class="error">${escape(problem)}</p><section class="panel"><div class="row"><label>昵称 <input id="name" maxlength="24" value="${escape(view?.lobby?.[view.seat]?.name ?? '训练家')}"></label><label>房间码 <input id="room" maxlength="6" value="${escape(view?.code ?? saved?.code ?? '')}"></label>${button('创建房间', 'id="create"', online || connecting)}${button('加入房间', 'id="join"', online || connecting)}${button('恢复本机席位', 'id="reconnect"', !saved || online || connecting)}${button('退出连接', 'id="disconnect"', !online)}</div><p class="notice">两台设备打开同一服务器的 /coop.html。邀请只需房间码；恢复凭据保存在本机，可随本地备份导出。恢复旧房间时填写对应房间码。</p></section>${joined && !model ? lobby() : ''}${model ? `<section class="panel"><div class="row"><h2>房间 ${view.code} · 第 ${model.wave} 波 / 回合 ${model.round}</h2><span class="tag">状态版本 ${model.revision}</span><span class="status">${view.saved ? '已保存，等待恢复' : view.storageError ? '服务器存储故障，战斗暂停' : view.paused ? '玩家断线，战斗暂停' : view.barrier ? '等待双方校验并保存收藏' : model.phase === 'over' ? '冒险结束' : '双方状态一致'}</span></div><p class="notice">在线：${view.online.map((value,index) => `玩家 ${index + 1} ${value ? '在线' : '离线'}`).join(' / ')} · 校验：${view.acked.map(value => value ? '已确认' : '等待').join(' / ')} · ${view.hash.slice(0, 16)}</p><div class="board">${model.enemies.map((mon,index) => monCard(mon, `敌人位置 ${index + 1}`)).join('')}${model.players.map(player => monCard(activeMon(player), player.name)).join('')}</div><div class="teams">${model.players.map((player,seat) => `<div><h2>${escape(player.name)}${seat === view.seat ? '（你）' : ''}</h2>${player.party.map(mon => `<p>${escape(species[mon.species].name)} Lv.${mon.level} · HP ${mon.hp}/${mon.stats[0]}</p>`).join('')}</div>`).join('')}</div><div class="events"><ul>${model.events.map(text => `<li>${escape(text)}</li>`).join('')}</ul></div></section><section class="panel">${model.phase === 'prep' && !view.saved ? preparation(model.players[view.seat], enabled) : ['input','replace'].includes(model.phase) ? battleControls(model.players[view.seat], enabled) : view.saved ? button('恢复已保存的冒险', 'id="resume"', !online || view.paused || view.barrier || pending) : '<p>实验已结束。实验收藏保留在独立副本，不写回正式图鉴。退出后可创建新的实验。</p>'}</section>` : !profile ? '<p>本机尚无收藏存档，请进入单人游戏完成初始设置后返回。</p>' : ''}${button('重新获取完整状态', 'id="resync"', !online || !model)}</main>`;
  const targetSelect = document.getElementById('target');
  if (targetSelect && [...targetSelect.options].some(option => option.value === previousTarget)) targetSelect.value = previousTarget;
  document.getElementById('create').onclick = () => connect('create'); document.getElementById('join').onclick = () => connect('join');
  document.getElementById('reconnect').onclick = () => connect('resume');
  document.getElementById('disconnect').onclick = async () => { socket?.close(); clearInterval(renewal); await releaseProfile(owner); view = null; model = null; render(); };
  for (const link of ['solo','saves']) document.getElementById(link).onclick = async event => { event.preventDefault(); socket?.close(); clearInterval(renewal); await releaseProfile(owner); location.href = link === 'solo' ? '/' : '/save-tools.html'; };
  document.getElementById('resync').onclick = () => { halted = false; problem = ''; pending = false; send({ type: 'snapshot' }); };
  document.querySelectorAll('[data-team]').forEach(select => { select.onchange = () => { selected[Number(select.dataset.team)] = Number(select.value); render(); }; });
  document.querySelectorAll('[data-nature]').forEach(select => { select.onchange = () => { selectedNatures[select.dataset.nature] = Number(select.value); }; });
  document.getElementById('team')?.addEventListener('click', () => { try { command('team', selection()); } catch (error) { problem = error.message; render(); } });
  const target = () => Number(document.getElementById('target').value);
  document.querySelectorAll('[data-move]').forEach(button => { button.onclick = () => command('action', { kind: 'move', move: Number(button.dataset.move), target: target() }); });
  document.getElementById('capture')?.addEventListener('click', () => command('action', { kind: 'capture', target: model.enemies[target()].id }));
  document.querySelectorAll('[data-switch]').forEach(button => { button.onclick = () => command('action', { kind: 'switch', mon: button.dataset.switch }); });
  document.querySelectorAll('[data-item]').forEach(button => { button.onclick = () => command(model.phase === 'prep' ? 'prepare' : 'action', { kind: 'item', item: button.dataset.item, mon: button.dataset.mon }); });
  for (const kind of ['reward','buy','active','reserve','learn']) document.querySelectorAll(`[data-${kind}]`).forEach(button => { button.onclick = () => command('prepare', { kind, ...(kind === 'reward' || kind === 'buy' ? { item: button.dataset[kind] } : { mon: button.dataset[kind] }), ...(kind === 'reserve' ? { replace: button.dataset.replace } : {}), ...(kind === 'learn' ? { slot: Number(button.dataset.slot) } : {}) }); });
  document.getElementById('ready')?.addEventListener('click', () => command('prepare', { kind: model.players[view.seat].ready ? 'unready' : 'ready' }));
  document.getElementById('save')?.addEventListener('click', () => command('save'));
  document.getElementById('resume')?.addEventListener('click', () => command('resume'));
}
async function initialize() {
  try {
    const raw = await readLocalSave('data'); profile = raw ? JSON.parse(raw) : null;
    const seats = await readLocalSave('coop-seats');
    roomCredentials = seats ? JSON.parse(seats).entries : [];
    if (!credential()) {
      const latest = roomCredentials.at(-1);
      if (latest) sessionStorage.setItem('coop-seat', JSON.stringify(latest));
    }
  }
  catch (error) { problem = '本地收藏读取失败：' + error.message; }
  render();
}
void initialize();
