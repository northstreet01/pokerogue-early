import type BattleScene from './battle-scene';
import { bypassLogin } from './battle-scene';
import { Phase } from './phase';
import { LoginPhase, ConsolidateDataPhase, TitlePhase } from './phases';
import { Mode } from './ui/ui';
import type { OptionSelectItem } from './ui/abstact-option-select-ui-handler';
import CoopPlayPhase from './coop/play-phase';
import { createPlayStorage } from './coop/play-storage.mjs';
import { GameData } from './system/game-data';
import {profileRepository,localProfileError} from './local-meta/services';
import {openGameProfileIO} from './local-meta/game-io.mjs';
import {captureLegacySource,prsvSystemSource} from './local-meta/legacy-source';
import {legacyBackupSource} from './local-meta/repository.mjs';
import {digest} from './local-meta/codec.mjs';
import i18next from './i18n';
import {readHosts,hostScope} from './coop/host-connection.mjs';

/** Root has no login/save/room side effects. Direct game entries retain login. */
export function entryPhases(scene: BattleScene, coop: boolean, solo: boolean): Phase[] {
  if (!coop && !solo) return [new HomePhase(scene)];
  return [new LoginPhase(scene), ...(!bypassLogin ? [new ConsolidateDataPhase(scene)] : []),
    coop ? new CoopPlayPhase(scene) : new TitlePhase(scene)];
}

export class HomePhase extends Phase {
  private epoch = 0;
  private disposed = false;
  private transitions: Promise<void> = Promise.resolve();
  private originalData?: GameData;
  private music = new AbortController();
  private activeProfile: string | null = null;
  private profileName = '';
  private fileInput?: HTMLInputElement;
  private backdrop?: Phaser.GameObjects.NineSlice;
  private t(key:string,args?:any):string{return i18next.t(`localMeta:${key}`,args) as string;}
  private repository(epoch=this.epoch){return profileRepository(()=>this.current(epoch));}

  start(): void {
    super.start();
    this.scene.fadeOutBgm(0, false);
    this.scene.playBgm?.('menu', false, this.music.signal);
    this.scene.ui.fadeIn(250);
    // Original town art, without any party, enemy, battle HUD or old scene.
    if(this.scene.add?.nineslice){
      this.backdrop=this.scene.add.nineslice(0,0,'town_bg',null,320,180,0,0,132,0);
      this.backdrop.setOrigin(0).setScale(6).setDepth(0.5);
    }
    this.scene.events.once('shutdown', () => this.dispose());
    void this.showHome();
  }

  private current(epoch: number): boolean { return !this.disposed && epoch === this.epoch; }

  private dispose(): void {
    this.disposed = true; this.epoch++;
    this.music.abort(); this.scene.fadeOutBgm?.(150, true);
    this.fileInput?.remove();
    this.backdrop?.destroy();
    this.releaseView();
  }

  private releaseView(): void {
    if (this.originalData) { this.scene.gameData = this.originalData; this.originalData = undefined; }
  }

  private navigate(url: string): void {
    if(this.activeProfile)url+=(url.includes('?')?'&':'?')+'profile='+encodeURIComponent(this.activeProfile);
    if(this.scene.navigateApp){void this.scene.navigateApp(url).catch(error=>this.showError(error));return;}
    this.dispose();
    location.assign(url);
  }

  /** Serialize original UI fades; late completions cannot cover the next view. */
  private display(epoch: number, mode: Mode, args: any[], view?: GameData): Promise<void> {
    const transition = this.transitions.catch(() => {}).then(async () => {
      if (!this.current(epoch)) return;
      await this.scene.ui.setMode(Mode.MESSAGE);
      this.releaseView();
      if (!this.current(epoch)) return;
      this.scene.ui.clearText();
      if (view) { this.originalData = this.scene.gameData; this.scene.gameData = view; }
      await this.scene.ui.setMode(mode, ...args);
    });
    this.transitions = transition;
    return transition;
  }

  private menu(epoch: number, items: [string, () => unknown][], context?:string): Promise<void> {
    const options: OptionSelectItem[] = items.map(([label, action]) => {
      let used = false;
      return { label, keepOpen: true, handler: () => {
        if (!this.current(epoch) || used) return;
        used = true;
        const result=action(),actionEpoch=this.epoch;
        void Promise.resolve(result).catch(error=>{if(this.current(actionEpoch))void this.showError(error);});
      } };
    });
    return this.display(epoch, Mode.TITLE, [{ options, noCancel: true, maxOptions: 6, yOffset: 47,
      contextLabel: context??(this.activeProfile?this.t('current',{name:this.profileName.slice(0,14)}):'选择冒险 / 个人资料') }]);
  }

