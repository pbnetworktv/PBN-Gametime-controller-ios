import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from 'node:fs/promises';
import { controllerDeckStyle,raceToComplete,applyMatchTerms,useTeamTimeout } from "../src/controller-rules.js";
test("a later scheduled match never converts an explicit single-deck event to split deck", () => {
  assert.equal(controllerDeckStyle("SINGLE", true), "single");
  assert.equal(controllerDeckStyle("Single", true), "single");
  assert.equal(controllerDeckStyle("Single-deck", true), "single");
  assert.equal(controllerDeckStyle("SPLIT", true), "split");
  assert.equal(controllerDeckStyle("SPLIT", false), "single");
  assert.equal(controllerDeckStyle("", true), "split");
});
test("race-to finishes only after a decisive target score", () => {
  assert.equal(raceToComplete({ leftScore: 2, rightScore: 1 }, "Race-to", "3", "single"), false);
  assert.equal(raceToComplete({ leftScore: 3, rightScore: 1 }, "Race-to", "3", "single"), true);
  assert.equal(raceToComplete({ leftScore: 2, rightScore: 3 }, "race-to", 3, "single"), true);
  assert.equal(raceToComplete({ leftScore: 3, rightScore: 3 }, "race-to", 3, "single"), false);
  assert.equal(raceToComplete({ leftScore: 9, rightScore: 1 }, "uncapped", 3, "single"), false);
  assert.equal(raceToComplete({ leftScore: 3, rightScore: 1 }, "race-to", 3, "split"), false);
});
test('agreed timing applies once and timeout allowance follows the team after ends swap',()=>{
 const original={phase:'READY',activeMatch:{leftPhysicalTeamId:'alpha',rightPhysicalTeamId:'bravo'},gameMs:600000};
 const terms={mode:'TIMED',matchMinutes:12,breakSeconds:90,timeoutsPerTeam:1,timeoutSeconds:60};
 const configured=applyMatchTerms(original,terms);
 assert.equal(configured.gameMs,720000);assert.equal(configured.breakDefaultMs,90000);assert.equal(original.gameMs,600000);
 const called=useTeamTimeout(configured,terms,'left',90000);assert.equal(called.breakMs,150000);assert.equal(called.timeoutsUsed.alpha,1);
 called.activeMatch.leftPhysicalTeamId='bravo';called.activeMatch.rightPhysicalTeamId='alpha';
 assert.throws(()=>useTeamTimeout(called,terms,'right',150000),/no timeouts/);
 called.phase='POINT_LIVE';assert.throws(()=>useTeamTimeout(called,terms,'left',150000),/between points/);
});
test('remote event workspace sends its agreed revision and initializes the agreed rules',async()=>{
 const app=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
 assert.match(app,/agreementRevision: state\.event\?\.agreementRevision/);
 assert.match(app,/state\.controller = applyMatchTerms\(c,state\.event\.matchTerms\)/);
});
