import { mutateLocalSaves } from '../system/local-save-store';

export async function acquireProfile(owner: string) {
  await mutateLocalSaves(['coop-profile-lease'], records => {
    const lease = records['coop-profile-lease'] ? JSON.parse(records['coop-profile-lease']) : null;
    if (lease && lease.owner !== owner && lease.expires > Date.now()) throw new Error('另一个合作页面正在使用本地收藏，请关闭它后重试');
    return { 'coop-profile-lease': JSON.stringify({ owner, expires: Date.now() + 30000 }) };
  });
}
export async function releaseProfile(owner: string) {
  await mutateLocalSaves(['coop-profile-lease'], records => {
    const lease = records['coop-profile-lease'] ? JSON.parse(records['coop-profile-lease']) : null;
    return lease?.owner === owner ? { 'coop-profile-lease': null } : {};
  });
}
interface Grant { id: string; kind: 'seen' | 'caught'; mon: { species: number; dexAttr: string; nature: number; ivs: number[] }; }
/** Experimental rules must never award progress to the original game's collection. */
export async function prepareExperimentalProfile(owner: string): Promise<any> {
  let profile: any;
  await mutateLocalSaves(['data', 'coop-experiment-data', 'coop-experiment-grants', 'coop-profile-lease'], records => {
    const lease = records['coop-profile-lease'] ? JSON.parse(records['coop-profile-lease']) : null;
    if (lease?.owner !== owner || lease.expires <= Date.now()) throw new Error('本地收藏锁失效');
    if (!records.data) throw new Error('请先在单人入口完成初始设置');
    const original = JSON.parse(records.data);
    profile = records['coop-experiment-data'] ? JSON.parse(records['coop-experiment-data']) : original;
    if (profile.trainerId !== original.trainerId || profile.secretId !== original.secretId)
      throw new Error('实验收藏与当前训练家不匹配，请恢复对应备份；现有数据未被覆盖');
    if (!records['coop-experiment-data']) return {
      'coop-experiment-data': records.data,
      'coop-experiment-grants': JSON.stringify({ ids: [] })
    };
    return {};
  });
  return profile;
}

export async function applyCollectionGrants(owner: string, grants: Grant[]): Promise<void> {
  await mutateLocalSaves(['coop-experiment-data', 'coop-experiment-grants', 'coop-profile-lease'], records => {
    const lease = records['coop-profile-lease'] ? JSON.parse(records['coop-profile-lease']) : null;
    if (lease?.owner !== owner || lease.expires <= Date.now()) throw new Error('本地收藏锁失效，合作战斗暂停，请重新连接');
    if (!records['coop-experiment-data']) throw new Error('实验收藏尚未初始化');
    const profile = JSON.parse(records['coop-experiment-data']), ledger = records['coop-experiment-grants'] ? JSON.parse(records['coop-experiment-grants']) : { ids: [] };
    let changed = false;
    for (const grant of grants) {
      if (ledger.ids.includes(grant.id)) continue;
      const mon = grant.mon, entry = profile.dexData?.[mon.species];
      if (!entry || typeof grant.id !== 'string' || !grant.id || !['seen', 'caught'].includes(grant.kind)
        || !Array.isArray(mon.ivs) || mon.ivs.length !== 6 || !mon.ivs.every(iv => Number.isInteger(iv) && iv >= 0 && iv <= 31)
        || !Number.isInteger(mon.nature) || mon.nature < 0 || mon.nature >= 25) throw new Error('服务器收藏奖励格式无效');
      const attr = BigInt(mon.dexAttr);
      if (grant.kind === 'seen') {
        entry.seenAttr = (BigInt(entry.seenAttr) | attr).toString(); entry.seenCount++;
        profile.gameStats.pokemonSeen = (profile.gameStats.pokemonSeen ?? 0) + 1;
        if (attr & 2n) profile.gameStats.shinyPokemonSeen = (profile.gameStats.shinyPokemonSeen ?? 0) + 1;
      } else {
        entry.caughtAttr = (BigInt(entry.caughtAttr) | attr).toString(); entry.natureAttr |= 2 ** (mon.nature + 1); entry.caughtCount++;
        entry.ivs = entry.ivs.map((iv: number, i: number) => Math.max(iv, mon.ivs[i]));
        profile.gameStats.pokemonCaught = (profile.gameStats.pokemonCaught ?? 0) + 1;
        if (attr & 2n) profile.gameStats.shinyPokemonCaught = (profile.gameStats.shinyPokemonCaught ?? 0) + 1;
      }
      ledger.ids.push(grant.id); changed = true;
    }
    if (!changed) return {};
    profile.timestamp = Date.now();
    return { 'coop-experiment-data': JSON.stringify(profile), 'coop-experiment-grants': JSON.stringify(ledger) };
  });
}