  async showHome(): Promise<void> {
    // Root creates a battle backdrop before an adventure. Home shows only menus.
    for (const object of [this.scene.field, this.scene.fieldUI, this.scene.arenaBg,
      this.scene.arenaBgTransition, this.scene.arenaPlayer, this.scene.arenaEnemy,
      this.scene.arenaNextEnemy, this.scene.arenaPlayerTransition, this.scene.trainer,
      (this.scene as any).modifierBar, (this.scene as any).enemyModifierBar]) object?.setVisible(false);
    const epoch = ++this.epoch;
    this.fileInput?.remove();
    try {
      const index=await this.repository(epoch).list();if(!this.current(epoch))return;
      this.activeProfile=index.activeProfileId;
      this.profileName=index.profiles.find(p=>p.profileId===this.activeProfile)?.displayName??'';
    }catch(error){if(this.current(epoch))await this.menu(epoch,[[this.t('retry'),()=>this.showHome()]],localProfileError(error));return;}
    const outcome = this.scene.appUrl?.searchParams.get('coopExit');
    const outcomeText = outcome === 'victory' ? '经典模式通关！永久收藏与扭蛋结算待接入。'
      : outcome === 'defeat' ? '双方队伍已倒下，本次冒险结束。' : undefined;
    return this.menu(epoch, [
      ['单人冒险', () => this.navigate('/?solo=1')],
      ['联机冒险', () => this.navigate('/coop-play.html?fresh=1')],
      ['恢复已有联机', () => { void this.showRecovery(); }],
      ['个人收藏 / 蛋 / 券', () => { void this.showPersonal(); }],
      [this.t('profiles'),()=>this.showProfiles()],
    ], outcomeText);
  }

  private showPersonal(): Promise<void> {
    const epoch = ++this.epoch;
    return this.menu(epoch, [
      ['我的收藏', () => { void this.browse(Mode.STARTER_SELECT); }],
      ['我的未孵化蛋', () => { void this.browse(Mode.EGG_LIST); }],
      ['我的蛋券', () => { void this.browse(Mode.EGG_GACHA); }],
      ['返回初始界面', () => { void this.showHome(); }],
    ]);
  }

  private async browse(mode: Mode): Promise<void> {
    const epoch = ++this.epoch;
    await this.menu(epoch, [['正在读取，返回', () => { void this.showHome(); }]]);
    try {
      // Original parsing/consolidation runs on an isolated view. A late load may
      // finish after return, but cannot mutate the scene's live personal data.
      const view = new GameData(this.scene, { readOnly: true });
      if(this.activeProfile)view.bindProfileIO(await openGameProfileIO(this.repository(epoch),this.activeProfile,{readOnly:true}));
      const exists = await view.loadSystem({ readOnly: true });
      if (!this.current(epoch)) return;
      if (!exists) {
        await this.menu(epoch, [['尚无个人资料，返回', () => { void this.showHome(); }]]);
        return;
      }
      const onCancel = () => { if (this.current(epoch)) void this.showHome(); };
      const options = { readOnly: true, onCancel };
      await this.display(epoch, mode, mode === Mode.STARTER_SELECT ? [() => {}, options] : [options], view);
    } catch {
      if (this.current(epoch)) await this.menu(epoch, [
        ['个人资料读取失败，重试', () => { void this.browse(mode); }],
        ['返回初始界面', () => { void this.showHome(); }],
      ]);
    }
  }

  private async showRecovery(): Promise<void> {
    const epoch = ++this.epoch;
    await this.menu(epoch, [['正在读取，返回', () => { void this.showHome(); }]]);
    try {
      const storage=createPlayStorage();
      const legacy=(await storage.listSeats(location.origin)).map(value=>({...value,legacy:true}));
      const hosts=readHosts().hosts;
      const hosted=(await Promise.all(hosts.map(async host=>(await storage.listSeats(hostScope(location.origin,host.hostId,this.activeProfile)))
        .map(value=>({...value,hostId:host.hostId,endpoint:host.endpoint,legacy:false}))))).flat();
      const seats=[...legacy,...hosted].filter(value=>(value.profileId??null)===this.activeProfile);
      if (!this.current(epoch)) return;
      await this.menu(epoch, [
        ...seats.map(value => [`房间 ${value.roomId} · 玩家${value.seat + 1}${value.hostId?' · '+value.endpoint:''}`, () =>
          this.navigate(`/coop-play.html?resumeRoom=${encodeURIComponent(value.roomId)}&resumeSeat=${value.seat}`
            +(value.hostId?`&host=${encodeURIComponent(value.endpoint)}&hostId=${encodeURIComponent(value.hostId)}`:this.scene.navigateApp?'&legacy=1':''))] as [string, () => void]),
        [seats.length ? '返回初始界面' : '没有可恢复席位，返回', () => { void this.showHome(); }],
      ]);
    } catch {
      if (this.current(epoch)) await this.menu(epoch, [
        ['读取失败，重试', () => { void this.showRecovery(); }],
        ['返回初始界面', () => { void this.showHome(); }],
      ]);
    }
  }

