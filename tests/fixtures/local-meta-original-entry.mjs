import { GameData, createOriginalRuntime, constructOriginalPokemon } from '../../src/server/original-runtime';
import { withOriginalRules } from '../../server/original-random-context.mjs';
import { readLocalSave } from '../../src/system/local-save-store';
import { allSpecies } from '../../src/data/pokemon-species';
export { originalSaveCodec } from '../../src/local-meta/original-save-codec';
export { captureLegacySource, prsvSystemSource, previewPrsvSession } from '../../src/local-meta/legacy-source';
export { GameData } from '../../src/system/game-data';
export { AES } from 'crypto-js';
export { mutateLocalSaves } from '../../src/system/local-save-store';

export function largeOriginalDexAttribute() {
  const species = allSpecies.reduce((best,next) => next.forms.length > best.forms.length ? next : best);
  return {speciesId:species.speciesId,value:GameData.prototype.getFormAttr(species.forms.length-1).toString()};
}

export async function originalFixture() {
  const runtime = createOriginalRuntime('local-meta-original-fixture',{trainerId:12,secretId:34});
  const scene = runtime.scene;
  scene.game = {config:{gameVersion:'1.0.0'}};
  const data = withOriginalRules(runtime.context,() => new GameData(scene,{readOnly:true}));
  data.readonlyView = false; // Test only: run the real serializer after read-only construction.
  data.trainerId = 12; data.secretId = 34; data.gender = 0;
  scene.gameData = data;
  scene.initializeRunResources();
  if (!await data.saveSystem()) throw new Error('ORIGINAL_FIXTURE_SAVE_FAILED');
  const system = JSON.parse(await readLocalSave('data'));
  scene.party = [constructOriginalPokemon(runtime,1,5)];
  scene.currentBattle = {waveIndex:1,battleType:0,enemyParty:[constructOriginalPokemon(runtime,4,5,true)]};
  scene.sessionPlayTime = 0;
  const session = JSON.parse(JSON.stringify(data.getSessionSaveData(scene)));
  return {system,session};
}
