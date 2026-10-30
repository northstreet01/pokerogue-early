// Display only: atlas frames and verified public selections never mutate rule state.
const atlasCache=new WeakMap();
// Display identity only; seat numbers remain internal protocol/save keys.
export function roomPlayerName(names,seat,localSeat,t){
  const cleanName=name=>typeof name==='string'?name.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,24).replace(/@(?=[cds]\{)/g,'＠'):'';
  const clean=cleanName(names?.[seat]);
  // Original message boxes parse @c/@d/@s directives; nicknames stay plain text.
  if(clean){
    if(localSeat!==null&&localSeat!==undefined&&cleanName(names?.[1-seat])===clean)
      return t('namedPlayer',{name:clean,role:t(seat===localSeat?'you':'partner')});
    return clean;
  }
  return t(localSeat===null||localSeat===undefined?'unnamedTrainer':seat===localSeat?'you':'partner');
}
export function atlasIcon(scene,key,frameName,label){
  const icon=document.createElement('span');icon.className='coop-atlas-icon';icon.setAttribute('aria-hidden','true');
  if(!scene.textures?.exists?.(key))return icon;
  if(scene.textures.get?.(key)?.has(frameName)===false)return icon;
  const frame=scene.textures.getFrame(key,frameName),source=frame?.source;
  if(!source?.image||!frame||frame.name==='__MISSING')return icon;
  // Phaser revokes its loader blob URLs. Reuse decoded pixels, not the expired URL.
  let cache=atlasCache.get(source.image);if(!cache){cache=new Map();atlasCache.set(source.image,cache);}
  const cacheKey=[frame.cutX,frame.cutY,frame.cutWidth,frame.cutHeight].join(':');
  let url=cache.get(cacheKey);
  if(!url){
    const canvas=document.createElement('canvas');canvas.width=frame.cutWidth;canvas.height=frame.cutHeight;
    const context=canvas.getContext('2d');if(!context)return icon;
    context.drawImage(source.image,frame.cutX,frame.cutY,frame.cutWidth,frame.cutHeight,0,0,frame.cutWidth,frame.cutHeight);
    url=canvas.toDataURL();if(cache.size>=512)cache.clear();cache.set(cacheKey,url);
  }
  const sprite=document.createElement('span');sprite.className='coop-atlas-frame';
  Object.assign(sprite.style,{width:frame.cutWidth*2+'px',height:frame.cutHeight*2+'px',
    backgroundImage:`url(${JSON.stringify(url)})`});
  icon.append(sprite);return icon;
}

export function renderTeams(target,scene,selections,seat,{species,t,names=[]}){
  const rows=[seat??0,1-(seat??0)].map(owner=>{
    const selection=selections.find(p=>p.seat===owner);
    const row=document.createElement('section');row.className='coop-team-row';row.dataset.seat=String(owner);
    row.classList.toggle('ready',!!selection?.ready);
    const heading=document.createElement('div');heading.className='coop-team-heading';
    const who=owner===seat?t('you'):t('partner');
    const state=selection?.ready?t('ready'):selection?.state==='confirmed'?t('teamConfirmed'):selection?.starters?.length?t('editingTeam'):t('teamEmpty');
    heading.textContent=`${who}${names[owner]?' · '+names[owner]:''} · ${state} · ${selection?.total??0}/10`;
    const grid=document.createElement('div');grid.className='coop-team-slots';
    for(let index=0;index<6;index++){
      const starter=selection?.starters?.[index],slot=document.createElement('div');slot.className='coop-team-slot';
      if(starter){
        const s=species(starter.speciesId),name=s.getName(starter.formIndex??0);
        slot.append(atlasIcon(scene,s.getIconAtlasKey(starter.formIndex),s.getIconId(false,starter.formIndex??0,false),name));
        const caption=document.createElement('span');caption.textContent=name;
        const cost=document.createElement('small');cost.textContent=t('starterCost',{cost:starter.cost});
        slot.append(caption,cost);slot.title=`${name} · ${cost.textContent}`;
      }else{slot.classList.add('empty');slot.textContent='—';slot.setAttribute('aria-label',t('emptySlot'));}
      grid.append(slot);
    }
    row.append(heading,grid);return row;
  });
  target.replaceChildren(...rows);
}

