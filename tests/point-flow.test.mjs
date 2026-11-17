import assert from "node:assert/strict";
import test from "node:test";
import {
  POINT_TYPES, beginPointDraft, normalizePointDraft, selectPointType,
  adjustPointScore, previewPointScore, commitPointDraft
} from "../src/point-flow.js";

const at = "2026-11-17T13:00:00.000Z";
const completedAt = "2026-11-17T13:00:06.000Z";
function fixture() {
  return {
    phase: "POINT_LIVE", gameMs: 540000, breakMs: 0, breakDefaultMs: 120000,
    activeAnchor: { kind: "game", startedAt: 1000, startingMs: 600000 },
    activeMatch: {
      id: "game-one", leftTeamId: "alpha", rightTeamId: "bravo",
      leftTeam: "Alpha", rightTeam: "Bravo", leftScore: 2, rightScore: 1,
      leftPhysicalTeamId: "alpha", rightPhysicalTeamId: "bravo",
      leftPhysicalTeam: "Alpha", rightPhysicalTeam: "Bravo", gameMs: 540000
    },
    inactiveMatch: { id: "game-two", gameMs: 421000 },
    pointHistory: [], undoStack: [], timeoutsUsed: { alpha: 1 }
  };
}
function stopped(controller = fixture()) {
  return beginPointDraft(controller, 539000, { id: "point-one", at });
}
function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

test("one Base freezes a live or paused game without touching its scores, other match, or break", () => {
  for (const phase of ["POINT_LIVE", "GAME_PAUSED"]) {
    const original = deepFreeze({ ...fixture(), phase });
    const next = stopped(original);
    assert.equal(next.phase, "POINT_STOPPED_WAITING_DECISION");
    assert.equal(next.gameMs, 539000);
    assert.equal(next.activeMatch.gameMs, 539000);
    assert.equal(next.activeAnchor, null);
    assert.equal(next.pointDraft.kind, null);
    assert.equal(next.activeMatch.leftScore, 2);
    assert.equal(next.activeMatch.rightScore, 1);
    assert.deepEqual(next.inactiveMatch, original.inactiveMatch);
    assert.equal(next.breakMs, 0);
    assert.deepEqual(next.timeoutsUsed, original.timeoutsUsed);
    assert.equal(original.activeMatch.gameMs, 540000);
    assert.throws(() => beginPointDraft(next), /Base is available/);
  }
  assert.throws(() => beginPointDraft({ ...fixture(), phase: "BREAK_RUNNING" }), /Base is available/);
  assert.throws(() => beginPointDraft({ ...fixture(), activeMatch: null }), /two assigned teams/);
  assert.equal(beginPointDraft(fixture(), -50).gameMs, 0);
  assert.equal(beginPointDraft(fixture(), Number.NaN).gameMs, 540000);
});

test("approval stages the operator's team selection until one explicit commit", () => {
  const base = deepFreeze(stopped());
  const selected = selectPointType(base, "approve");
  const edited = adjustPointScore(selected, "left", 1);
  assert.equal(base.pointDraft.kind, null);
  assert.equal(edited.phase, "POINT_STOPPED_WAITING_DECISION");
  assert.equal(edited.activeMatch.leftScore, 2);
  assert.equal(previewPointScore(edited, "left"), 3);
  assert.equal(edited.pointHistory.length, 0);
  const result = commitPointDraft(deepFreeze(edited), { at: completedAt });
  assert.equal(result.controller.phase, "POINT_CONFIRMED");
  assert.equal(result.controller.activeMatch.leftScore, 3);
  assert.equal(result.controller.activeMatch.rightScore, 1);
  assert.equal(result.controller.activeMatch.leftPhysicalTeamId, "alpha");
  assert.equal(result.controller.inactiveMatch.id, "game-two");
  assert.equal(result.controller.activeAnchor, null);
  assert.equal(result.controller.pointDraft, null);
  assert.equal(result.voice, "Point approved");
  assert.equal(result.decision.scoringTeamId, "alpha");
  assert.deepEqual(result.decision.adjustments, { alpha: 1, bravo: 0 });
  assert.equal(result.decision.baseline.leftScore, 2);
  assert.equal(result.decision.pointId, "point-one");
  assert.equal(result.decision.matchId, "game-one");
  assert.equal(result.decision.at, completedAt);
  assert.equal(result.controller.pointHistory.length, 1);
});

