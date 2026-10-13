// Original CommandPhase queue preparation. This mutates the queue by removing
// unusable heads, so run it on an authoritative candidate BEFORE opening input,
// never from a read-only network validator. Valid heads remain until execution.
export function prepareQueuedFight(pokemon) {
  const queue = pokemon.getMoveQueue();
  while (queue.length && queue[0] && queue[0].move
    && (!pokemon.getMoveset().find(m => m.moveId === queue[0].move)
      || !pokemon.getMoveset()[pokemon.getMoveset().findIndex(m => m.moveId === queue[0].move)].isUsable(pokemon, queue[0].ignorePP))) queue.shift();
  if (!queue.length) return null;
  const queued = queue[0];
  if (!queued.move) return {cursor:-1,args:[false]};
  const index = pokemon.getMoveset().findIndex(m => m.moveId === queued.move);
  if (index > -1 && pokemon.getMoveset()[index].isUsable(pokemon, queued.ignorePP))
    return {cursor:index,args:[queued.ignorePP,{targets:queued.targets,multiple:queued.targets.length > 1}]};
  return null;
}

// Original checkFightOverride selection; no queue edits, PP use or phase calls.
export function selectEncoreFight(pokemon, getEncoreTag) {
  const tag = getEncoreTag(pokemon);
  if (!tag) return null;
  const index = pokemon.getMoveset().findIndex(m => m.moveId === tag.moveId);
  if (index === -1 || !pokemon.getMoveset()[index].isUsable(pokemon)) return null;
  return {cursor:index,args:[false]};
}
