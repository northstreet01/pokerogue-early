import {deviceStorage} from './platform/preferences.mjs';
import { readLocalSaveSnapshot, sessionSaveKey, restoreLocalSaves } from './system/local-save-store';

const status = document.getElementById('status');
const details = document.getElementById('details');
const exportButton = document.getElementById('export') as HTMLButtonElement;
let snapshot: Record<string, string> = {};

async function refresh() {
  exportButton.disabled = true;
  try {
    const keys = ['data', 'coop-grants', 'coop-experiment-data', 'coop-experiment-grants', 'coop-seats', ...[0, 1, 2].map(sessionSaveKey)].flatMap(key => [key, `${key}:backup`]);
    const records = await readLocalSaveSnapshot(keys);
    snapshot = Object.fromEntries(Object.entries(records).filter(([, value]) => value !== null));
    const profile = snapshot.data ? JSON.parse(snapshot.data) : null;
    const slots = [0, 1, 2].map(slot => {
      const data = snapshot[sessionSaveKey(slot)];
      return data ? `槽位 ${slot + 1}：第 ${JSON.parse(data).waveIndex} 波` : `槽位 ${slot + 1}：空`;
    });
    status.textContent = profile ? '本地收藏存档已保存' : '还没有收藏存档，请先进入游戏完成初始设置。';
    details.textContent = [profile ? `待孵化蛋：${profile.eggs?.length ?? 0}\n扭蛋券：${JSON.stringify(profile.voucherCounts ?? {})}\n最近保存：${new Date(profile.timestamp).toLocaleString('zh-CN')}` : '', ...slots,
      snapshot['data:backup'] ? '上一次收藏快照：已保留' : '上一次收藏快照：暂无',
      snapshot['coop-seats'] ? '备份包含合作席位恢复凭据，请妥善保存。服务器还需保留对应房间文件。' : ''].filter(Boolean).join('\n');
    exportButton.disabled = Object.keys(snapshot).length === 0;
  } catch (error) {
    status.textContent = `读取失败：${error instanceof Error ? error.message : String(error)}`;
    details.textContent = '现有数据未被覆盖。';
  }
}

document.getElementById('refresh').addEventListener('click', refresh);
exportButton.addEventListener('click', async () => {
  await refresh();
  if (exportButton.disabled) return;
  const backup = { format: 'pokerogue-early-backup', version: 1, createdAt: new Date().toISOString(), records: snapshot,
    settings: deviceStorage().getItem('settings'), tutorials: deviceStorage().getItem('tutorials') };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'pokerogue-early-backup.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
void refresh();

const importFile = document.getElementById('importFile') as HTMLInputElement;
const restoreButton = document.getElementById('restore') as HTMLButtonElement;
importFile.addEventListener('change', () => { restoreButton.disabled = !importFile.files?.length; });
restoreButton.addEventListener('click', async () => {
  try {
    const file = importFile.files?.[0];
    if (!file) return;
    const backup = JSON.parse(await file.text());
    if (backup.format !== 'pokerogue-early-backup' || backup.version !== 1 || !backup.records || typeof backup.records !== 'object' || Array.isArray(backup.records))
      throw new Error('不是受支持的早期版本地备份');
    const profile = backup.records.data ? JSON.parse(backup.records.data) : null;
    if (profile && (!profile.dexData || profile.gameVersion !== '1.0.0')) throw new Error('收藏存档版本或内容不匹配');
    for (const key of ['settings', 'tutorials']) if (backup[key] != null) JSON.parse(backup[key]);
    if (!confirm('将用所选备份替换当前收藏与单人进度。当前存档会保留为上一份快照。确认恢复？')) return;
    await restoreLocalSaves(backup.records);
    for (const key of ['settings', 'tutorials']) if (typeof backup[key] === 'string') deviceStorage().setItem(key, backup[key]);
    await refresh();
    status.textContent = '备份恢复成功，请重新进入游戏。';
  } catch (error) { status.textContent = `恢复失败：${error instanceof Error ? error.message : String(error)}`; }
});
