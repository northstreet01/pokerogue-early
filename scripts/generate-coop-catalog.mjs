import fs from 'node:fs';
import ts from 'typescript';

const parse = path => ts.createSourceFile(path, fs.readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
function enumeration(path) {
  const source = parse(path), result = {}; let next = 0;
  for (const node of source.statements) if (ts.isEnumDeclaration(node)) for (const member of node.members) {
    if (member.initializer) next = Number(member.initializer.getText(source));
    result[member.name.getText(source)] = next++;
  }
  return result;
}
const speciesIds = enumeration('src/data/enums/species.ts');
const moveIds = enumeration('src/data/enums/moves.ts');
const types = enumeration('src/data/type.ts');
const growth = enumeration('src/data/exp.ts');
const speciesNames = ['BULBASAUR', 'CHARMANDER', 'SQUIRTLE', 'CATERPIE', 'PIDGEY', 'RATTATA', 'PIKACHU', 'GEODUDE', 'MAGIKARP', 'EEVEE'];
const moveNames = ['POUND', 'SCRATCH', 'GUST', 'VINE_WHIP', 'TACKLE', 'QUICK_ATTACK', 'WATER_GUN', 'ROCK_THROW', 'EMBER', 'THUNDER_SHOCK', 'GROWL', 'TAIL_WHIP', 'SPLASH', 'STRUGGLE'];
const species = {}, moves = {};
function visit(node, callback) { callback(node); ts.forEachChild(node, child => visit(child, callback)); }
const source = parse('src/data/pokemon-species.ts');
const number = node => Number(node.getText());
const enumName = node => node.getText().split('.').at(-1);
visit(source, node => {
  if (!ts.isCallExpression(node) || node.expression.getText(source) !== 'new PokemonSpecies') return;
});
visit(source, node => {
  if (!ts.isNewExpression(node) || node.expression.getText(source) !== 'PokemonSpecies') return;
  const a = node.arguments, name = enumName(a[0]);
  if (!speciesNames.includes(name)) return;
  species[speciesIds[name]] = { id: speciesIds[name], name: a[1].text, key: name,
    types: [types[enumName(a[7])], ...(a[8].getText(source) === 'null' ? [] : [types[enumName(a[8])]])],
    stats: a.slice(15, 21).map(number), catchRate: number(a[21]), baseExp: number(a[23]), growth: growth[enumName(a[24])], learnset: [] };
});
const moveSource = parse('src/data/move.ts');
visit(moveSource, node => {
  if (!ts.isNewExpression(node) || !['AttackMove', 'StatusMove', 'SelfStatusMove'].includes(node.expression.getText(moveSource))) return;
  const a = node.arguments, name = enumName(a[0]);
  if (!moveNames.includes(name)) return;
  const attack = node.expression.getText(moveSource) === 'AttackMove';
  moves[moveIds[name]] = { id: moveIds[name], key: name, name: a[1].text, type: types[enumName(a[2])],
    category: attack ? enumName(a[3]) : 'STATUS', power: attack ? number(a[4]) : 0,
    accuracy: number(a[attack ? 5 : 3]), pp: number(a[attack ? 6 : 4]), priority: number(a[attack ? 9 : 7]) };
});
const learnSource = parse('src/data/pokemon-level-moves.ts');
visit(learnSource, node => {
  if (!ts.isPropertyAssignment(node) || !ts.isComputedPropertyName(node.name) || !ts.isArrayLiteralExpression(node.initializer)) return;
  const id = speciesIds[enumName(node.name.expression)];
  if (!species[id]) return;
  species[id].learnset = node.initializer.elements.filter(ts.isArrayLiteralExpression).map(entry => [number(entry.elements[0]), moveIds[enumName(entry.elements[1])]]).filter(([, id]) => moves[id]);
});
fs.mkdirSync('src/coop', { recursive: true });
for (const module of ['type', 'exp']) {
  const result = ts.transpileModule(fs.readFileSync(`src/data/${module}.ts`, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
  fs.writeFileSync(`src/coop/original-${module}.mjs`, '// Generated from early v1.0.0. Regenerate with npm run coop:catalog.\n' + result.outputText);
}
if (Object.keys(species).length !== speciesNames.length || Object.keys(moves).length !== moveNames.length) throw new Error('Catalog extraction incomplete');
fs.writeFileSync('src/coop/catalog.mjs', '// Generated from early v1.0.0; supported subset, not the complete ruleset.\nexport const species = ' + JSON.stringify(species, null, 2) + ';\nexport const moves = ' + JSON.stringify(moves, null, 2) + ';\n');
console.log(`Extracted ${Object.keys(species).length} species, ${Object.keys(moves).length} moves.`);
