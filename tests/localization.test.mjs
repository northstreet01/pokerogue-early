import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import i18next from 'i18next';
import * as language from '../src/system/language.mjs';
import * as presentationText from '../src/system/presentation-text.mjs';

const root = new URL('../', import.meta.url);
const bundledLocales = {};
for (const lng of ['en', 'zh-Hans']) {
  for (const file of fs.readdirSync(new URL(`locales/${lng}/`, root))) {
    bundledLocales[`../locales/${lng}/${file}`] = JSON.parse(fs.readFileSync(new URL(`locales/${lng}/${file}`, root), 'utf8'));
  }
}
function loadTs(path, dependencies, globals = {}) {
  // Replace only Vite's build-time glob; execute the real initializer and helpers.
  const source = fs.readFileSync(new URL(path, root), 'utf8')
    .replace(/import\.meta\.glob\([^;]+\)/, 'bundledLocales');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, bundledLocales, require: key => {
    assert.ok(Object.hasOwn(dependencies, key), `unexpected dependency: ${key}`);
    return dependencies[key];
  }, ...globals });
  return exports;
}
function initialize(storage) {
  const instance = i18next.createInstance();
  loadTs('src/i18n.ts', { i18next: { default: instance }, './system/language.mjs': language,'./system/presentation-text.mjs':presentationText }, { localStorage: storage });
  return instance;
}
const storage = value => ({ value, getItem(key) { assert.equal(key, 'prLang'); return this.value; }, setItem(key, value) { assert.equal(key, 'prLang'); this.value = value; } });

// Follow Phaser's Text/TextStyle boundary: setStyle does not update the Text
// object's padding or lineSpacing. This checks helper calls, not canvas layout.
function textHarness(language) {
  class Text {
    constructor(...args) {
      this.style = args.at(-1);
      this.padding = this.style.padding;
      this.lineSpacing = this.style.lineSpacing ?? 0;
    }
    setStyle(style) { this.style = style; return this; }
    setPadding(padding) { this.padding = padding; return this; }
    setLineSpacing(spacing) { this.lineSpacing = spacing; return this; }
    setScale(scale) { this.scale = scale; return this; }
    setShadow(...shadow) { this.shadow = shadow; return this; }
  }
  const helpers = loadTs('src/ui/text.ts', {
    'phaser3-rex-plugins/plugins/gameobjects/tagtext/bbcodetext/BBCodeText': { default: Text },
    'phaser3-rex-plugins/plugins/inputtext': { default: Text },
    '../modifier/modifier-tier': { ModifierTier: {} },
    '../data/enums/egg-type': { EggTier: {} },
    '../i18n': { default: language }
  });
  return { ...helpers, scene: { add: { text: (...args) => new Text(...args), existing() {} } } };
}

test('reused original text receives the same language padding and spacing as newly created text', () => {
  const language = { resolvedLanguage: 'en', language: 'en' };
  const h = textHarness(language);
  const reused = h.addTextObject(h.scene, 0, 0, 'existing', h.TextStyle.MESSAGE);
  for (const lng of ['zh-Hans', 'en']) {
    language.resolvedLanguage = lng;
    h.setTextStyle(reused, h.TextStyle.MESSAGE);
    const fresh = h.addTextObject(h.scene, 0, 0, 'fresh', h.TextStyle.MESSAGE);
    assert.equal(reused.padding.bottom, fresh.padding.bottom);
    assert.equal(reused.lineSpacing, fresh.lineSpacing);
    assert.equal(reused.style.fontFamily, fresh.style.fontFamily);
    assert.equal(reused.scale, fresh.scale);
  }
});

