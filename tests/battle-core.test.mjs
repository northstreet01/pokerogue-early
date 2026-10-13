import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { RandomDataGenerator, nextBattleRandomInt, shiftSeed, withSeedOffset } from '../src/battle-core/random.mjs';
import { ruleSeedOffset } from '../src/battle-core/random-context.mjs';
import { getWildLevel, getMaxExpLevel, gaussianLevelOffset } from '../src/battle-core/levels.mjs';
import { getCaptureThreshold, advanceCaptureCheck } from '../src/battle-core/capture.mjs';

// This oracle is frozen source from the committed early baseline, not the new helpers.
const { fragments: original } = JSON.parse(fs.readFileSync(new URL('./fixtures/early-battle-reference.json',import.meta.url),'utf8'));
function reference(random, fragments = original) {
  const exports = {};
  const source = `${original.shift}\n${original.randSeedInt}\n
    const Utils = {shiftCharCodes,randSeedInt,getSceneRandom:()=>Phaser.Math.RND};
    class Reference { ${fragments.battleRand}\n${fragments.level}\n${fragments.gauss}\n${fragments.levelCap}\n${fragments.seedScope} }
    exports.Reference = Reference;
    exports.threshold = (maxHp,hp,rate,ball,status) => {
      const pokemon = {getMaxHp:()=>maxHp,hp,species:{catchRate:rate},status:status===1 ? null : {effect:status}};
      const getPokeballCatchMultiplier = ()=>ball;
      const getStatusEffectCatchRateMultiplier = ()=>status;
      return (function(){${fragments.captureThreshold};return y;}).call({pokeballType:0});
    };
    exports.capture = (count,obtainable,ball,threshold,randomInt) => {
      let shakeCount=count, outcome;
      const pokemon={species:{isObtainable:()=>obtainable},randSeedInt:randomInt};
      const pokeballMultiplier=ball, y=threshold, shakeCounter={stop(){}};
      const addPokeballCaptureStars=()=>{};
      const phase={pokeball:{},failCatch(){outcome='failed';},scene:{
        playSound(name){outcome=name==='pb_move' ? 'shake' : 'caught';},
        add:{sprite(){return {setOrigin(){},setTintFill(){},setAlpha(){}};}},field:{add(){}},tweens:{add(){}}
      }};
      const repeat=(function(){return ${fragments.captureRepeat};}).call(phase);
      repeat(); return {outcome,shakeCount};
    };`;
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
    {exports,Phaser:{Math:{RND:random}},BattleSpec:{FINAL_BOSS:1},nextBattleRandomInt,getWildLevel,gaussianLevelOffset,
      calculateMaxExpLevel:getMaxExpLevel,withSeedOffset,ruleSeedOffset,getCaptureThreshold,advanceCaptureCheck});
  return exports;
}

test('battle integers and saved RNG state match original code across turns and boundary ranges', () => {
  for (const seed of ['early','妙蛙种子','\uffff\u0000','']) {
    const ambient = new RandomDataGenerator(['unrelated UI stream']);
    const oracle = reference(ambient);
    const battle = new oracle.Reference(); battle.battleSeed=seed;
    for (const turn of [0,1,2,99,65536]) {
      battle.turn=turn; battle.battleSeedState=null;
      let state=null;
      for (let i=0;i<80;i++) {
        const range=[0,1,2,24,100,65536,4294967295][i%7], min=i%3-1;
        const before=ambient.state();
        const expected=battle.randSeedInt(range,min);
        const result=nextBattleRandomInt(seed,turn,state,range,min);
        assert.equal(result.value,expected);
        assert.equal(result.state,battle.battleSeedState);
        assert.equal(ambient.state(),before);
        state=result.state;
      }
    }
  }
});

test('two room streams stay isolated when interleaved and resume exactly from JSON checkpoints', () => {
  const streams=[{seed:'room A',turn:4,state:null},{seed:'room B',turn:9,state:null}];
  const isolated=streams.map(stream=>{
    let state=null;
    return Array.from({length:100},()=>{const r=nextBattleRandomInt(stream.seed,stream.turn,state,1000);state=r.state;return r.value;});
  });
  for(let i=0;i<100;i++) for(const room of [1,0]) {
    const stream=streams[room], result=nextBattleRandomInt(stream.seed,stream.turn,stream.state,1000);
    assert.equal(result.value,isolated[room][i]); stream.state=JSON.parse(JSON.stringify(result.state));
  }
});

