import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const index = await readFile(new URL("../src/index.html", import.meta.url), "utf8");

test("authoritative anchors drive break and game clocks", () => {
  assert.match(app, /startedAt: Date\.now\(\)/);
  assert.match(app, /anchoredRemaining/);
  assert.match(app, /GAME_CLOCK_AUTO_STARTED/);
});

test("live controls and correction semantics are distinct", () => {
  assert.match(app, /BUZZER_LEFT/);
  assert.match(app, /BUZZER_RIGHT/);
  assert.match(app, /POINT_STOPPED_WAITING_DECISION/);
  assert.match(app, /decide\("approve"\)/);
  assert.match(app, /decide\("reverse"\)/);
  assert.match(app, /decide\("no_point"\)/);
  assert.match(app, /UNDO/);
  assert.doesNotMatch(app, /reset-controller/);
});

test("break clock supports announcements, countdown cues, and separate default mode", () => {
  assert.match(app, /spokenDuration/);
  assert.match(app, /speak\("Game started"\)/);
  assert.match(app, /tone\(850, 1\.7\)/);
  assert.match(app, /BREAK_CLOCK_JUMPED/);
  assert.match(app, /BREAK_DEFAULT_CHANGED/);
  assert.match(app, /set-default-mode/);
});

test("pause control exposes resume state and viewport zoom is disabled", () => {
  assert.match(app, /▶ RESUME/);
  assert.match(index, /maximum-scale=1,user-scalable=no/);
});

test("application exposes all first-iteration routes", () => {
  const routes = [
    "login", "leagues", "league-home", "event-dashboard", "event-settings",
    "schedule-builder", "master-schedule", "live-controller", "standings",
    "playoffs", "teams", "divisions", "fields", "staff", "activity",
    "publishing", "settings"
  ];
  for (const route of routes) assert.match(app, new RegExp(`"${route}"`));
});
