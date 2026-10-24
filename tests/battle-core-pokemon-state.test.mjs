import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { pokemonStateFields, pokemonPresentationFields } from '../src/battle-core/pokemon-state.mjs';
import { pokemon, species, parse, evaluate, originalPokemon } from './helpers/original-model.mjs';

const wire = value => JSON.parse(JSON.stringify(value));
const { capturePokemonState: capture, restorePokemonState: restore } = pokemon;

test('original signed damage records survive JSON without accepting nonfinite, fractional or unsafe values', () => {
 const original=originalPokemon(100);
 original.turnData.damageDealt=-1;original.turnData.attacksReceived[0].damage=-1;
 const saved=capture(original),restored=restore(wire(saved));
 assert.equal(restored.turnData.damageDealt,-1);assert.equal(restored.turnData.attacksReceived[0].damage,-1);
 assert.deepEqual(capture(restored),saved);
 for(const value of [NaN,Infinity,-Infinity,0.5,Number.MAX_SAFE_INTEGER+1]){
  original.turnData.damageDealt=value;assert.throws(()=>capture(original),/damageDealt/);
  original.turnData.damageDealt=-1;original.turnData.attacksReceived[0].damage=value;assert.throws(()=>capture(original),/damage/);
  original.turnData.attacksReceived[0].damage=-1;
 }
});

test('original early-exit hit counter retains its NaN sentinel through JSON, with a closed wire shape',()=>{
 const original=originalPokemon(100);original.turnData.hitsLeft=NaN;
 const saved=capture(original),restored=restore(wire(saved));
 assert.equal(Number.isNaN(restored.turnData.hitsLeft),true);assert.deepEqual(capture(restored),saved);
 for(const invalid of [Infinity,-Infinity,0.5,Number.MAX_SAFE_INTEGER+1]){
  original.turnData.hitsLeft=invalid;assert.throws(()=>capture(original),/hitsLeft/);
 }
 for(const invalid of [{nan:false},{nan:true,extra:1},{}]){
  const changed=wire(saved);changed.fields.turnData.fields.hitsLeft=invalid;
  assert.throws(()=>restore(changed),/hitsLeft/);
 }
});

test('Pokemon state manifest covers every original declared field and nested record', () => {
  const source = parse('field/pokemon.ts');
  for (const [name, schema] of Object.entries(pokemonStateFields)) {
    const decl = source.statements.find(n => (ts.isClassDeclaration(n) || ts.isInterfaceDeclaration(n)) && n.name?.text === name);
    assert.ok(decl, name);
    const fields = decl.members.filter(n => ts.isPropertyDeclaration(n) || ts.isPropertySignature(n)).map(n => n.name.getText());
    assert.deepEqual(fields.sort(), [...Object.keys(schema), ...(name === 'Pokemon' ? pokemonPresentationFields : [])].sort(), name);
  }
});
test('original player and enemy/Boss state survives JSON with classes, overrides, PP and effects intact', () => {
  for (const enemy of [false, true]) {
    const original = originalPokemon(100, enemy), saved = capture(original), restored = restore(wire(saved));
    assert.equal(Object.getPrototypeOf(restored), Object.getPrototypeOf(original));
    assert.deepEqual(capture(restored), saved);
    assert.equal(restored.species, species.get(1)); assert.equal(restored.fusionSpecies, species.get(4));
    assert.equal(restored.getSpeciesForm(), species.get(4).forms[1]); assert.equal(restored.getFusionSpeciesForm(), species.get(7));
    assert.equal(restored.getMoveset()[0].getMovePp(), original.getMoveset()[0].getMovePp());
    assert.equal(restored.moveset[0].isUsable(restored), false);
    assert.equal(restored.isPlayer(), !enemy);
    assert.equal(restored.status.isPostTurn(), true);
    assert.equal(restored.summonData.tags[0].constructor, original.summonData.tags[0].constructor);
    assert.equal(Object.hasOwn(restored.summonData, 'gender'), true); assert.equal(restored.summonData.gender, undefined);
    assert.equal(restored.summonData.fusionGender, null); assert.equal(Object.hasOwn(restored.summonData, 'stats'), false);
    restored.summonData.moveQueue[0].targets.push(0); assert.notDeepEqual(restored.getMoveQueue(), original.getMoveQueue());
  }
});
test('uninterrupted vs restored original methods produce identical state and continuation', () => {
  const original = originalPokemon(), restored = restore(wire(capture(original)));
  function continueOriginal(p) {
    const healed = p.heal(8); p.status.incrementTurn(); p.moveset[0].ppUsed += 1;
    p.summonData.disabledTurns--; p.battleData.hitCount++; p.getMoveQueue().shift();
    return { healed, maxHp: p.getMaxHp(), pp: p.moveset[0].getPpRatio(), state: capture(p) };
  }
  assert.deepEqual(continueOriginal(restored), continueOriginal(original));
});
test('corrupt fields, catalog references, versions and getters are rejected without changing the old model', () => {
  const original = originalPokemon(), before = capture(original);
  const cases = [s => { s.version++; }, s => { delete s.fields.hp; }, s => { s.fields.hp = 1000; }, s => { s.fields.species = 999999; }, s => { s.fields.formIndex = 999; }, s => { s.fields.ivs[0] = 32; }, s => { s.fields.moveset[0].fields.moveId = 999999; }, s => { s.fields.moveset[0].fields.ppUp = -1; }, s => { s.fields.summonData.fields.battleStats[0] = 7; }, s => { s.fields.summonData.fields.extra = true; }, s => { s.fields.summonData.fields.speciesForm.formIndex = 9; }, s => { s.fields.levelExp = -1; }];
  for (const mutate of cases) { const bad = wire(before); mutate(bad); assert.throws(() => restore(bad), /Invalid/); assert.deepEqual(capture(original), before); }
  Object.defineProperty(original, 'hp', { get() { throw Error('getter invoked'); }, configurable: true, enumerable: true });
  assert.throws(() => capture(original), /Invalid/);
  Object.defineProperty(pokemon.PlayerPokemon.prototype, 'levelExp', { get() { throw Error('getter invoked'); }, configurable: true });
  try { assert.throws(() => restore(wire(before)), /accessor levelExp/); } finally { delete pokemon.PlayerPokemon.prototype.levelExp; }
});

