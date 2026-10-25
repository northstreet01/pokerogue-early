import{createOriginalRuleHost}from'../../server/original-rule-host.mjs';
const clone=x=>JSON.parse(JSON.stringify(x));
export async function forcedCommandFixture(api,queues, moves={}){const h=await createOriginalRuleHost({seed:'vs02b09-capture',identity:{trainerId:1,secretId:2}});try{
 const c=(await h.request('native-open-to-input',{parties:[[1,4,7],[906,909,912]],eggState:{players:[[],[]]}})).checkpoint;
 c.decision={id:'queued-fixture',kind:'continuing',requiredSeats:[],reason:'effects'};
 c.continuation.phaseQueue=[{kind:'original-phase',phaseId:10000,remaining:'start',phase:{version:1,type:'TurnInitPhase',scope:null,fields:{},presentation:{}}}];
 c.continuation.phaseQueuePrepend=[];c.continuation.nextCommandPhaseQueue=[];c.battle.turnCommands={'0':null,'1':null,'2':null,'3':null,'-1':null};
 for(const e of c.roster.entries.filter(e=>e.owner===null)){const m=clone(e.pokemon.fields.moveset[0]);m.fields.moveId=150;m.fields.ppUsed=0;e.pokemon.fields.moveset=[m];}
 for(const seat of[0,1]){const entry=c.roster.entries.find(e=>e.owner===seat&&e.index===0),pokemon=api.restorePokemonState(entry.pokemon);if(moves[seat]){pokemon.getMoveset()[0].moveId=moves[seat];pokemon.getMoveset()[0].ppUsed=1;pokemon.moveset=[pokemon.getMoveset()[0]];}pokemon.getMoveQueue().splice(0,Infinity,...clone(queues[seat]??[]));entry.pokemon=api.capturePokemonState(pokemon);}
 await h.request('native-validate-checkpoint',c);return{h,c};}catch(e){await h.close();throw e;}}
