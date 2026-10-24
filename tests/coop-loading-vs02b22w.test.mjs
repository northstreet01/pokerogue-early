import test from'node:test';import assert from'node:assert/strict';import{JSDOM}from'jsdom';import{beginLoading}from'../src/coop/loading-screen.mjs';import{EventEmitter}from'node:events';
test('remote loading stays covered until completion and reports progress with stale-generation protection',()=>{
 const doc=new JSDOM('<body></body>').window.document,loader=new EventEmitter();const first=beginLoading('初始界面',loader,doc);
 loader.emit('progress',0.4);assert.match(doc.body.textContent,/40%/);assert.equal(doc.getElementById('game-loading').hidden,false);
 const second=beginLoading('首战',loader,doc);first.complete();assert.equal(doc.getElementById('game-loading').hidden,false);assert.match(doc.body.textContent,/首战/);
 second.complete();assert.equal(doc.getElementById('game-loading').hidden,true);assert.equal(loader.listenerCount('progress'),0);
});
test('failed resources keep an actionable error above the canvas; subsequent retry removes it',()=>{
 const doc=new JSDOM('<body></body>').window.document,loader=new EventEmitter();const load=beginLoading('首战',loader,doc);load.fail('缺少图集');
 assert.match(doc.body.textContent,/缺少图集/);assert.match(doc.querySelector('button').textContent,/保留存档与房间/);
 assert.equal(doc.getElementById('game-loading').hidden,false);assert.equal(loader.listenerCount('progress'),0);
 beginLoading('重试',loader,doc).complete();assert.equal(doc.getElementById('game-loading').hidden,true);
});
