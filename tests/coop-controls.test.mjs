import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire, isBuiltin } from 'node:module';
import { resolve } from 'node:path';
import { build } from 'vite';

let api;
before(async () => {
  await build({ configFile: false, publicDir: false, logLevel: 'error',
    resolve: { alias: [
      { find: /^phaser$/, replacement: resolve('server/headless-presentation.mjs') },
      { find: /^phaser3-rex-plugins\/.*$/, replacement: resolve('server/headless-rex.mjs') },
    ] }, ssr: { noExternal: true }, build: { ssr: resolve('tests/fixtures/coop-play-ui-entry.mjs'),
      outDir: resolve('build/coop-controls-test'), emptyOutDir: true, minify: false,
      rollupOptions: { external: isBuiltin, output: { format: 'cjs', entryFileNames: 'entry.cjs' } } } });
  api = createRequire(import.meta.url)('../build/coop-controls-test/entry.cjs');
});

test('real keyboard setup routes Enter to confirmation, Escape to cancellation, and C to team completion', () => {
  // Execute the actual setup method against a keyboard port; no browser Phaser
  // renderer is available in Node. The dispatch below uses the full scene code.
  const source = ts.createSourceFile('battle-scene.ts', readFileSync('src/battle-scene.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'BattleScene');
  const method = cls.members.find(n => n.name?.getText(source) === 'setupControls');
  const context = { Button: api.Button, Phaser: { Input: { Keyboard: { KeyCodes: new Proxy({}, { get: (_o, key) => key }) } } },
    Utils: { getEnumValues: value => Object.values(value).filter(v => typeof v === 'number') }, initTouchControls() { return () => {}; } };
  vm.runInNewContext(ts.transpileModule(`class Controls { ${method.getText(source)} }; globalThis.Controls = Controls;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const scene = Object.create(api.BattleScene.prototype), sent = [];
  scene.events = new EventEmitter();
  scene.input = { keyboard: { addKey: code => ({ code }) } };
  scene.ui = { processInput: button => { sent.push(button); return true; } };
  scene.time = { delayedCall: (_delay, callback) => { scene.unlock = callback; } };
  context.Controls.prototype.setupControls.call(scene);
  for (const [key, expected] of [['W', 'UP'], ['S', 'DOWN'], ['A', 'LEFT'], ['D', 'RIGHT'],
    ['ENTER', 'ACTION'], ['ESC', 'CANCEL'], ['C', 'SUBMIT']]) {
    scene.isButtonPressed = button => scene.buttonKeys[button].some(k => k.code === key);
    scene.checkInput();
    assert.equal(sent.at(-1), api.Button[expected], key);
    scene.unlock();
  }
  assert.equal(scene.buttonKeys[api.Button.MENU].some(k => k.code === 'ESC'), false);
});

test('typing in a lobby text field does not also move or confirm the underlying game', () => {
  const previous = globalThis.document;
  globalThis.document = { activeElement: { matches: () => true } };
  try {
    const scene = Object.create(api.BattleScene.prototype);
    scene.isButtonPressed = () => assert.fail('focused text input must not reach game keys');
    assert.equal(scene.checkInput(), false);
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

function pointerScene() {
  const scene = Object.create(api.BattleScene.prototype), inputs = [], timers = [];
  const handler = new api.UiHandler(scene, api.Mode.COMMAND);
  handler.active = true;
  const ui = Object.assign(Object.create(api.UI.prototype), {
    scene, getHandler: () => handler, processInput: button => { inputs.push(button); return true; }
  });
  scene.ui = ui;
  scene.time = { delayedCall: (_delay, callback) => timers.push(callback) };
  const target = new EventEmitter();
  target.setInteractive = () => target;
  const click = () => target.emit('pointerup', { button: 0 }, 1, 2, { stopPropagation() {} });
  return { scene, ui, handler, target, click, inputs, timers };
}

test('mouse activation uses the original input path once and respects overlay, active menu and input cooldown', () => {
  const s = pointerScene(); let selections = 0;
  s.handler.bindPointer(s.target, () => { selections++; });
  s.click(); s.click();
  assert.deepEqual(s.inputs, [api.Button.ACTION]); assert.equal(selections, 1);
  s.timers.shift()();
  s.ui.overlayActive = true; s.click(); assert.equal(selections, 1);
  s.ui.overlayActive = false; s.handler.clear(); s.click(); assert.equal(selections, 1);
  s.handler.active = true; s.ui.getHandler = () => ({}); s.click(); assert.equal(selections, 1);
});

test('rebinding the same display target replaces old callbacks and a rejected selection never confirms', () => {
  const s = pointerScene();
  s.handler.bindPointer(s.target, () => assert.fail('old target callback survived'));
  s.handler.bindPointer(s.target, () => false);
  assert.equal(s.target.listenerCount('pointerup'), 1);
  s.click(); assert.equal(s.inputs.length, 0);
});

test('clicking the original POKEMON command reaches the cooperative port without local Party execution', () => {
  const s = pointerScene();
  const command = new api.CommandUiHandler(s.scene);
  command.active = true;
  command.setCursor = cursor => { command.cursor = cursor; return true; };
  s.ui.getHandler = () => command;
  s.ui.processInput = button => command.processInput(button);
  let selected;
  s.scene.getCurrentPhase = () => ({ interceptCommand: cursor => { selected = cursor; return true; } });
  command.bindPointer(s.target, () => { command.setCursor(2); });
  s.click();
  assert.equal(selected, 2);
});
