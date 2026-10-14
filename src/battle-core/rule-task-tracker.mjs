// Runtime only: one tracker per trusted candidate scene, never checkpoint data.
// Ordinary single-player scenes have no tracker and keep original promises.
const trackers=new WeakMap();
export function observeRulePromise(scene,promise){
  return trackers.get(scene)?.observe(promise)??promise;
}
export function createRuleTaskTracker(scene){
  if(trackers.has(scene))throw Error('RULE_TASK_TRACKER_ALREADY_BOUND');
  const pending=new Set(),errors=[];
  const tracker={
    observe(p){
      if(!p?.then)return p;
      // A failed rule remains an execution failure even where the original
      // dispatcher settles all attributes. Let its local callback chain finish
      // on the isolated candidate; drain rejects before it can be committed.
      const observed=Promise.resolve(p).catch(error=>{errors.push(error);return undefined;});
      pending.add(observed);observed.then(()=>pending.delete(observed));return observed;
    },
    add(p){return this.observe(p);},
    get pendingTasks(){return pending.size;},
    async drain(){
      do{await Promise.allSettled([...pending]);await Promise.resolve();}while(pending.size);
      if(errors.length)throw errors[0];
    },
    close(){if(trackers.get(scene)===tracker)trackers.delete(scene);}
  };
  trackers.set(scene,tracker);return tracker;
}
