import fs from 'node:fs/promises';
import i18next from 'i18next';

// Audit the actual authoritative event stream. Fallback is disabled so an
// English entry cannot masquerade as a translated Chinese story page.
export async function localizedEventAudit(file){
 const resources={'zh-Hans':{}},special={'ability-trigger':'abilityTriggers','move-trigger':'moveTriggers',biomes:'biome'};
 const directory=new URL('../../locales/zh-Hans/',import.meta.url);
 for(const name of await fs.readdir(directory)){
  const stem=name.slice(0,-5),namespace=special[stem]??stem.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
  resources['zh-Hans'][namespace]=JSON.parse(await fs.readFile(new URL(name,directory),'utf8'));
 }
 const translation=i18next.createInstance();await translation.init({resources,lng:'zh-Hans',fallbackLng:false,initAsync:false});
 const missing=new Set(),raw=new Set(),finalBossStages=new Set(),dialogueWaves=new Set(),forms=[],seen=new Set();
 let messages=0,dialogues=0;
 const visit=value=>{
  if(!value||typeof value!=='object')return;
  if(value.key){
   if(!translation.exists(value.key,{...value.values,lng:'zh-Hans',fallbackLng:false}))missing.add(value.key);
   if(value.key.startsWith('earlyBattle:finalBoss.'))finalBossStages.add(value.key.split('.').at(-1));
  }
  for(const child of Object.values(value))if(child&&typeof child==='object')visit(child);
 };
 for(const line of (await fs.readFile(file,'utf8')).trim().split('\n')){
  if(!line)continue;const row=JSON.parse(line);
  for(const event of row.events){
   if(event.eventId&&seen.has(event.eventId))continue;if(event.eventId)seen.add(event.eventId);
   if(['message','dialogue'].includes(event.kind)){
    if(event.kind==='dialogue'){dialogues++;dialogueWaves.add(row.wave);}else messages++;
    visit(event.presentation);visit(event.speakerPresentation);
    if(!event.presentation&&/[a-z]{3}/i.test((event.text??'').replace(/@[a-z]\{[^}]*\}/g,'')))raw.add(event.text);
   }
   if(event.kind==='form-change')forms.push({wave:row.wave,id:event.pokemonId,species:event.view?.speciesId,formIndex:event.view?.formIndex});
  }
 }
 return {messages,dialogues,missing:[...missing],raw:[...raw],finalBossStages:[...finalBossStages].sort(),dialogueWaves:[...dialogueWaves],forms};
}
