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
  assert.match(app, /function synthHorn/);
  assert.match(app, /playCue\("game-start-horn", synthHorn, \(\) => speak\("Game started"\)\)/);
  assert.match(app, /let cuePlayer = null/);
  assert.doesNotMatch(app, /const cuePlayers = new Map/);
  assert.match(app, /\[30, 20, 10\]/);
  assert.match(app, /function playCountdownCue/);
  assert.match(app, /unlockCueAudio/);
  assert.match(app, /BREAK_CLOCK_JUMPED/);
  assert.match(app, /BREAK_DEFAULT_CHANGED/);
  assert.match(app, /set-default-mode/);
});

test("reference and alternate countdown sounds are bundled into settings", () => {
  assert.match(app, /field-reference-beep/);
  assert.match(app, /Field controller reference/);
  assert.match(app, /cueLibraryVersion: 2/);
  assert.match(app, /scoreboard-beep/);
  assert.match(app, /referee-timer-beep/);
  assert.match(app, /tournament-beep/);
  assert.match(app, /id="countdownCue"/);
});

test("pause control exposes resume state and viewport zoom is disabled", () => {
  assert.match(app, /▶ RESUME/);
  assert.match(index, /maximum-scale=1,user-scalable=no/);
});

test("application exposes all first-iteration routes", () => {
  const routes = [
    "login", "command-home", "leagues", "league-home", "event-dashboard", "event-settings",
    "schedule-builder", "master-schedule", "live-controller", "standings",
    "playoffs", "teams", "divisions", "fields", "staff", "activity",
    "publishing", "settings"
  ];
  for (const route of routes) assert.match(app, new RegExp(`"${route}"`));
});

test("home is scrimmage-first and full events use a guided readiness path", () => {
  assert.match(app, /START A SCRIMMAGE/);
  assert.match(app, /SET UP A FULL EVENT/);
  assert.match(app, /CONTINUE WHERE I LEFT OFF/);
  assert.match(app, /function eventSetupSteps/);
  assert.match(app, /function startScrimmage/);
  assert.match(app, /function runEvent/);
});

test("scrimmages support explicit single and split deck behavior", () => {
  assert.match(app, /Single Deck \(2 teams\)/);
  assert.match(app, /Split Deck \(4 teams\)/);
  assert.match(app, /deckStyle === "split"/);
  assert.match(app, /SINGLE DECK SCRIMMAGE/);
  assert.match(app, /leftPhysicalTeamId/);
  assert.match(app, /rightPhysicalTeamId/);
});

test("base decisions award the team opposite the hit base", () => {
  assert.match(app, /const scoringSide = side === "left" \? "right" : "left"/);
  assert.match(app, /addPoint\(scoringTeamId\)/);
  assert.match(app, /ACTIVE_INACTIVE_SWAPPED/);
});

test("member sessions persist securely across app launches", () => {
  assert.match(app, /capacitor-secure-storage/);
  assert.match(app, /SecureStorage\.setItem/);
  assert.match(app, /SecureStorage\.getItem/);
  assert.match(app, /\/api\/mobile-auth\/refresh/);
  assert.match(app, /\/api\/mobile-auth\/me/);
  assert.match(app, /refreshWithinMs/);
  assert.match(app, /CREATE YOUR PBN ACCOUNT/);
  assert.match(app, /delete-account/);
  assert.doesNotMatch(app, /localStorage\.setItem\([^\n]*session\.token/);
});

test("legacy and offline demo state cannot bypass account entry on launch", () => {
  assert.match(app, /if \(!saved\?\.token\) \{\s*state\.authenticated = false;/);
  assert.match(app, /state\.route = "login";/);
});

test("signed-in members can open their shared PBN events", () => {
  assert.match(app, /\/api\/game-time\/events/);
  assert.match(app, /My PBN events/);
  assert.match(app, /data-action="open-remote-event"/);
  assert.match(app, /REMOTE_EVENT_OPENED/);
});