test('text helpers preserve explicit zero/custom spacing and caller wrapping callbacks', () => {
  const h = textHarness({ resolvedLanguage: 'zh-Hans', language: 'en' });
  const callback = text => text;
  const options = { lineSpacing: 0, wordWrap: { width: 120, callback }, padding: { bottom: 2 } };
  const text = h.addTextObject(h.scene, 0, 0, '中文 text', h.TextStyle.MESSAGE, options);
  const bbcode = h.addBBCodeTextObject(h.scene, 0, 0, '[b]中文[/b]', h.TextStyle.MESSAGE, options);
  assert.equal(text.lineSpacing, 0);
  assert.equal(bbcode.lineSpacing, 0);
  h.setTextStyle(text, h.TextStyle.MESSAGE, { ...options, lineSpacing: 13 });
  assert.equal(text.lineSpacing, 13);
  assert.equal(text.padding.bottom, 2);
  assert.equal(text.style.wordWrap.width, 120);
  assert.equal(text.style.wordWrap.callback, callback);
});

test('normal and BBCode helpers use resolved language and fall back consistently when it is unavailable', () => {
  const language = { resolvedLanguage: 'en', language: 'zh-Hans' };
  const h = textHarness(language);
  const before = [h.addTextObject(h.scene, 0, 0, '', h.TextStyle.MESSAGE),
    h.addBBCodeTextObject(h.scene, 0, 0, '', h.TextStyle.MESSAGE)];
  delete language.resolvedLanguage;
  const after = [h.addTextObject(h.scene, 0, 0, '', h.TextStyle.MESSAGE),
    h.addBBCodeTextObject(h.scene, 0, 0, '', h.TextStyle.MESSAGE)];
  for (let i = 0; i < 2; i++) {
    assert.equal(before[i].style.wordWrap.useAdvancedWrap, false);
    assert.equal(after[i].style.wordWrap.useAdvancedWrap, true);
    assert.notEqual(before[i].lineSpacing, after[i].lineSpacing);
  }
});

test('first launch and invalid/unavailable preferences default to Chinese, existing English is retained', () => {
  for (const value of [undefined, null, '', 'bad', 'constructor', 'zh-Hant']) assert.equal(language.readLanguage(storage(value)), 'zh-Hans');
  assert.equal(language.readLanguage({ getItem() { throw Error('blocked'); } }), 'zh-Hans');
  assert.equal(language.readLanguage(undefined), 'zh-Hans');
  assert.equal(language.readLanguage(storage('en')), 'en');
  const saved = storage('en');
  assert.throws(() => language.saveLanguage(saved, 'bad'));
  assert.equal(saved.value, 'en');
});

test('real upstream-style initializer is synchronous and preserves namespaces, interpolation and fallback', () => {
  const i18n = initialize(storage(null));
  assert.equal(i18n.isInitialized, true);
  assert.equal(i18n.language, 'zh-Hans');
  assert.equal(i18n.t('menu:newGame'), '新游戏');
  assert.equal(i18n.t('pokemon:bulbasaur'), '妙蛙种子');
  assert.equal(i18n.t('move:tackle.name'), '撞击');
  assert.ok(i18n.hasResourceBundle('zh-Hans', 'abilityTriggers'));
  assert.ok(i18n.hasResourceBundle('zh-Hans', 'biome'));
  const name = '<name> {{level}} $t(menu:newGame)';
  assert.ok(i18n.t('battle:playerGo', { pokemonName: name }).includes(name));
  i18n.addResource('en', 'menu', 'earlyTestFallback', 'English fallback');
  assert.equal(i18n.t('menu:earlyTestFallback'), 'English fallback');
});

