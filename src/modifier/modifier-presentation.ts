import i18next from '../i18n';

// Display metadata lives outside original instances. Catalog factories rebuild
// it on restore; codec fields, equality, item IDs and original names stay intact.
const display = new WeakMap<object,{name?:string;description?:string;values:()=>any}>();
export function registerModifierDisplay(type:object, options:{name?:string;description?:string;values?:()=>any}) {
  display.set(type,{...options,values:options.values ?? (()=>({}))});
}
export function modifierDisplayName(type:any):string {
  const data=display.get(type);
  if (!data?.name && i18next.exists(`earlyModifier:names.${type.id}`)) return i18next.t(`earlyModifier:names.${type.id}`);
  return String(i18next.t(data?.name ?? `modifierType:ModifierType.${type.id}.name`,{
    ...data?.values(), defaultValue:type.name,
  }));
}
export function modifierDisplayDescription(type:any,scene:any,original:string):string {
  const data=display.get(type);
  if (data?.description) return String(i18next.t(data.description,{...data.values(),defaultValue:original}));
  if (i18next.exists(`earlyModifier:items.${type.id}`)) return i18next.t(`earlyModifier:items.${type.id}`);
  // Static modern descriptions are reused only when the early English text
  // agrees. Mechanics which changed have explicit early overrides above.
  const key=`modifierType:ModifierType.${type.id}.description`;
  const normalize=(value:string)=>value.replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim();
  if (normalize(i18next.t(key,{lng:'en',defaultValue:''}))===normalize(original)) return i18next.t(key,{defaultValue:original});
  return original;
}