test('wild levels and random consumption match early normal, daily, boss and milestone waves', () => {
  for(const seed of ['level A','level B']) for(const mode of ['classic','endless','daily']) {
    const oldRandom=new RandomDataGenerator([seed]), newRandom=new RandomDataGenerator([seed]);
    const {Reference}=reference(oldRandom), battle=new Reference();
    battle.gameMode={getWaveForDifficulty:w=>mode==='daily'?w+30+Math.floor(w/5):w,
      isWaveFinal:w=>mode==='classic'?w===200:mode==='daily'?w===50:w%250===0};
    for(let wave=1;wave<=1000;wave++) {
      battle.waveIndex=wave; battle.battleSpec=mode==='classic'&&wave===200?1:0;
      const level=getWildLevel(wave,battle.gameMode.getWaveForDifficulty(wave),battle.battleSpec===1,
        ()=>battle.gameMode.isWaveFinal(wave),newRandom);
      assert.equal(level,battle.getLevelForWave(),`${mode} wave ${wave}`);
      assert.equal(newRandom.state(),oldRandom.state(),`random consumption ${mode} wave ${wave}`);
    }
  }
});

test('level cap retains original ten-wave rounding and daily difficulty curve without a fixed level-10 cap', () => {
  const {Reference}=reference(new RandomDataGenerator(['cap'])), scene=new Reference();
  for(const daily of [false,true]) {
    scene.gameMode={getWaveForDifficulty:w=>daily?w+30+Math.floor(w/5):w};
    for(let wave=0;wave<=1000;wave++) {
      scene.currentBattle=wave?{waveIndex:wave}:null;
      const difficulty=scene.gameMode.getWaveForDifficulty(Math.ceil((wave||1)/10)*10);
      assert.equal(getMaxExpLevel(difficulty),scene.getMaxExpLevel());
      assert.equal(getMaxExpLevel(difficulty,true),scene.getMaxExpLevel(true));
    }
  }
});

test('capture threshold matches early rounding for HP, catch rates, ball and status multipliers', () => {
  const oracle=reference(new RandomDataGenerator(['capture']));
  for(const maxHp of [1,19,100,333,9999]) for(const hp of [1,Math.ceil(maxHp/2),maxHp])
    for(const rate of [0,3,25,45,127,255]) for(const ball of [1,1.5,2,3,-1]) for(const status of [1,1.5,2.5])
      assert.ok(Object.is(getCaptureThreshold(maxHp,hp,rate,ball,status),oracle.threshold(maxHp,hp,rate,ball,status)));
});

test('capture decisions match original animation callback, including exact RNG draw count', () => {
  const oracle=reference(new RandomDataGenerator(['unused']));
  for(const obtainable of [true,false]) for(const ball of [1,1.5,2,3,-1]) for(const threshold of [0,1,30000,65535,65536,NaN])
    for(const seed of ['capture A','capture B','capture C']) {
      const oldRandom=new RandomDataGenerator([seed]), newRandom=new RandomDataGenerator([seed]);
      let count=0,oldDraws=0,newDraws=0;
      for(let repeat=0;repeat<4;repeat++) {
        const expected=oracle.capture(count,obtainable,ball,threshold,limit=>{oldDraws++;return oldRandom.integerInRange(0,limit-1);});
        const actual=advanceCaptureCheck(count,obtainable,ball,threshold,limit=>{newDraws++;return newRandom.integerInRange(0,limit-1);});
        assert.equal(actual.outcome,expected.outcome);assert.equal(actual.shakeCount,expected.shakeCount);
        assert.equal(newDraws,oldDraws);assert.equal(newRandom.state(),oldRandom.state());count=actual.shakeCount;
        if(actual.outcome!=='shake')break;
      }
      assert.ok(newDraws<=3);
      if(ball===-1||!obtainable)assert.equal(newDraws,0);
    }
});

test('capture locks after three checks; boundary failures keep the original shake count', () => {
  let draws=0,count=0;
  for(let i=0;i<3;i++) {
    const result=advanceCaptureCheck(count,true,1,65536,()=>{draws++;return 1;});
    assert.equal(result.outcome,'shake');count=result.shakeCount;
  }
  assert.deepEqual(advanceCaptureCheck(count,true,1,65536,()=>{throw new Error('unexpected fourth draw');}),{outcome:'caught',shakeCount:4});
  assert.equal(draws,3);
  assert.deepEqual(advanceCaptureCheck(1,true,1,30000,()=>30000),{outcome:'failed',shakeCount:2});
});

test('seed scopes match original successful calls, nest safely, and restore after exceptions', () => {
  const oldRandom=new RandomDataGenerator(['outside']),newRandom=new RandomDataGenerator(['outside']);
  const {Reference,shiftCharCodes}=reference(oldRandom),scene=new Reference();scene.seed='root';
  const expected=[],actual=[];
  scene.executeWithSeedOffset(()=>{expected.push(oldRandom.integer());scene.executeWithSeedOffset(()=>expected.push(oldRandom.integer()),77,'inner');expected.push(oldRandom.integer());},23);
  withSeedOffset(newRandom,'root',23,()=>{actual.push(newRandom.integer());withSeedOffset(newRandom,'inner',77,()=>actual.push(newRandom.integer()));actual.push(newRandom.integer());});
  assert.deepEqual(actual,expected);assert.equal(newRandom.state(),oldRandom.state());
  const before=newRandom.state();
  assert.throws(()=>withSeedOffset(newRandom,'broken',99,()=>{newRandom.integer();throw new Error('callback failed');}),/callback failed/);
  assert.equal(newRandom.state(),before);
  for(const offset of [-999,0,1,65535,65536]) assert.equal(shiftSeed('种子\uffff',offset),shiftCharCodes('种子\uffff',offset));
});

