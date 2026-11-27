import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderControllerView, isFinalBreakCountdown } from "../src/controller-view.js";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const home = await readFile(new URL("../src/companion-home.js", import.meta.url), "utf8");
const index = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

const active = { label: "Game 1", leftName: "ALPHA", rightName: "BRAVO", leftScore: 2, rightScore: 1, gameClock: "08:42", breakClock: "02:00", status: "Clock stopped" };
const liveView = (overrides = {}) => renderControllerView({
  active, phase: "POINT_STOPPED_WAITING_DECISION", selectedType: "approve",
  baseEnabled: true, pauseEnabled: true, scoreEnabled: true, typeEnabled: true,
  startBreakEnabled: true, undoEnabled: true, ...overrides
});


test("authoritative anchors drive break and game clocks", () => {
  assert.match(app, /startedAt: Date\.now\(\)/);
  assert.match(app, /anchoredRemaining/);
  assert.match(app, /GAME_CLOCK_AUTO_STARTED/);
});

test("the controller exposes one Base, one Pause and one point-type selector", () => {
  const html = liveView();
  for (const action of ["base", "pause", "start-break"]) {
    assert.equal((html.match(new RegExp('data-action="' + action + '"', "g")) || []).length, 1);
  }
  assert.equal((html.match(/data-action="point-type"/g) || []).length, 3);
  assert.equal((html.match(/data-action="score-(?:plus|minus)"/g) || []).length, 4);
  assert.match(html, /No points/);
  assert.match(html, /Undo last action/);
  assert.doesNotMatch(html, /LEFT BASE|RIGHT BASE|AWARD POINT/);
});

test("break clock supports announcements, countdown cues, and separate default mode", () => {
  assert.match(app, /spokenDuration/);
  assert.match(app, /speak\("Game started"\)/);
  assert.match(app, /function synthHorn/);
  assert.match(app, /createControllerAudio/);
  assert.match(app, /controllerAudio\.playCue/);
  assert.match(app, /controllerAudio\.say/);
  assert.match(app, /data-action="test-announcements"/);
  assert.match(app, /\[30, 20, 10\]/);
  assert.match(app, /function playCountdownCue/);
  assert.match(app, /unlockCueAudio/);
  assert.match(app, /BREAK_CLOCK_JUMPED/);
  assert.match(app, /BREAK_DEFAULT_CHANGED/);
  assert.match(app, /set-default-mode/);
});

test("the final break countdown stays green from ten seconds through zero, including after rerender", () => {
  for (const milliseconds of [10000, 9999, 5000, 1, 0]) {
    assert.equal(isFinalBreakCountdown(milliseconds), true, `${milliseconds} ms should be green`);
    const html = liveView({ breakWarning: isFinalBreakCountdown(milliseconds) });
    assert.match(html, /id="breakClock" class="arena-break-clock warning"/);
  }
  for (const milliseconds of [11000, 10001, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(isFinalBreakCountdown(milliseconds), false);
    const html = liveView({ breakWarning: isFinalBreakCountdown(milliseconds) });
    assert.match(html, /id="breakClock" class="arena-break-clock"/);
  }
  assert.match(styles, /\.arena-break-clock\.warning\s*\{[^}]*color:\s*#75f05a/i);
});

test("reference and alternate countdown sounds are bundled into settings", () => {
  assert.match(app, /field-reference-beep/);
  assert.match(app, /Field controller reference/);
  assert.match(app, /cueLibraryVersion: 2/);
  assert.match(app, /scoreboard-beep/);
  assert.match(app, /referee-timer-beep/);
  assert.match(app, /tournament-beep/);
  assert.match(app, /selectField\("countdownCue"/);
});

test("pause control exposes resume state and viewport zoom is disabled", () => {
  assert.match(liveView({ paused: true }), /<span>Resume<\/span>/);
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

test("home exposes distinct GameTime setup and a guided event readiness path", () => {
  assert.match(home, /SCRIMMAGES IN GAMETIME/);
  assert.match(home, /CREATE TOURNAMENT/);
  assert.match(app, /CONTINUE WHERE I LEFT OFF/);
  assert.match(app, /function eventSetupSteps/);
  assert.match(app, /function startScrimmage/);
  assert.match(app, /function runEvent/);
});

test("scrimmages support explicit single and split deck behavior", () => {
  assert.match(app, /Single Deck \(2 teams\)/);
  assert.match(app, /Split Deck \(4 teams\)/);
  assert.match(app, /deckStyle === "split"/);
  assert.doesNotMatch(liveView({ inactive: null }), /class="arena-inactive"/);
  assert.match(app, /leftPhysicalTeamId/);
  assert.match(app, /rightPhysicalTeamId/);
});

test("point types stay distinct and score controls identify the team in each physical pit", () => {
  const html = liveView({ selectedType: "reverse" });
  assert.match(html, /data-kind="reverse" aria-pressed="true"/);
  assert.match(html, /data-kind="approve" aria-pressed="false"/);
  assert.match(html, /data-side="left" aria-label="Add one point to ALPHA, Pit 1"/);
  assert.match(html, /data-side="right" aria-label="Subtract one point from BRAVO, Pit 2"/);
  const swapped = liveView({ active: { ...active, leftName: "BRAVO", rightName: "ALPHA", leftScore: 1, rightScore: 2 } });
  assert.match(swapped, /data-side="left" aria-label="Add one point to BRAVO, Pit 1"/);
  assert.match(swapped, /data-side="right" aria-label="Add one point to ALPHA, Pit 2"/);
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
  assert.match(app, /\/api\/game-time\/player\/controller-events/);
  assert.match(home, /My PBN events/);
  assert.match(app, /data-action="open-remote-event"/);
  assert.match(app, /await restoreControllerWorkspace\(selected.id\)/);
  assert.match(app, /remoteEventDateLabel/);
  assert.match(app, /function refreshRemoteEvents/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /name === "command-home"/);
});

test("shared PBN events use their unique event ID and never inherit demo teams", () => {
  assert.match(app, /function activateRemoteEvent/);
  assert.match(app, /state\.activeEventId = eventId/);
  assert.match(app, /eventWorkspaces\?\.\[eventId\]/);
  assert.match(app, /Array\.isArray\(selected\.teams\) \? selected\.teams : \[\]/);
  assert.match(app, /Array\.isArray\(selected\.schedule\).*: \[\]/);
  assert.match(app, /if \(!state\.schedule\.length\) return toast\("Add teams and build a schedule before running this event\."\)/);
  assert.match(app, /eventId: state\.activeEventId \|\| state\.event\?\.id \|\| null/);
});

