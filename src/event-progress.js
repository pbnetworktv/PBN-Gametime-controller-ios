function completedMatches(controller) {
  const records = { ...controller.completedMatches || {} };
  for (const match of [controller.activeMatch, controller.inactiveMatch]) {
    if (!match) continue;
    if (match.complete) records[match.id] = { ...match };
    else delete records[match.id];
  }
  return records;
}
function nextEventMatch(schedule, controller) {
  const complete = completedMatches(controller);
  return schedule.find((match) => !complete[match.id]) || null;
}
function eventStandings(teams, controller) {
  const rows = new Map(teams.map((team) => [team, { team, w: 0, l: 0, d: 0, diff: 0 }]));
  for (const match of Object.values(completedMatches(controller))) {
    for (const [name, own, other] of [[match.leftTeam, match.leftScore, match.rightScore], [match.rightTeam, match.rightScore, match.leftScore]]) {
      const row = rows.get(name);
      if (!row) continue;
      row.diff += own - other;
      if (own > other) row.w++;
      else if (own < other) row.l++;
      else row.d++;
    }
  }
  return [...rows.values()].sort((a, b) => b.w - a.w || b.diff - a.diff || a.team.localeCompare(b.team));
}

export { completedMatches, nextEventMatch, eventStandings };
