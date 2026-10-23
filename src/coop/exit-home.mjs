// Only the return from cooperative exit adds this small navigation notice.
// The existing solo title screen and all three game entry points stay separate.
export function showCoopExitReturn(doc = document, page = location) {
  const result = new URLSearchParams(page.search).get('coopExit');
  if (!['saved', 'limited'].includes(result)) return null;
  if (doc.getElementById('coop-exit-return')) return doc.getElementById('coop-exit-return');
  const notice = doc.createElement('aside'); notice.id = 'coop-exit-return';
  notice.setAttribute('aria-label', '已退出联机');
  Object.assign(notice.style, { position: 'fixed', top: '0', left: '0', right: '0', zIndex: '1000',
    padding: '8px 12px', background: '#111b2b', color: '#fff', font: '14px/1.5 system-ui',
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' });
  const message = doc.createElement('span'); message.setAttribute('role', 'status');
  message.textContent = result === 'saved'
    ? '已离开当前联机并关闭自动续局。房间与已提交行动保留，个人存档未清除。'
    : '已离开当前联机，但退出记录未确认保存。请从下方入口重开，避免自动续旧房；新建／加入仍需本地存储可用。';
  const link = doc.createElement('a'); link.href = '/coop-play.html?fresh=1';
  link.textContent = '重新进入联机'; link.style.color = '#9ac7ff';
  const solo = doc.createElement('button'); solo.type = 'button'; solo.textContent = '继续单人界面';
  solo.addEventListener('click', () => notice.remove());
  for (const type of ['keydown', 'keyup']) notice.addEventListener(type, event => event.stopPropagation());
  notice.append(message, link, solo); doc.body.append(notice);
  return notice;
}
if (typeof document !== 'undefined') showCoopExitReturn();
