import {readFile,readdir,stat} from 'node:fs/promises';
import {resolve,dirname,extname,relative} from 'node:path';
import ts from 'typescript';

// Structural review, not a replacement for reviewing behavior, ownership and
// failure paths in the diff. Covers first-party source, tooling and test imports.
const root=resolve('.'), files=[], errors=[], graph=new Map();
async function walk(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=resolve(directory,entry.name);
    if(entry.isDirectory())await walk(path);
    else if(/\.(?:[cm]?js|tsx?)$/.test(path))files.push(path);
  }
}
for(const directory of ['src','server','desktop','scripts','tests'])await walk(directory);
files.push(resolve('vite.config.js'),resolve('vitest.config.js'));
async function localModule(owner,specifier){
  if(!specifier.startsWith('.'))return null;
  const base=resolve(dirname(owner),specifier.split('?')[0]);
  for(const candidate of [base,...['.ts','.tsx','.mjs','.js','.cjs','/index.ts','/index.mjs','/index.js'].map(ext=>base+ext)]){
    try{if((await stat(candidate)).isFile())return candidate;}catch{}
  }
  errors.push(`${relative(root,owner)}: unresolved ${specifier}`);return null;
}
for(const file of files){
  const text=await readFile(file,'utf8'), imports=ts.preProcessFile(text,true,true).importedFiles, deps=[];
  const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,false,file.endsWith('.ts')?ts.ScriptKind.TS:ts.ScriptKind.JS);
  for(const diagnostic of source.parseDiagnostics)errors.push(`${relative(root,file)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText,' ')}`);
  for(const entry of imports){const found=await localModule(file,entry.fileName);if(found)deps.push(found);}
  graph.set(file,deps);
}
const documents=(await readdir(root)).filter(name=>name.endsWith('.html')).sort();
if(JSON.stringify(documents)!==JSON.stringify(['coop-play.html','index.html']))errors.push('Only the home/solo and formal cooperative game documents may ship.');
for(const page of documents){
  const html=await readFile(page,'utf8');
  for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)){
    const value=match[1];if(/^(?:https?:|data:)/.test(value))continue;
    if(value.endsWith('.html'))errors.push(`${page}: document links must use guarded in-app navigation: ${value}`);
    if(!value.endsWith('.html')){
      const path=resolve(value.replace(/^\//,''));
      try{await stat(path);}catch{try{await stat(resolve('public',value.replace(/^\//,'')));}catch{errors.push(`${page}: missing resource ${value}`);}}
    }
  }
}
// Runtime imports assembled from paths by the packager are explicit graph roots.
const entries=['src/main.ts','src/server/original-runtime.ts','desktop/main.cjs','desktop/preload.cjs','desktop/runtime.mjs','desktop/storage.mjs','desktop/smoke.cjs','desktop/ready-smoke.cjs','server/start.mjs'];
const reached=new Set();function visit(file){if(reached.has(file))return;reached.add(file);for(const dependency of graph.get(file)??[])visit(dependency);}
entries.forEach(file=>visit(resolve(file)));
const sourceModules=files.filter(file=>file.startsWith(resolve('src')+'/')||file.startsWith(resolve('src')+'\\'));
const unreachable=sourceModules.filter(file=>!reached.has(file)&&!file.endsWith('.d.ts')).map(file=>relative(root,file));
for(const file of unreachable)errors.push(`Unowned production module: ${file}. Remove it or move test/tool-only code to its owner.`);
console.log(JSON.stringify({checkedModules:files.length,sourceModules:sourceModules.length,documents,unreachableModules:unreachable,errors},null,2));
if(errors.length)process.exitCode=1;