test("Reverse permits subtract/add corrections and follows stable teams after sides have swapped", () => {
  const current = fixture();
  current.activeMatch.leftPhysicalTeamId = "bravo";
  current.activeMatch.rightPhysicalTeamId = "alpha";
  current.activeMatch.leftPhysicalTeam = "Bravo";
  current.activeMatch.rightPhysicalTeam = "Alpha";
  let draft = selectPointType(stopped(current), "reverse");
  draft = adjustPointScore(draft, "right", -1);
  draft = adjustPointScore(draft, "left", 1);
  assert.equal(previewPointScore(draft, "left"), 2);
  assert.equal(previewPointScore(draft, "right"), 1);
  assert.deepEqual(draft.pointDraft.deltas, { alpha: -1, bravo: 1 });
  const { controller, voice, decision } = commitPointDraft(draft, { at: completedAt });
  assert.equal(controller.activeMatch.leftScore, 1);
  assert.equal(controller.activeMatch.rightScore, 2);
  assert.equal(controller.activeMatch.leftTeam, "Alpha");
  assert.equal(controller.activeMatch.rightTeam, "Bravo");
  assert.equal(controller.pointConfirmation.scoringPhysicalSide, "left");
  assert.equal(decision.scoringTeamId, "bravo");
  assert.equal(voice, "Point reversed");
});

test("changing Approve to Reverse changes the voice, not the manually selected recipient", () => {
  let draft = selectPointType(stopped(), "approve");
  draft = adjustPointScore(draft, "left", 1);
  draft = selectPointType(draft, "reverse");
  const result = commitPointDraft(draft);
  assert.equal(result.controller.activeMatch.leftScore, 3);
  assert.equal(result.controller.activeMatch.rightScore, 1);
  assert.equal(result.voice, "Point reversed");
  assert.equal(result.decision.decision, "reverse");
});

test("No points discards staged edits and records an unchanged-score result without side changes", () => {
  let draft = selectPointType(stopped(), "approve");
  draft = adjustPointScore(draft, "right", 2);
  draft = selectPointType(draft, "none");
  assert.deepEqual(draft.pointDraft.deltas, { alpha: 0, bravo: 0 });
  assert.equal(previewPointScore(draft, "right"), 1);
  assert.throws(() => adjustPointScore(draft, "left", 1), /leaves both scores unchanged/);
  const result = commitPointDraft(draft);
  assert.equal(result.voice, "No points");
  assert.equal(result.controller.activeMatch.leftScore, 2);
  assert.equal(result.controller.activeMatch.rightScore, 1);
  assert.equal(result.controller.activeMatch.leftPhysicalTeamId, "alpha");
  assert.equal(result.controller.pointConfirmation.kind, "none");
  assert.equal(result.controller.pointHistory[0].decision, "no_point");
  assert.equal(result.decision.scoringTeamId, null);
  const changedBack = selectPointType(draft, "approve");
  assert.throws(() => commitPointDraft(changedBack), /Adjust a team score/);
});

test("scores clamp to the persisted 0–1000 range and a clamped no-op is not a scored point", () => {
  const current = fixture();
  current.activeMatch.leftScore = 0;
  current.activeMatch.rightScore = 999;
  let draft = selectPointType(stopped(current), "approve");
  draft = adjustPointScore(draft, "left", -1);
  assert.equal(previewPointScore(draft, "left"), 0);
  assert.throws(() => commitPointDraft(draft), /Adjust a team score/);
  draft = adjustPointScore(draft, "right", 20);
  assert.equal(previewPointScore(draft, "right"), 1000);
  assert.deepEqual(draft.pointDraft.deltas, { alpha: 0, bravo: 1 });
  assert.equal(commitPointDraft(draft).controller.activeMatch.rightScore, 1000);
  let subtract = selectPointType(stopped(), "reverse");
  subtract = adjustPointScore(subtract, "left", -20);
  assert.equal(commitPointDraft(subtract).controller.activeMatch.leftScore, 0);
});