test('language selection persists until reload and never writes a game save or reloads a live battle', () => {
  const saved = storage(null), current = initialize(saved);
  const settings = { Setting: { Language: 'LANGUAGE', Touch_Controls: 'TOUCH_CONTROLS' } };
  const Handler = loadTs('src/ui/settings-ui-handler.ts', {
    '../battle-scene': {}, '../system/settings': settings,
    '../touch-controls': { hasTouchscreen: () => false, isMobile: () => false },
    './text': { TextStyle: { WINDOW: 0, SETTINGS_SELECTED: 1 }, getTextColor: () => '' },
    './ui': {}, './ui-handler': { default: class {} }, './window': {},
    '../i18n': { default: current }, '../system/language.mjs': language
  }, { localStorage: saved }).default;
  let errors = 0;
  const label = () => ({ setColor() {}, setShadowColor() {} });
  const handler = { optionCursors: [0], optionValueLabels: [[label(), label()]],
    getUi: () => ({ playError: () => errors++ }),
    scene: { gameData: { saveSetting() { assert.fail('language must not write game settings or saves'); } } }
  };
  assert.equal(Handler.prototype.setOptionCursor.call(handler, 0, 1, true), true);
  assert.equal(saved.value, 'en');
  assert.equal(current.language, 'zh-Hans');
  assert.equal(initialize(saved).t('menu:newGame'), 'New Game');
  saved.setItem = () => { throw Error('storage full'); };
  assert.equal(Handler.prototype.setOptionCursor.call(handler, 0, 0, true), false);
  assert.equal(handler.optionCursors[0], 1);
  assert.equal(errors, 1);
});

test('catalog localization keeps implementation markers and early descriptions when upstream mechanics differ', () => {
  const i18n = initialize(storage(null));
  const { catalogName, catalogDescription } = loadTs('src/system/localized-catalog.ts', { '../i18n': { default: i18n },'./presentation-text.mjs':presentationText });
  assert.equal(catalogName('move', 'TACKLE', 'Tackle (P)'), '撞击 (P)');
  assert.equal(catalogName('pokemon', 'BULBASAUR', 'Bulbasaur'), '妙蛙种子');
  assert.equal(catalogName('move', 'EARLY_ONLY', 'Early Only (N)'), 'Early Only (N)');
  const old = 'Early-only rule: power is 10, not 20.';
  assert.equal(catalogDescription('move', 'TACKLE', 'effect', old), old);
  const english = i18n.t('move:tackle.effect', { lng: 'en' });
  assert.equal(catalogDescription('move', 'TACKLE', 'effect', english), i18n.t('move:tackle.effect'));
});

test('all literal translation call sites resolve in both bundled languages with complete parameters', () => {
  const i18n = initialize(storage(null));
  let count = 0;
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) { walk(url); continue; }
      if (!entry.name.endsWith('.ts')) continue;
      const source = ts.createSourceFile(url.pathname, fs.readFileSync(url, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = node => {
        if(ts.isCallExpression(node)&&node.expression.getText(source)==='getLocalizedPokemonMessage'&&ts.isStringLiteralLike(node.arguments[1])){
          const key=node.arguments[1].text,args={pokemonNameWithAffix:'name',pokemonName:'name'};
          let values=node.arguments[2]?.body;
          if(values&&ts.isParenthesizedExpression(values))values=values.expression;
          if(values&&ts.isObjectLiteralExpression(values))for(const property of values.properties)args[property.name?.getText(source)]='value';
          for(const lng of ['en','zh-Hans']){
            assert.ok(i18n.exists(key,{lng,fallbackLng:false}),`${url.pathname}: missing ${lng} ${key}`);
            assert.doesNotMatch(i18n.t(key,{...args,lng}),/\{\{[^}]+\}\}/,`${url.pathname}: incomplete ${lng} ${key}`);
          }
          count++;
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && node.expression.expression.getText(source) === 'i18next' && node.expression.name.text === 't'
          && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
          const key = node.arguments[0].text;
          const args = {};
          if (node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) {
            for (const property of node.arguments[1].properties) args[property.name?.getText(source)] = 'value';
          }
          for (const lng of ['en', 'zh-Hans']) {
            assert.ok(i18n.exists(key, { lng, fallbackLng: false }), `${url.pathname}: missing ${lng} ${key}`);
            assert.doesNotMatch(i18n.t(key, { ...args, lng }), /\{\{[^}]+\}\}/, `${url.pathname}: incomplete ${lng} ${key}`);
          }
          count++;
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  };
  walk(new URL('src/', root));
  assert.ok(count >= 100);
});
