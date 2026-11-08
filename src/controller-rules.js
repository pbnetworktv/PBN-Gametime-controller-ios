export function raceToComplete(match, format, pointLimit, deckStyle) {
  const limit = Number(pointLimit);
  return String(format).toLowerCase() === "race-to" && deckStyle !== "split" && Number.isInteger(limit) && limit > 0 && limit <= 7 && Math.max(match.leftScore, match.rightScore) >= limit && match.leftScore !== match.rightScore;
}

export function applyMatchTerms(controller,terms){
 if(!terms)return controller;
 const next=structuredClone(controller),gameMs=terms.mode==='TIMED'?terms.matchMinutes*60000:43200000;
 next.gameMs=gameMs;next.breakMs=terms.breakSeconds*1000;next.breakDefaultMs=next.breakMs;next.timeoutsUsed={};
 if(next.activeMatch)next.activeMatch.gameMs=gameMs;if(next.inactiveMatch)next.inactiveMatch.gameMs=gameMs;
 return next;
}
export function useTeamTimeout(controller,terms,side,remaining){
 if(!terms||!['READY','BREAK_RUNNING','BREAK_PAUSED'].includes(controller.phase))throw new Error('Timeouts can be called between points.');
 const teamId=side==='left'?controller.activeMatch.leftPhysicalTeamId:controller.activeMatch.rightPhysicalTeamId;
 const used=controller.timeoutsUsed?.[teamId]||0;if(used>=terms.timeoutsPerTeam)throw new Error('This team has no timeouts remaining.');
 const next=structuredClone(controller);next.timeoutsUsed={...next.timeoutsUsed,[teamId]:used+1};next.breakMs=remaining+terms.timeoutSeconds*1000;return next;
}