test("a persisted pending point resumes its type and multiple edits without committing anything", () => {
  let draft = selectPointType(stopped(), "reverse");
  draft = adjustPointScore(draft, "left", -1);
  draft = adjustPointScore(draft, "right", 1);
  const restored = normalizePointDraft(JSON.parse(JSON.stringify(draft)));
  assert.deepEqual(restored, draft);
  assert.equal(restored.activeMatch.leftScore, 2);
  assert.equal(restored.pointHistory.length, 0);
  assert.equal(commitPointDraft(restored).controller.activeMatch.rightScore, 2);
});

test("legacy stopped points acquire an empty draft and never infer a recipient from the old base side", () => {
  const legacy = { ...fixture(), phase: "POINT_STOPPED_WAITING_DECISION", pendingBaseSide: "right", activeAnchor: null };
  const migrated = normalizePointDraft(deepFreeze(legacy));
  assert.equal(migrated.pointDraft.kind, null);
  assert.equal(migrated.pendingBaseSide, null);
  assert.deepEqual(migrated.pointDraft.deltas, { alpha: 0, bravo: 0 });
  assert.throws(() => commitPointDraft(migrated), /Choose Approve/);
  const selected = adjustPointScore(selectPointType(migrated, "approve"), "right", 1);
  assert.equal(commitPointDraft(selected).decision.scoringTeamId, "bravo");
  const ready = { ...fixture(), phase: "READY" };
  assert.equal(normalizePointDraft(ready), ready);
  assert.equal(previewPointScore(ready, "left"), 2);
});

test("a stale match, team assignment, or canonical score cannot absorb someone else's pending edits", () => {
  const draft = adjustPointScore(selectPointType(stopped(), "approve"), "left", 1);
  for (const alter of [
    (next) => { next.activeMatch.id = "different-game"; },
    (next) => { next.activeMatch.leftTeamId = "replacement-team"; },
    (next) => { next.activeMatch.rightScore = 4; }
  ]) {
    const stale = structuredClone(draft);
    alter(stale);
    const untouched = structuredClone(stale);
    assert.throws(() => commitPointDraft(stale), /different match|score changed/);
    assert.throws(() => adjustPointScore(stale, "left", 1), /different match|score changed/);
    assert.deepEqual(stale, untouched);
  }
});

test("a completed point and a replay of its draft cannot commit twice", () => {
  const draft = adjustPointScore(selectPointType(stopped(), "approve"), "left", 1);
  const finished = commitPointDraft(draft).controller;
  assert.throws(() => commitPointDraft(finished), /Stop the game with Base/);
  const replay = structuredClone(draft);
  replay.pointHistory = structuredClone(finished.pointHistory);
  assert.throws(() => commitPointDraft(replay), /already been recorded/);
  assert.equal(finished.activeMatch.leftScore, 3);
  assert.equal(finished.pointHistory.length, 1);
});

test("invalid type, pit, or adjustment inputs cannot mutate the controller", () => {
  const original = deepFreeze(stopped());
  assert.throws(() => adjustPointScore(original, "left", 1), /Choose Approve or Reverse/);
  assert.throws(() => selectPointType(original, "award-opponent"), /Choose Approve/);
  const selected = deepFreeze(selectPointType(original, "approve"));
  assert.throws(() => adjustPointScore(selected, "middle", 1), /left or right/);
  assert.throws(() => adjustPointScore(selected, "left", 0.5), /whole-point/);
  assert.throws(() => adjustPointScore(selected, "left", Number.NaN), /whole-point/);
  assert.deepEqual(selected.pointDraft.deltas, { alpha: 0, bravo: 0 });
  assert.deepEqual(POINT_TYPES.map(({ kind, voice }) => [kind, voice]), [
    ["approve", "Point approved"], ["reverse", "Point reversed"], ["none", "No points"]
  ]);
});
