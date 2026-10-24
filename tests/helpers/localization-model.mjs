import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import i18next from 'i18next';
import * as language from '../../src/system/language.mjs';
import * as presentationText from '../../src/system/presentation-text.mjs';

// Execute the real initializer; replace only Vite's build-time asset glob.
// Isolated legacy rule fixtures retain their original English display locale.
const root=new URL('../../',import.meta.url),bundledLocales={};
for(const lng of ['en','zh-Hans'])for(const file of fs.readdirSync(new URL(`locales/${lng}/`,root)))
 bundledLocales[`../locales/${lng}/${file}`]=JSON.parse(fs.readFileSync(new URL(`locales/${lng}/${file}`,root),'utf8'));
const source=fs.readFileSync(new URL('src/i18n.ts',root),'utf8').replace(/import\.meta\.glob\([^;]+\)/,'bundledLocales');
export const originalI18n=i18next.createInstance();
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
 exports:{},bundledLocales,localStorage:{getItem:()=> 'en'},require:key=>{
  if(key==='i18next')return {default:originalI18n};
  if(key==='./system/language.mjs')return language;
  if(key==='./system/presentation-text.mjs')return presentationText;
  throw Error(`Unexpected localization dependency ${key}`);
 }});

// The genuine display helper, with each legacy fixture's existing message/name
// ports. No translation or rule behavior is reimplemented by the fixture.
export function originalLocalizedPokemonMessage(message,name){
 const ast=ts.createSourceFile('messages.ts',fs.readFileSync(new URL('src/messages.ts',root),'utf8'),ts.ScriptTarget.Latest,true);
 const source=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='getLocalizedPokemonMessage').getText(ast);
 const exports={};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,i18next:originalI18n,getPokemonMessage:message,getPokemonNameWithAffix:name});
 return exports.getLocalizedPokemonMessage;
}
