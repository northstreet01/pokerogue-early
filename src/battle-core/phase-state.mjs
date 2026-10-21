import { copy, canonical, requireContract as check } from './coop-contract.mjs';
import { phaseStateFields } from './phase-fields.mjs';
import { pokemonRuleNodes, equivalentPokemonRuleNodes } from './pokemon-state.mjs';

// This codec captures queued/not-started original Phase objects. Current UI
// callbacks must first be lowered to a safe decision + explicit remaining stage;
// arbitrary animation frames are intentionally not checkpoints.
export function createPhaseStateCodec({constructors, evolution, formChange, modifierType, weather, pokemon, hasMove}) {
  const prototypes=new Map(Object.entries(constructors).map(([name,ctor])=>[ctor.prototype,name]));
  const scopes=new WeakMap();
  const rendererFields=new Set(['evolutionContainer','evolutionBaseBg','evolutionBg','evolutionBgOverlay','evolutionOverlay',
    'pokemonSprite','pokemonTintSprite','pokemonEvoSprite','pokemonEvoTintSprite','pokeball']);
  const schema=name=>{
    const s=phaseStateFields[name];check(s,'UNSUPPORTED_PHASE');
    const base=s.base&&phaseStateFields[s.base]?schema(s.base):{fields:{},required:[],display:[]};
    return {fields:{...base.fields,...s.fields},required:[...base.required,...s.required],display:[...base.display,...s.display,'scene']};
  };
  const createGraph=()=>({encode:new Map(),decode:new Map()});
  const commandArrays=context=>Object.entries(context.battle?.turnCommands??{}).flatMap(([slot,command])=>{
    if(!command)return [];
    return [['targets',command.targets],['move',command.move?.targets],...(command.args??[]).map((arg,index)=>[`arg-${index}`,arg?.targets])]
      .filter(([,array])=>Array.isArray(array)).map(([field,array])=>({slot:Number(slot),field,array}));
  });
  function mutable(source,rule,wire,restoring,graph,decode) {
    if(!restoring){
      if(!graph)return wire;
      if(!graph.encode.has(source))graph.encode.set(source,graph.encode.size);
      return {...wire,alias:graph.encode.get(source)};
    }
    if(!Object.hasOwn(wire,'alias'))return decode();
    check(Number.isSafeInteger(wire.alias)&&wire.alias>=0&&wire.alias<100000,'INVALID_PHASE_ALIAS');
    const state=canonical(Object.fromEntries(Object.entries(wire).filter(([k])=>k!=='alias')));
    if(graph.decode.has(wire.alias)) {
      const old=graph.decode.get(wire.alias);check(old.rule===rule&&old.state===state,'CONFLICTING_PHASE_ALIAS');return old.value;
    }
    const value=decode();graph.decode.set(wire.alias,{rule,state,value});return value;
  }
  function encode(value,rule,context,restoring,graph) {
    if(value===undefined)return restoring?undefined:{presence:'undefined'};
    if(!restoring&&value===null)return {presence:'null'};
    if(restoring){
      check(value&&typeof value==='object'&&['undefined','null','value'].includes(value.presence),'INVALID_PHASE_FIELD');
      check(Object.keys(value).sort().join(',')===(value.presence==='value'?'presence,value':'presence'),'INVALID_PHASE_FIELD');
      if(value.presence!=='value')return value.presence==='null'?null:undefined;
      value=value.value;
    }
    let result;
    if(rule==='egg'){
      const rows=context.eggState?.players;check(Array.isArray(rows)&&rows.length===2,'EGG_STATE_UNAVAILABLE');
      if(restoring){
        check(value&&Object.keys(value).sort().join(',')==='id,seat'&&[0,1].includes(value.seat),'INVALID_EGG_REFERENCE');
        result=rows[value.seat].find(egg=>egg.id===value.id);check(result,'UNKNOWN_PHASE_EGG');
      }else{
        const owners=rows.flatMap((row,seat)=>row.includes(value)?[seat]:[]);check(owners.length===1,'UNKNOWN_PHASE_EGG');
        result={seat:owners[0],id:value.id};
      }
    }else if(rule==='hatch-pokemon') {
      // A hatch result belongs to this personal Phase, never to a party slot or
      // the retired battler table. Numeric Pokemon IDs may legitimately collide.
      check(pokemon?.capturePokemon&&pokemon?.restorePokemon,'PHASE_COMPONENT_UNAVAILABLE');
      if(restoring){
        check(value&&Object.keys(value).join(',')==='state','INVALID_HATCH_POKEMON');
        result=pokemon.restorePokemon(value.state);
      }else{
        const captured=pokemon.capturePokemon(value);
        check(value?.isPlayer()===true&&!context.roster.entries.some(e=>e.pokemon===value),'INVALID_HATCH_POKEMON');
        const nodes=new Set([...pokemonRuleNodes(value).values()].filter(v=>v&&typeof v==='object'));
        for(const {pokemon:p}of context.roster.entries)for(const node of pokemonRuleNodes(p).values())
          check(!nodes.has(node),'SHARED_HATCH_POKEMON');
        result={state:captured};
      }
      check((restoring?result:value).isPlayer()===true,'INVALID_HATCH_POKEMON');
    }else if(rule==='pokemon') {
      if(restoring&&value&&typeof value==='object') {
        check(Object.hasOwn(value,'retired')&&Object.hasOwn(value,'bindings')&&Object.keys(value).every(k=>['retired','bindings','alias'].includes(k))
          &&pokemon?.restorePokemon,'UNKNOWN_PHASE_POKEMON');
        result=mutable(null,rule,value,true,graph,()=>{
          const actor=pokemon.restorePokemon(value.retired),entry=context.roster.entries.find(e=>e.pokemon.id===actor.id);
          check(context.roster.retiredIds.includes(actor.id)||entry?.pokemon.isPlayer()&&!actor.isPlayer(),'UNKNOWN_PHASE_POKEMON');
          const nodes=pokemonRuleNodes(actor),used=new Set();
          check(Array.isArray(value.bindings)&&value.bindings.length<=100000,'INVALID_PHASE_BINDING');
          for(const binding of value.bindings){
            check(binding&&Object.keys(binding).sort().join(',')==='from,path,pokemonId'&&Array.isArray(binding.from)&&Array.isArray(binding.path)
              &&binding.from.length>0&&binding.from.length<=32&&binding.path.length>0&&binding.path.length<=32
              &&[...binding.from,...binding.path].every(k=>typeof k==='string'&&!['__proto__','constructor','prototype'].includes(k)),'INVALID_PHASE_BINDING');
            const key=JSON.stringify(binding.from),source=nodes.get(key),targetActor=context.roster.entries.find(e=>e.pokemon.id===binding.pokemonId)?.pokemon;
            const target=targetActor&&pokemonRuleNodes(targetActor).get(JSON.stringify(binding.path));
            check(source&&target&&!used.has(key)&&equivalentPokemonRuleNodes(source,target),'INVALID_PHASE_BINDING');used.add(key);
            const parent=binding.from.slice(0,-1).reduce((node,k)=>node[k],actor);
            Object.defineProperty(parent,binding.from.at(-1),{value:target,writable:true,enumerable:true,configurable:true});
          }
          pokemonRuleNodes(actor);return actor;
        });
      } else {
        const id=restoring?value:value?.id,entry=context.roster.entries.find(e=>e.pokemon.id===id);
        if(entry&&(restoring||entry.pokemon===value))result=restoring?entry.pokemon:id;
        else {
          check(!restoring&&value&&pokemon?.capturePokemon&&(context.roster.retiredIds.includes(id)||entry?.pokemon.isPlayer()&&!value.isPlayer()),'UNKNOWN_PHASE_POKEMON');
          const bindings=[],known=new Map();
          for(const {pokemon:p}of context.roster.entries)for(const [key,node]of pokemonRuleNodes(p))if(JSON.parse(key).length&&!known.has(node))known.set(node,{pokemonId:p.id,path:JSON.parse(key)});
          for(const [key,node]of pokemonRuleNodes(value)){const from=JSON.parse(key);if(from.length&&known.has(node))bindings.push({from,...known.get(node)});}
          result=mutable(value,rule,{retired:pokemon.capturePokemon(value),bindings},false,graph);
        }
      }
    } else if(rule==='move') {
      check(pokemon?.captureMove&&pokemon?.restoreMove,'PHASE_COMPONENT_UNAVAILABLE');
      if(restoring) {
        check(value&&Object.keys(value).every(k=>['reference','state','alias'].includes(k)),'INVALID_PHASE_FIELD');
        if(Object.hasOwn(value,'reference')) {
          check(Object.keys(value).length===1,'INVALID_PHASE_FIELD');
          const r=value.reference;
          check(r&&Object.keys(r).sort().join(',')==='index,pokemonId,summon'&&typeof r.summon==='boolean'
            &&Number.isInteger(r.index)&&r.index>=0&&r.index<4,'INVALID_PHASE_FIELD');
          const p=context.roster.entries.find(e=>e.pokemon.id===r.pokemonId)?.pokemon;
          result=(r.summon?p?.summonData?.moveset:p?.moveset)?.[r.index];check(result,'UNKNOWN_PHASE_MOVE');
        } else {check(Object.hasOwn(value,'state')&&Object.keys(value).every(k=>['state','alias'].includes(k)),'INVALID_PHASE_FIELD');result=mutable(null,rule,value,true,graph,()=>pokemon.restoreMove(value.state));}
      } else {
        let reference;
        for(const {pokemon:p}of context.roster.entries)for(const summon of [false,true]){
          const index=(summon?p.summonData?.moveset:p.moveset)?.indexOf(value)??-1;
          if(index>=0&&!reference)reference={pokemonId:p.id,summon,index};
        }
        result=reference?{reference}:mutable(value,rule,{state:pokemon.captureMove(value)},false,graph);
      }
    } else if(['evolution','formChange','modifierType','weather'].includes(rule)) {
      const codec={evolution,formChange,modifierType,weather}[rule];check(codec?.capture&&codec?.restore,'PHASE_COMPONENT_UNAVAILABLE');
      if(rule==='weather'&&(restoring?value?.reference===true:value===context.arena.weather)){
        if(restoring)check(Object.keys(value).length===1&&context.arena.weather,'INVALID_PHASE_FIELD');
        result=restoring?context.arena.weather:{reference:true};
      } else if(rule==='modifierType') {
        const rows=[...context.players.map(p=>p.modifiers),context.enemyModifiers,context.battle?.postBattleLoot??[]];
        if(restoring&&value?.reference){
          const r=value.reference;check(Object.keys(value).length===1&&r&&Object.keys(r).sort().join(',')==='index,row'
            &&Number.isInteger(r.row)&&r.row>=0&&r.row<4&&Number.isInteger(r.index)&&r.index>=0&&r.index<rows[r.row].length,'INVALID_PHASE_FIELD');result=rows[r.row][r.index].type;
        } else if(!restoring){
          let reference;
          rows.forEach((row,i)=>row.forEach((m,index)=>{if(m.type===value&&!reference)reference={row:i,index};}));
          result=reference?{reference}:mutable(value,rule,{state:codec.capture(value)},false,graph);
        } else {check(value&&Object.hasOwn(value,'state')&&Object.keys(value).every(k=>['state','alias'].includes(k)),'INVALID_PHASE_FIELD');result=mutable(null,rule,value,true,graph,()=>codec.restore(value.state));}
      } else if(rule==='weather') {
        if(restoring){check(value&&Object.hasOwn(value,'state')&&Object.keys(value).every(k=>['state','alias'].includes(k)),'INVALID_PHASE_FIELD');result=mutable(null,rule,value,true,graph,()=>codec.restore(value.state));}
        else result=mutable(value,rule,{state:codec.capture(value)},false,graph);
      } else result=restoring?codec.restore(value):codec.capture(value);
    } else if(rule==='ints') {
      const arrays=commandArrays(context);
      if(restoring&&value?.reference){
        const r=value.reference;check(Object.keys(value).length===1&&r&&Object.keys(r).sort().join(',')==='field,slot','INVALID_PHASE_FIELD');
        result=arrays.find(a=>a.slot===r.slot&&a.field===r.field)?.array;check(result,'UNKNOWN_PHASE_COMMAND_ARRAY');
        return result;
      }
      const reference=!restoring&&arrays.find(a=>a.array===value);
      if(reference)return {presence:'value',value:{reference:{slot:reference.slot,field:reference.field}}};
      const items=restoring&&!Array.isArray(value)?value?.items:value;
      if(restoring&&!Array.isArray(value))check(value&&Object.keys(value).every(k=>['items','alias'].includes(k)),'INVALID_PHASE_FIELD');
      check(Array.isArray(items)&&items.length<=10000&&items.every(Number.isSafeInteger),'INVALID_PHASE_FIELD');
      result=restoring?(Array.isArray(value)?[...items]:mutable(null,rule,value,true,graph,()=>[...items])):mutable(value,rule,{items:[...items]},false,graph);
    } else {
      check(rule==='bool'?typeof value==='boolean':rule==='string'?typeof value==='string'&&value.length<=100000
        :rule==='int'?Number.isSafeInteger(value):typeof value==='number'&&Number.isFinite(value),'INVALID_PHASE_FIELD');result=value;
    }
    return restoring?result:{presence:'value',value:result};
  }
  function verify(type,values,context,scope) {
    check(scope===null||scope===0||scope===1,'INVALID_PHASE_SCOPE');
    if(type==='EggHatchPhase'){
      check([0,1].includes(scope)&&context.eggState?.players[scope]?.includes(values.egg),'INVALID_EGG_OWNER');
      if(values.pokemon!==undefined)check(values.pokemon!==null&&values.egg.hatchWaves<=0
        &&Number.isInteger(values.eggMoveIndex)&&values.eggMoveIndex>=0&&values.eggMoveIndex<=3,'INVALID_HATCH_RESULT');
    }
    if(Object.hasOwn(values,'fieldIndex'))check(Number.isInteger(values.fieldIndex)&&values.fieldIndex>=0&&values.fieldIndex<=1,'INVALID_PHASE_FIELD');
    if(Object.hasOwn(values,'moveId'))check(Number.isSafeInteger(values.moveId)&&hasMove?.(values.moveId),'UNKNOWN_MOVE');
    if(values.partyMemberIndex!==undefined) {
      const group=context.roster.entries.filter(e=>values.player?e.owner===scope&&e.group==='party':e.owner===null).sort((a,b)=>a.index-b.index);
      check(Number.isInteger(values.partyMemberIndex)&&values.partyMemberIndex>=0&&values.partyMemberIndex<group.length,'INVALID_PHASE_PARTY_REFERENCE');
      check(values.player===false||scope!==null,'INVALID_PHASE_SCOPE');
    }
    if(values.player!==undefined)check(typeof values.player==='boolean','INVALID_PHASE_FIELD');
    if(values.battlerIndex!==undefined)check(Number.isSafeInteger(values.battlerIndex)&&(values.battlerIndex>=0&&values.battlerIndex<=3
      ||context.roster.entries.some(e=>e.pokemon.id===values.battlerIndex)),'UNKNOWN_PHASE_POKEMON');
    if(values.targets)check(values.targets.length<=4&&values.targets.every(n=>n>=-1&&n<=3),'INVALID_PHASE_TARGET');
    if(values.slotIndex!==undefined)check(Number.isInteger(values.slotIndex)&&values.slotIndex>=-1&&values.slotIndex<6,'INVALID_PHASE_SLOT');
  }
  function restore(input,context,sceneForScope,graph=createGraph()) {
    const s=copy(input);
    check(s&&Object.keys(s).sort().join(',')==='fields,presentation,scope,type,version'&&s.version===1&&Object.hasOwn(constructors,s.type)
      &&phaseStateFields[s.type]&&!phaseStateFields[s.type].abstract,'UNSUPPORTED_PHASE');
    const spec=schema(s.type);
    check(s.fields&&Object.keys(s.fields).every(k=>Object.hasOwn(spec.fields,k))&&spec.required.every(k=>Object.hasOwn(s.fields,k)),'INVALID_PHASE_FIELD');
    const values=Object.fromEntries(Object.entries(s.fields).map(([key,value])=>[key,encode(value,spec.fields[key],context,true,graph)]));
    // Older shared-scene forced SwitchPhases stored null scope. Their original
    // fieldIndex still identifies the sole owner. Canonicalize that legacy
    // representation; explicit conflicting scopes remain invalid at decisions.
    if(s.type==='SwitchPhase'&&s.scope===null&&values.isModal===true&&values.doReturn===false)s.scope=values.fieldIndex;
    for(const key of spec.required)if(['pokemon','move','ints','weather','modifierType','formChange','bool','egg'].includes(spec.fields[key]))
      check(values[key]!=null,'INVALID_PHASE_FIELD');
    check(s.presentation&&Object.keys(s.presentation).every(k=>spec.display.includes(k)&&k!=='scene'&&!rendererFields.has(k)),'INVALID_PHASE_PRESENTATION');
    for(const [key,value]of Object.entries(s.presentation)){
      check(value&&Object.keys(value).sort().join(',')===(value.presence==='value'?'presence,value':'presence')
        &&['undefined','value'].includes(value.presence),'INVALID_PHASE_PRESENTATION');
      const v=value.presence==='undefined'?undefined:value.value;
      check(v===undefined||v===null||['string','boolean'].includes(typeof v)||typeof v==='number'&&Number.isFinite(v),'INVALID_PHASE_PRESENTATION');values[key]=v;
    }
    verify(s.type,values,context,s.scope);
    const candidate=Object.create(constructors[s.type].prototype);
    scopes.set(candidate,s.scope);
    for(const [key,value]of Object.entries(values)){
      for(let proto=Object.getPrototypeOf(candidate);proto;proto=Object.getPrototypeOf(proto)){
        const descriptor=Object.getOwnPropertyDescriptor(proto,key);check(!descriptor||'value'in descriptor,'MODEL_ACCESSOR');
      }
      Object.defineProperty(candidate,key,{value,writable:true,enumerable:true,configurable:true});
    }
    if(sceneForScope)Object.defineProperty(candidate,'scene',{value:sceneForScope(s.scope),writable:true,enumerable:true,configurable:true});
    if(sceneForScope)for(const key of ['pokemon','lastPokemon'])if(values[key]&&!context.roster.entries.some(e=>e.pokemon===values[key]))
      Object.defineProperty(values[key],'scene',{value:sceneForScope(s.scope),writable:true,enumerable:true,configurable:true});
    return candidate;
  }
  return Object.freeze({restore,createGraph,isPhase:value=>!!value&&prototypes.has(Object.getPrototypeOf(value)),capture(value,context,scope=scopes.get(value)??null,graph) {
    const type=prototypes.get(Object.getPrototypeOf(value));check(type&&phaseStateFields[type]&&!phaseStateFields[type].abstract,'UNSUPPORTED_PHASE');
    const spec=schema(type),descriptors=Object.getOwnPropertyDescriptors(value);
    check(Reflect.ownKeys(descriptors).every(k=>typeof k==='string'&&'value'in descriptors[k]
      &&(Object.hasOwn(spec.fields,k)||spec.display.includes(k))),'INVALID_PHASE_FIELD');
    const fields=Object.fromEntries(Object.entries(spec.fields).filter(([k])=>Object.hasOwn(descriptors,k))
      .map(([key,rule])=>[key,encode(descriptors[key].value,rule,context,false,graph)]));
    if(type==='SwitchPhase'&&scope===null&&fields.isModal?.value===true&&fields.doReturn?.value===false)scope=fields.fieldIndex?.value;
    const presentation=Object.fromEntries(spec.display.filter(k=>k!=='scene'&&!rendererFields.has(k)&&Object.hasOwn(descriptors,k))
      .map(k=>[k,descriptors[k].value===undefined?{presence:'undefined'}:{presence:'value',value:descriptors[k].value}]));
    const snapshot={version:1,type,scope,fields,presentation};restore(snapshot,context);scopes.set(value,scope);return snapshot;
  }});
}
