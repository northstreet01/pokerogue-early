import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const cwd = process.argv[2];
if (!cwd) throw new Error('Usage: node early-version-audit.mjs <upstream-repository> [output.json]. Requires full upstream history and audit-upstream/main.');
function git(args, binary = false) {
  const result = spawnSync('git', args, { cwd, encoding: binary ? undefined : 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(String(result.stderr));
  return result.stdout;
}
function sourceFiles(ref) {
  const tar = git(['archive', '--format=tar', ref, 'src'], true);
  const files = [];
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
    if (!name) break;
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim(), 8) || 0;
    if (/\.(ts|tsx|js|jsx)$/.test(name)) files.push({ name, size, content: tar.subarray(offset + 512, offset + 512 + size).toString() });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}
const candidates = ['2f17903d3', git(['rev-list','-1','--before=2023-12-01','audit-upstream/main']).trim(),
  'a8d5de9f3', 'ec9365a8b', '55dc33964', '99e17c94e', '1174d9f35'];
const results = candidates.map(ref => {
  const files = sourceFiles(ref);
  const core = files.filter(f => !/\.d\.ts$|^src\/(?:locales|test|tests)\/|\.(?:test|spec)\.[jt]sx?$/.test(f.name));
  const pkg = JSON.parse(git(['show', `${ref}:package.json`]));
  const tree = git(['ls-tree','-r',ref]);
  const content = files.map(f => f.content).join('\n');
  return { commit: git(['rev-parse',ref]).trim(), date: git(['show','-s','--format=%aI',ref]).trim(),
    version: pkg.version, sourceFiles: files.length, sourceBytes: files.reduce((sum,f)=>sum+f.size,0),
    sourceLines: files.reduce((sum,f)=>sum+f.content.split('\n').length,0),
    coreFiles: core.length, coreBytes: core.reduce((sum,f)=>sum+f.size,0),
    coreLines: core.reduce((sum,f)=>sum+f.content.split('\n').length,0),
    dependencies: Object.keys(pkg.dependencies ?? {}).length, devDependencies: Object.keys(pkg.devDependencies ?? {}).length,
    phases: (content.match(/export (?:abstract )?class \w+Phase\b/g) ?? []).length,
    mysteryEncounter: /MysteryEncounter/.test(content), doubleBattle: /doubleBattle|DoubleBattle|double: boolean/.test(content),
    seededRng: /srand|executeWithSeedOffset|battleSeed/.test(content),
    mathRandom: (content.match(/Math\.random\(/g) ?? []).length,
    chineseFiles: tree.split('\n').filter(l=>/zh[-_]?(?:CN|Hans|cn)|\/zh\//.test(l)).length,
    testFiles: tree.split('\n').filter(l=>/\t(?:src\/)?(?:test|tests)\/.*\.(?:ts|js)$|\.(?:test|spec)\.[jt]s$/.test(l)).length,
    largeFiles: core.filter(f=>/(?:battle-scene|battle-phases|phases|pokemon|move|ability)\.ts$/.test(f.name))
      .map(f=>({path:f.name, lines:f.content.split('\n').length})),
    tools: { phaser: pkg.dependencies?.phaser, vite: pkg.devDependencies?.vite, typescript: pkg.devDependencies?.typescript }
  };
});
fs.writeFileSync(process.argv[3] ?? 'early-version-metrics.json', JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
