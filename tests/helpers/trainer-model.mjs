import ts from 'typescript';
import { parse, evaluate, read } from './original-model.mjs';
import { createTrainerStateCodec } from '../../src/battle-core/trainer-state.mjs';

const declarations = (file, predicate) => parse(file).statements.filter(predicate).map(n => n.getText()).join('\n');
const strengths = evaluate(declarations('data/enums/party-member-strength.ts', ts.isEnumDeclaration));
const trainerTypes = evaluate(declarations('data/enums/trainer-type.ts', ts.isEnumDeclaration));
const templates = evaluate(`const PartyMemberStrength = ${JSON.stringify(strengths.PartyMemberStrength)};
  ${declarations('data/trainer-config.ts', n => ts.isClassDeclaration(n) && ['TrainerPartyTemplate','TrainerPartyCompoundTemplate'].includes(n.name.text))}`);
export const configs = {
  1: { trainerType: 1, partyTemplates: [new templates.TrainerPartyTemplate(2, strengths.PartyMemberStrength.AVERAGE)], doubleOnly: false },
  2: { trainerType: 2, partyTemplates: [], doubleOnly: true,
    partyTemplateFunc: scene => scene.dynamicTemplate }
};
const dependencies = Object.fromEntries(parse('field/trainer.ts').statements.filter(ts.isImportDeclaration).map(n => [n.moduleSpecifier.text, {}]));
Object.assign(dependencies, {
  '../battle-core/trainer-state.mjs': { createTrainerStateCodec },
  '../data/trainer-config': { ...templates, trainerConfigs: configs, TrainerSlot: { NONE: 0, TRAINER: 1, TRAINER_PARTNER: 2 } },
  '../data/enums/party-member-strength': strengths,
  '../data/enums/trainer-type': trainerTypes
});
// Execute the whole original module, including its production codec exports.
// No renderer constructor, name generation, or random generation may run.
export const trainerModule = evaluate(`const Phaser = { GameObjects: { Container: class {
  constructor() { throw Error('Renderer constructor called'); }
} } };\n${read('field/trainer.ts')}`, dependencies);
export const trainerCodec = { capture: trainerModule.captureTrainerState, restore: trainerModule.restoreTrainerState };
export function originalTrainer(configId = 1) {
  return Object.assign(Object.create(trainerModule.default.prototype), {
    config: configs[configId], variant: 2, partyTemplateIndex: configId === 1 ? 0 : -1
  });
}
export function bindTrainerScene(trainer) {
  trainer.scene = { gameMode: { getWaveForDifficulty: n => n },
    dynamicTemplate: new templates.TrainerPartyCompoundTemplate(
      new templates.TrainerPartyTemplate(2, strengths.PartyMemberStrength.WEAK),
      new templates.TrainerPartyTemplate(1, strengths.PartyMemberStrength.STRONGER)) };
  return trainer;
}