test('shared rule modules execute in bare Node without DOM, Phaser global, clock or unseeded randomness', () => {
  const randomUrl=new URL('../src/battle-core/random.mjs',import.meta.url).href;
  const captureUrl=new URL('../src/battle-core/capture.mjs',import.meta.url).href;
  const result=spawnSync(process.execPath,['--input-type=module','-e',`
    Math.random=()=>{throw new Error('unseeded randomness');};Date.now=()=>{throw new Error('clock access');};
    const {nextBattleRandomInt}=await import(${JSON.stringify(randomUrl)});
    const {getCaptureThreshold}=await import(${JSON.stringify(captureUrl)});
    if(globalThis.window||globalThis.document||globalThis.Phaser)throw new Error('browser dependency');
    const result=nextBattleRandomInt('server-room',1,null,100);
    if(!Number.isInteger(result.value)||!result.state.startsWith('!rnd,')||!Number.isFinite(getCaptureThreshold(20,1,45,1,1)))throw new Error('invalid result');
  `],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});

test('actual refactored game methods and capture callback remain wired to equivalent original behavior', () => {
  function sourceMember(file, cls, name) {
    const text=fs.readFileSync(new URL(`../src/${file}`,import.meta.url),'utf8');
    const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
    return source.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text===cls).members.find(n=>n.name?.getText()===name);
  }
  const capture=sourceMember('phases.ts','AttemptCapturePhase','start');
  const declarations=capture.body.statements.filter(ts.isVariableStatement);
  const from=declarations.findIndex(n=>n.declarationList.declarations[0].name.getText()==='catchRate');
  const to=declarations.findIndex(n=>n.declarationList.declarations[0].name.getText()==='y');
  let repeat;
  function visit(n){if(ts.isPropertyAssignment(n)&&n.name.getText()==='onRepeat'&&n.initializer.getText().includes('advanceCaptureCheck'))repeat=n.initializer.getText();ts.forEachChild(n,visit);}
  visit(capture);assert.ok(repeat,'original capture phase must use the shared capture check');
  const fragments={...original,
    battleRand:sourceMember('battle.ts','Battle','randSeedInt').getText(),
    level:sourceMember('battle.ts','Battle','getLevelForWave').getText(),
    gauss:sourceMember('battle.ts','Battle','randSeedGaussForLevel').getText(),
    levelCap:sourceMember('battle-scene.ts','BattleScene','getMaxExpLevel').getText(),
    seedScope:sourceMember('battle-scene.ts','BattleScene','executeWithSeedOffset').getText(),
    captureThreshold:declarations.slice(from,to+1).map(n=>n.getText()).join('\n'),captureRepeat:repeat};
  const oldRandom=new RandomDataGenerator(['adapter']),newRandom=new RandomDataGenerator(['adapter']);
  const old=reference(oldRandom),current=reference(newRandom,fragments);
  const a=new old.Reference(),b=new current.Reference();
  for(const battle of [a,b])Object.assign(battle,{seed:'adapter',battleSeed:'battle',turn:1,battleSeedState:null,
    gameMode:{getWaveForDifficulty:w=>w,isWaveFinal:w=>w===200}});
  for(const wave of [1,9,10,200,250,999]) {
    a.waveIndex=b.waveIndex=wave;a.battleSpec=b.battleSpec=wave===200?1:0;
    a.currentBattle=b.currentBattle={waveIndex:wave};
    assert.equal(b.getLevelForWave(),a.getLevelForWave());assert.equal(newRandom.state(),oldRandom.state());
    assert.equal(b.getMaxExpLevel(),a.getMaxExpLevel());
    for(let i=0;i<20;i++){assert.equal(b.randSeedInt(65536),a.randSeedInt(65536));assert.equal(b.battleSeedState,a.battleSeedState);}
  }
  assert.equal(current.threshold(31,1,45,1.5,2.5),old.threshold(31,1,45,1.5,2.5));
  for(const obtainable of [true,false])for(const ball of [1,-1])for(let count=0;count<4;count++) {
    const expected=old.capture(count,obtainable,ball,40000,limit=>oldRandom.integerInRange(0,limit-1));
    const actual=current.capture(count,obtainable,ball,40000,limit=>newRandom.integerInRange(0,limit-1));
    assert.equal(actual.outcome,expected.outcome);assert.equal(actual.shakeCount,expected.shakeCount);
    assert.equal(newRandom.state(),oldRandom.state());
  }
});
