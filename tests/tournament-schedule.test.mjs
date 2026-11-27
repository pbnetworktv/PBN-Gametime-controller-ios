import test from 'node:test';
import assert from 'node:assert/strict';
import { tournamentPairings, scheduleTournament } from '../src/tournament-schedule.js';
const teams = ['A', 'B', 'C', 'D', 'E'];
const fields = [{ id: 'f1', name: 'Field 1' }, { id: 'f2', name: 'Field 2' }];
test('round robin schedules every pair with field capacity, rest and a daily break', () => {
  const pairs = tournamentPairings(teams, 'event'), rows = scheduleTournament({ pairs, fields, startDate: '2030-06-05', start: '09:00', slotMinutes: 20, restSlots: 1, breakAt: '10:00', breakMinutes: 30 });
  assert.equal(pairs.length, 10);assert.equal(rows.length, 10);
  const occupied = new Set(), last = new Map();
  for (const row of rows) {
    const time = Number(row.time.slice(0,2))*60+Number(row.time.slice(3));
    assert.ok(time+20<=600 || time>=630);
    assert.ok(!occupied.has(row.fieldId+row.time));occupied.add(row.fieldId+row.time);
    for (const team of [row.left,row.right]) { if(last.has(team)) assert.ok(time-last.get(team)>=40);last.set(team,time); }
  }
  assert.deepEqual(pairs.map(p=>Object.keys(p).sort()), Array.from({length:10},()=>['eventId','id','left','right']));
});
test('overflow fails without changing pairings; more days carry dates without midnight wrap', () => {
  const pairs=tournamentPairings(['A','B','C','D'],'event'), before=structuredClone(pairs);
  const config={pairs,fields:[fields[0]],startDate:'2030-06-05',start:'23:00',slotMinutes:30,restSlots:0};
  assert.throws(()=>scheduleTournament(config),/do not fit/);assert.deepEqual(pairs,before);
  const rows=scheduleTournament({...config,days:3});assert.equal(rows.length,6);assert.equal(rows.at(-1).date,'2030-06-07');
});
test('opening pairs, duplicate teams and unsupported dates are checked',()=>{
  assert.equal(tournamentPairings(['A','B','C','D'],'event','OPENING_ROUND').length,2);
  assert.throws(()=>tournamentPairings(['A','a'],'event'));
  assert.throws(()=>tournamentPairings(teams,'event','OPENING_ROUND'));
  assert.throws(()=>scheduleTournament({pairs:tournamentPairings(['A','B'],'e'),fields,startDate:'2030-02-30'}));
});