export function renderInventory(target,scene,items,t){
  target.hidden=!items.length;target.replaceChildren();if(!items.length)return;
  const label=document.createElement('span');label.className='coop-inventory-label';label.textContent=t('myItems');target.append(label);
  const strip=document.createElement('div');strip.className='coop-item-strip';strip.setAttribute('role','list');
  items.forEach((item,index)=>{
    const entry=document.createElement('div');entry.className='coop-item-entry';entry.setAttribute('role','listitem');
    const button=document.createElement('button');button.type='button';button.className='coop-item';
    button.append(atlasIcon(scene,'items',item.icon,item.name));
    const count=document.createElement('span');count.className='coop-item-count';count.textContent='×'+item.count;button.append(count);
    const description=document.createElement('div');description.className='coop-item-description';description.id=`coop-item-${index}`;description.setAttribute('role','tooltip');
    const title=document.createElement('strong');title.textContent=item.name+' ×'+item.count;
    const body=document.createElement('div');body.textContent=item.description;
    const owner=document.createElement('div');owner.textContent=item.owner?t('heldBy',{name:item.owner}):t('partyItem');
    description.append(title,body,owner);
    if(Number.isInteger(item.battlesLeft)){const remaining=document.createElement('div');remaining.textContent=t('battlesLeft',{count:item.battlesLeft});description.append(remaining);}
    button.setAttribute('aria-label',title.textContent+' · '+owner.textContent);button.setAttribute('aria-describedby',description.id);
    button.setAttribute('aria-expanded','false');
    const place=()=>{
      delete button.dataset.dismissed;
      const rect=button.getBoundingClientRect(),viewport=button.ownerDocument.defaultView;
      description.style.left=Math.max(8,Math.min(rect.left,(viewport?.innerWidth??640)-336))+'px';
      description.style.top=Math.max(8,Math.min(rect.bottom+6,(viewport?.innerHeight??480)-190))+'px';
    };
    button.addEventListener('pointerenter',place);button.addEventListener('focus',place);
    button.addEventListener('click',()=>{
      place();
      const show=button.getAttribute('aria-expanded')!=='true';
      for(const open of target.querySelectorAll('[aria-expanded="true"]'))open.setAttribute('aria-expanded','false');
      button.setAttribute('aria-expanded',String(show));
    });
    for(const type of ['keydown','keyup'])button.addEventListener(type,event=>{
      event.stopPropagation();if(event.key==='Escape'){button.setAttribute('aria-expanded','false');button.dataset.dismissed='true';}
    });
    button.addEventListener('blur',()=>button.setAttribute('aria-expanded','false'));
    entry.append(button,description);strip.append(entry);
  });target.append(strip);
}

export function progressText(message,snapshot,seat,t,names=[]){
  if(!message.online?.every(Boolean))return t('waitingConnection');
  if(message.reason==='WAITING_ACK')return t('loadingTogether');
  if(message.blocked)return t('waitingRecovery');
  const kind=snapshot.personal.decision.kind;
  if(kind==='lobby')return t('prepareTogether');
  const state=owner=>{
    const activity=snapshot.shared?.activities?.[owner];
    const activityKey={'learn-move':'learningMove',evolution:'choosingEvolution','item-target':'choosingItemTarget'}[activity];
    if(activityKey)return t(activityKey);
    if(kind==='preparation')return snapshot.personal.decision.sharedMarket?.finished?.[owner]?t('finishedShopping'):t('choosingItems');
    return message.submitted?.[owner]?t('actionSubmitted'):snapshot.personal.decision.requiredSeats?.includes(owner)?t('choosingAction'):t('waitingResult');
  };
  return `${roomPlayerName(names,seat,seat,t)}：${state(seat)} · ${roomPlayerName(names,1-seat,seat,t)}：${state(1-seat)}`;
}
