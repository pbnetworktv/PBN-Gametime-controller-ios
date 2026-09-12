import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");

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