test('checkpoint preserves actual early PP Up arithmetic and the exhausted Boss segment sentinel', () => {
  const cls = parse('modifier/modifier.ts').statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'PokemonPpUpModifier');
  const apply = cls.members.find(n => ts.isMethodDeclaration(n) && n.name.getText() === 'apply').getText();
  const { OriginalModifier } = evaluate(`export class OriginalModifier { ${apply} }`);
  const original = originalPokemon(); original.summonData.moveset[0].ppUp = 1;
  OriginalModifier.prototype.apply.call({ moveIndex: 0, upPoints: 3 }, [original]);
  assert.equal(original.getMoveset()[0].ppUp, 4); // Preserve early behavior; do not impose a new cap.
  assert.equal(restore(wire(capture(original))).getMoveset()[0].ppUp, 4);
  const enemy = originalPokemon(200, true); enemy.hp = 0; enemy.bossSegmentIndex = -1;
  assert.equal(restore(wire(capture(enemy))).bossSegmentIndex, -1);
});

test('original Eternamax Recover ppUp=-4 survives; other negative PP boosts remain invalid',()=>{
 const generated={species:{speciesId:890},formIndex:1};
 pokemon.EnemyPokemon.prototype.generateAndPopulateMoveset.call(generated,1);
 const recover=generated.moveset.find(move=>move.moveId===105);assert.equal(recover.ppUp,-4);
 const enemy=originalPokemon(200,true);enemy.moveset=generated.moveset;
 const restored=restore(wire(capture(enemy)));assert.equal(restored.moveset[3].ppUp,-4);
 for(const value of [-5,-3,-1]){recover.ppUp=value;assert.throws(()=>capture(enemy),/ppUp/);}
 recover.ppUp=-4;recover.moveId=33;assert.throws(()=>capture(enemy),/ppUp/);
});
test('summon primer preserves shared references; display fields do not affect rule state', () => {
  const original = originalPokemon(); original.primeSummonData(original.summonData);
  const before = capture(original); original.name = '中文显示名'; original.maskSprite = { arbitrary: () => {} }; original.scene = { window: true };
  assert.deepEqual(capture(original), before);
  const restored = restore(wire(before)); assert.equal(restored.summonDataPrimer, restored.summonData);
  assert.deepEqual(restored.summonDataPrimer.moveQueue, restored.summonData.moveQueue);
  assert.equal(restored.scene, undefined); assert.equal(restored.name, undefined);
  restored.summonData.disabledTurns--;
  assert.equal(restored.summonDataPrimer.disabledTurns, restored.summonData.disabledTurns);
  const bad = wire(before); bad.aliases[0].to = []; assert.throws(() => restore(bad), /alias/);
});
