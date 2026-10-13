import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {parse} from './helpers/original-model.mjs';
import {modifierFields} from '../src/battle-core/modifier-fields.mjs';
import {modifierSchema} from '../src/battle-core/modifier-state.mjs';
import {copy} from '../src/battle-core/coop-contract.mjs';
import {modifiers,types,modifierCodec,originalModifier} from './helpers/modifier-model.mjs';

test('all original Modifier declarations and inheritance match the explicit registry',()=>{
  const classes=parse('modifier/modifier.ts').statements.filter(ts.isClassDeclaration).filter(c=>c.name.text!=='ModifierBar');
  const actual=Object.fromEntries(classes.map(c=>[c.name.text,{parent:c.heritageClauses?.[0]?.types[0].expression.getText()??null,
    abstract:!!c.modifiers?.some(m=>m.kind===ts.SyntaxKind.AbstractKeyword),fields:Object.fromEntries(c.members.filter(ts.isPropertyDeclaration).map(p=>[p.name.getText(),p.type.getText()]))}]));
  assert.deepEqual(actual,modifierFields);
});
test('every concrete Modifier preserves declared state and prototype without gameplay constructors',()=>{
  const type=originalModifier().type;
  for(const [name,spec] of Object.entries(modifierFields)) {
    if(spec.abstract)continue;
    const original=Object.create(modifiers[name].prototype);
    for(const [key,kind] of Object.entries(modifierSchema(name))) original[key]=key==='type'?type:kind==='boolean'?true:key==='boostMultiplier'?1.25:2;
    const saved=modifierCodec.capture(original),restored=modifierCodec.restore(copy(saved));
    assert.equal(Object.getPrototypeOf(restored),Object.getPrototypeOf(original),name);
    assert.deepEqual(modifierCodec.capture(restored),saved,name);
    if(typeof original.getArgs==='function')assert.deepEqual(restored.getArgs(),original.getArgs(),name);
  }
});
test('every static catalog factory and each generated type recover without reward RNG',()=>{
  let count=0;
  for(const [id,factory] of Object.entries(types.modifierTypes)){
    const original=factory();if(original instanceof types.ModifierTypeGenerator)continue;
    original.id=id;original.tier=0;
    const state=types.captureModifierTypeState(original),restored=types.restoreModifierTypeState(copy(state));
    assert.deepEqual(types.captureModifierTypeState(restored),state,id);count++;
    const modifier = original.newModifier({id:100}, id === 'DNA_SPLICERS' ? {id:101} : 0);
    const checkpoint = modifierCodec.capture(modifier);
    assert.deepEqual(modifierCodec.capture(modifierCodec.restore(checkpoint)),checkpoint,id);
  }
  assert.ok(count>60);
  const cases=[['TEMP_STAT_BOOSTER','TempBattleStatBoosterModifierType',[0]],['BASE_STAT_BOOSTER','PokemonBaseStatBoosterModifierType',['Protein',1]],
    ['BERRY','BerryModifierType',[0]],['ATTACK_TYPE_BOOSTER','AttackTypeBoosterModifierType',[0,20]],['TERA_SHARD','TerastallizeModifierType',[18]],
    ['TM_COMMON','TmModifierType',[33]],['EVOLUTION_ITEM','EvolutionItemModifierType',[1]],['FORM_CHANGE_ITEM','FormChangeItemModifierType',[0]]];
  for(const [id,cls,args] of cases){
    const original=new types[cls](...args);original.id=id;original.generatorId=undefined;original.tier=2;
    const saved=types.captureModifierTypeState(original),restored=types.restoreModifierTypeState(copy(saved));
    assert.deepEqual(types.captureModifierTypeState(restored),saved,id);
    // Closures must be rebuilt against the restored type (TM in particular).
    const m=restored.newModifier({id:100});assert.equal(m.type,restored,id);
    const checkpoint=modifierCodec.capture(m);
    assert.deepEqual(modifierCodec.capture(modifierCodec.restore(checkpoint)),checkpoint,id);
  }
});
test('restored real modifiers continue arithmetic and reject corrupt state without clamping',()=>{
  const original=originalModifier();original.virtualStackCount=3;original.stackCount=999;
  const state=modifierCodec.capture(original),restored=modifierCodec.restore(copy(state));
  const a={value:100},b={value:100};original.apply([a]);restored.apply([b]);assert.deepEqual(a,b);assert.equal(restored.stackCount,999);
  for(const mutate of [s=>{s.type='Modifier';},s=>{s.fields.stackCount.value=-1;},s=>{s.fields.type.value.catalogId='missing';},s=>{s.fields.extra={presence:'absent'};}]){
    const bad=copy(state);mutate(bad);assert.throws(()=>modifierCodec.restore(bad));assert.deepEqual(modifierCodec.capture(original),state);
  }
  original.unknown=1;assert.throws(()=>modifierCodec.capture(original));
});
