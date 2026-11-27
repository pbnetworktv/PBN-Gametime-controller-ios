// Scheduling is independent of scoring: a race-to tournament can use a round-robin draw.
export function tournamentPairings(teams, eventId, draw = 'ROUND_ROBIN') {
  if (!Array.isArray(teams) || teams.length < 2 || teams.length > 64 || teams.some(t => typeof t !== 'string' || !t.trim() || t.length > 80) || new Set(teams.map(t => t.trim().toLowerCase())).size !== teams.length) throw Error('Enter 2–64 different team names.');
  const pairs = [];
  for (let a = 0; a < teams.length; a++) for (let b = a + 1; b < teams.length; b++) {
    if (draw === 'OPENING_ROUND' && (a % 2 || b !== a + 1)) continue;
    pairs.push({ id: `${eventId}-match-${pairs.length + 1}`, eventId, left: teams[a], right: teams[b] });
  }
  if (!['ROUND_ROBIN', 'OPENING_ROUND'].includes(draw)) throw Error('Choose a supported draw.');
  if (draw === 'OPENING_ROUND' && teams.length % 2) throw Error('Opening pairs need an even team count. Use round robin for an odd team count.');
  if (pairs.length > 500) throw Error('This draw exceeds 500 matches. Split the teams into smaller divisions.');
  return pairs;
}

export function scheduleTournament({ pairs, fields, startDate, days = 1, start = '09:00', slotMinutes = 20, restSlots = 1, breakAt = '', breakMinutes = 30 }) {
  if (!Array.isArray(pairs) || !pairs.length || pairs.length > 500 || pairs.some(p => !p.id || !p.left || !p.right || p.left === p.right) || new Set(pairs.map(p => p.id)).size !== pairs.length) throw Error('Add valid match pairings first.');
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > 32 || fields.some(f => !f.id || !f.name) || new Set(fields.map(f => f.id)).size !== fields.length) throw Error('Choose 1–32 different playing fields.');
  if (!Number.isInteger(days) || days < 1 || days > 31 || !Number.isInteger(slotMinutes) || slotMinutes < 1 || slotMinutes > 180 || !Number.isInteger(restSlots) || restSlots < 0 || restSlots > 10) throw Error('Choose valid match timing and rest settings.');
  const clock = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;
  const first = clock(start), pause = breakAt ? clock(breakAt) : null, date = Date.parse(startDate + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== startDate || !Number.isFinite(first) || pause !== null && (!Number.isFinite(pause) || !Number.isInteger(breakMinutes) || breakMinutes < 1 || breakMinutes > 180)) throw Error('Choose a valid event date, start time and break.');
  const pending = pairs.map(p => ({ ...p })), result = [], lastEnd = new Map();
  for (let day = 0; day < days && pending.length; day++) {
    for (let minute = first; minute + slotMinutes <= 1440 && pending.length; minute += slotMinutes) {
      if (pause !== null && minute < pause + breakMinutes && minute + slotMinutes > pause) continue;
      const absolute = day * 1440 + minute;
      for (const field of fields) {
        const index = pending.findIndex(p => [p.left, p.right].every(team => !lastEnd.has(team) || absolute >= lastEnd.get(team) + restSlots * slotMinutes));
        if (index < 0) break;
        const [match] = pending.splice(index, 1);
        for (const team of [match.left, match.right]) lastEnd.set(team, absolute + slotMinutes);
        result.push({ ...match, fieldId: field.id, field: field.name, date: new Date(date + day * 86400000).toISOString().slice(0, 10), time: `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`, status: result.length ? 'Scheduled' : 'On deck' });
      }
    }
  }
  if (pending.length) throw Error(`${pending.length} matches do not fit. Add event days or fields, reduce rest, or shorten the match slots.`);
  return result;
}
