// Translation provenance, never a translation table or rule state. Remember
// the original i18next call at the moment it produces text; do not parse or
// reverse-translate English sentences received from the rule host.
const texts=new Map(),limit=1024;
export function resetPresentationText(){texts.clear();}
const clone=value=>JSON.parse(JSON.stringify(value));
export function presentationText(text){return typeof text==='string'?texts.get(text)??null:null;}
export function rememberPresentationText(text,value){
 if(typeof text!=='string'||!text||!value)return text;
 const previous=texts.get(text),wire=clone(value);
 // Ambiguous outputs are left as legacy text rather than assigning the wrong
 // key to a same-spelled name/message from a different original call.
 if(texts.has(text)&&JSON.stringify(previous)!==JSON.stringify(wire))texts.set(text,null);
 else texts.set(text,wire);
 while(texts.size>limit)texts.delete(texts.keys().next().value);
 return text;
}
const captured=(value,depth=0)=>{
 if(depth>6)return typeof value==='string'?value:null;
 if(typeof value==='string')return presentationText(value)??value;
 if(value===null||['number','boolean'].includes(typeof value))return value;
 if(Array.isArray(value))return value.map(v=>captured(v,depth+1));
 return null;
};
export function rememberTranslation(text,key,options={},includeFallback=true){
 if(typeof text!=='string'||typeof key!=='string')return text;
 const values={};
 for(const [name,value]of Object.entries(options??{})){
  if(['lng','lngs','ns','fallbackLng','defaultValue','returnObjects','returnDetails','interpolation'].includes(name))continue;
  if(typeof value!=='function'&&value!==undefined)values[name]=captured(value);
 }
 return rememberPresentationText(text,{kind:'translation',key:key.includes(':')?key:`${options?.ns??'menu'}:${key}`,values,
  ...(includeFallback&&typeof options?.defaultValue==='string'?{fallback:options.defaultValue}:{})});
}
export function renderPresentationText(value,translate,pokemonName,depth=0){
 if(depth>8)throw Error('PRESENTATION_TEXT_DEPTH');
 if(typeof value==='string'||typeof value==='number'||typeof value==='boolean'||value===null)return value;
 if(Array.isArray(value))return value.map(v=>renderPresentationText(v,translate,pokemonName,depth+1));
 if(value?.kind==='translation'){
  const values=Object.fromEntries(Object.entries(value.values??{}).map(([key,v])=>[key,renderPresentationText(v,translate,pokemonName,depth+1)]));
  return translate(value.key,{...values,...(value.fallback?{defaultValue:value.fallback}:{})})+(value.suffix??'');
 }
 if(value?.kind==='pokemon-name'){
  const name=pokemonName(value.pokemonId)??value.fallback;
  return value.affix?translate(`battle:${value.affix}`,{pokemonName:name}):name;
 }
 if(value?.kind==='translation-page')return translate(value.key).split('$')[value.index]?.trim()??'';
 if(value?.kind==='message-fragment'){
  const pages=String(renderPresentationText(value.source,translate,pokemonName,depth+1)).split('$');
  return value.part==='head'?pages[0].trim():pages.slice(1).join('$');
 }
 if(value?.kind==='joined')return value.parts.map(v=>renderPresentationText(v,translate,pokemonName,depth+1)).join('');
 throw Error('INVALID_PRESENTATION_TEXT');
}