  private async showError(error:any):Promise<void>{
    const epoch=++this.epoch;
    await this.menu(epoch,[[this.t('profiles'),()=>this.showProfiles()],[this.t('back'),()=>this.showHome()]],localProfileError(error));
  }
  private async confirm(epoch:number,text:string,action:()=>Promise<unknown>,cancel:()=>unknown):Promise<void>{
    if(!this.current(epoch))return;
    let used=false;
    const yes=()=>{if(used||!this.current(epoch))return;used=true;void action().catch(error=>{if(this.current(epoch))void this.showError(error);});};
    const no=()=>{if(used||!this.current(epoch))return;used=true;cancel();};
    await this.display(epoch,Mode.CONFIRM,[yes,no,false]);
    if(this.current(epoch))this.scene.ui.showText(text,0);
  }
  private async nameForm(action:(name:string,epoch:number)=>Promise<unknown>,initialName=''):Promise<void>{
    const epoch=++this.epoch;
    let used=false;
    await this.display(epoch,Mode.PROFILE_FORM,[{initialName,
      onSubmit:(name:string)=>{if(!used&&this.current(epoch)){used=true;void action(name,epoch).catch(error=>{if(this.current(epoch))void this.showError(error);});}},
      onCancel:()=>{if(!used&&this.current(epoch)){used=true;void this.showProfiles();}}}]);
  }
  private async showProfiles():Promise<void>{
    const epoch=++this.epoch,index=await this.repository(epoch).list();if(!this.current(epoch))return;
    await this.menu(epoch,[
      ...index.profiles.map(p=>[(p.profileId===index.activeProfileId?'★ ':'')+p.displayName,()=>this.showProfile(p.profileId)] as [string,()=>unknown]),
      [this.t('create'),()=>this.nameForm(async(name,formEpoch)=>{
        let data:GameData;
        this.scene.executeWithSeedOffset(()=>{data=new GameData(this.scene,{skipSettings:true});},0,'local-profile-'+crypto.randomUUID());
        data.gender=0;
        const repo=this.repository(formEpoch),created=await repo.create(JSON.parse(data.captureSystemData()),{displayName:name});
        await repo.setActive(created.profileId);if(this.current(formEpoch))await this.showHome();
      })],
      [this.t('migrate'),()=>this.previewMigration()],
      [this.t('import'),()=>this.importFile()],
      [this.t('back'),()=>this.showHome()]
    ],this.t('profiles'));
  }
  private async withWriter(profileId:string,epoch:number,action:(repo:any,lease:any)=>Promise<unknown>):Promise<void>{
    const repo=this.repository(epoch),lease=await repo.acquire(profileId,crypto.randomUUID());
    try{if(this.current(epoch))await action(repo,lease);}
    finally{await profileRepository().release(profileId,lease);}
  }
  private async showProfile(profileId:string):Promise<void>{
    const epoch=++this.epoch,repo=this.repository(epoch);
    let p:any;
    try{p=await repo.read(profileId);}catch(error){if(this.current(epoch))await this.menu(epoch,[
      [this.t('recovery'),()=>this.showBackups(profileId)],[this.t('back'),()=>this.showProfiles()]],localProfileError(error));return;}
    if(!this.current(epoch))return;
    await this.menu(epoch,[
      [this.t('select'),async()=>{await repo.setActive(profileId);if(this.current(epoch))await this.showHome();}],
      [this.t('rename'),()=>this.nameForm(async(name,e)=>{
        await this.withWriter(profileId,e,async(r,lease)=>{const old=await r.read(profileId);await r.save(profileId,old.revision,lease,v=>({...v,displayName:name}));});
        if(this.current(e))await this.showProfile(profileId);
      },p.displayName)],
      ...p.soloRuns.map(run=>[this.t('slot',{slot:run.legacySlot+1,wave:run.originalSession.waveIndex}),()=>this.confirmSlots(profileId)] as [string,()=>unknown]),
      ...(p.soloRuns.some(r=>r.ownership==='unconfirmed')?[[this.t('confirmSlots'),()=>this.confirmSlots(profileId)] as [string,()=>unknown]]:[]),
      [this.t('export'),()=>this.confirm(epoch,this.t('privateBackup'),async()=>{
        const archive=await repo.exportArchive(profileId);if(!this.current(epoch))return;
        const url=URL.createObjectURL(new Blob([JSON.stringify(archive)],{type:'application/json'}));
        const link=document.createElement('a');link.href=url;link.download=`profile-${profileId}.json`;link.click();
        setTimeout(()=>URL.revokeObjectURL(url),1000);await this.showProfile(profileId);
      },()=>this.showProfile(profileId))],
      [this.t('recovery'),()=>this.showBackups(profileId)],
      [this.t('back'),()=>this.showProfiles()]
    ],p.displayName+' · '+this.t('deferred',{count:p.deferredHatches.length}));
  }
  private async confirmSlots(profileId:string):Promise<void>{
    const epoch=++this.epoch,repo=this.repository(epoch),p=await repo.read(profileId);if(!this.current(epoch))return;
    await this.confirm(epoch,this.t('confirmSlots'),async()=>{
      await this.withWriter(profileId,epoch,(r,lease)=>r.save(profileId,p.revision,lease,v=>({...v,soloRuns:v.soloRuns.map(run=>({...run,ownership:'confirmed'}))})));
      if(this.current(epoch))await this.showProfile(profileId);
    },()=>this.showProfile(profileId));
  }
  private async previewMigration(source?:any):Promise<void>{
    const epoch=++this.epoch,repo=this.repository(epoch);
    const input=source??await captureLegacySource();if(!this.current(epoch))return;
    const sourceId=source?'file-'+(await digest(input)).slice(0,64):'browser-legacy';
    const plan=await repo.previewLegacy(input,{sourceId,displayName:this.t('profileName')});if(!this.current(epoch))return;
    await this.menu(epoch,[
      ...plan.profile.soloRuns.map(run=>[this.t('slot',{slot:run.legacySlot+1,wave:run.originalSession.waveIndex}),()=>undefined] as [string,()=>unknown]),
      [this.t('install'),()=>this.confirm(epoch,this.t('summary',{slots:plan.profile.soloRuns.length,eggs:plan.profile.originalSystem.eggs.length}),async()=>{
        const result=await repo.install(plan);await repo.setActive(result.profileId);if(this.current(epoch))await this.showProfiles();
      },()=>this.showProfiles())],
      [this.t('back'),()=>this.showProfiles()]
    ],this.t('preview',{name:plan.profile.displayName}));
  }
  private async importFile():Promise<void>{
    const epoch=++this.epoch;
    const input=document.createElement('input');input.type='file';input.accept='.json,.prsv';input.hidden=true;this.fileInput=input;document.body.append(input);
    const file=await new Promise<File|null>(resolve=>{
      input.addEventListener('change',()=>resolve(input.files?.[0]??null),{once:true});
      input.addEventListener('cancel',()=>resolve(null),{once:true});input.click();
    });input.remove();if(!this.current(epoch))return;if(!file){await this.showProfiles();return;}
    if(file.size>16*1024*1024)throw new Error('LOCAL_DATA_TOO_LARGE');
    const text=await file.text();if(!this.current(epoch))return;
    if(file.name.toLowerCase().endsWith('.prsv')){await this.previewMigration(prsvSystemSource(text));return;}
    const raw=JSON.parse(text);
    if(raw.format==='pokerogue-early-backup'){await this.previewMigration(legacyBackupSource(raw));return;}
    const repo=this.repository(epoch),archive=await repo.previewArchive(raw),index=await repo.list();if(!this.current(epoch))return;
    const old=index.profiles.find(p=>p.profileId===archive.profile.profileId);
    await this.confirm(epoch,this.t(old?'replacePrompt':'preview',{name:archive.profile.displayName}),async()=>{
      if(old)await this.withWriter(old.profileId,epoch,(r,lease)=>r.importArchive(archive,{expectedRevision:old.revision,lease}));
      else await repo.importArchive(archive);
      await repo.setActive(archive.profile.profileId);if(this.current(epoch))await this.showProfiles();
    },()=>this.showProfiles());
  }
  private async showBackups(profileId:string):Promise<void>{
    const epoch=++this.epoch,repo=this.repository(epoch),history=await repo.recoveryPoints(profileId),index=await repo.list();if(!this.current(epoch))return;
    const entry=index.profiles.find(p=>p.profileId===profileId),points:[string,string|number][]=[[this.t('backupOrigin'),'origin']];
    if(history.recovery)points.push([this.t('backupPrevious'),'recovery']);
    history.automatic.forEach((p,i)=>{if(p.valid)points.push([this.t('backupAuto',{number:i+1}),i]);});
    await this.menu(epoch,[...points.map(([label,point])=>[label,()=>this.confirm(epoch,this.t('restorePrompt'),async()=>{
      await this.withWriter(profileId,epoch,(r,lease)=>r.restore(profileId,point,entry.revision,lease));if(this.current(epoch))await this.showProfile(profileId);
    },()=>this.showProfile(profileId))] as [string,()=>unknown]),[this.t('back'),()=>this.showProfiles()]],this.t('recovery'));
  }
}
