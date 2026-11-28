import assert from "node:assert/strict";
import test from "node:test";
import { controllerHarness, response, settle, deferred } from "./companion-harness.mjs";
import { controllerEventFromLink } from "../src/controller-handoff.js";
import { eventStandings, nextEventMatch } from "../src/event-progress.js";
import { staffJoinView, organizerStaffView } from "../src/companion-view.js";

test("failed creation retries the original request and carries newer local scores into one shared event", async t => {
  let attempts = 0, opening, saved;
  const harness = await controllerHarness(request => {
    if (request.path.endsWith("/controller-events") && request.method === "POST") {
      attempts++;
      if (!opening) opening = request.body;
      else assert.deepEqual(request.body, opening);
      if (attempts === 1) throw Error("Test network interruption");
      saved = { ...structuredClone(opening.snapshot), eventId: "shared-test", event: { ...opening.snapshot.event, id: "shared-test", source: "PBN" } };
      saved.controller.eventId = "shared-test";
      return response({ id: "shared-test" }, 201);
    }
    if (saved && request.path.endsWith("/controller-events")) return response([{ ...saved.event, eventCode: "ABC123", schedule: saved.schedule, teams: saved.teams }]);
    if (request.path.endsWith("/controller/shared-test")) return response({ revision: 1, snapshot: saved });
  }); t.after(harness.close);
  const state = harness.local();
  await harness.api.publishCurrentEvent();
  assert.equal(state.event.source, "local");
  assert.equal(Object.keys(state.pendingCreations).length, 1);
  assert.match(harness.window.document.body.textContent, /RETRY SAVE/);
  state.controller.activeMatch.leftScore = 2;
  state.controller.phase = "GAME_PAUSED";
  harness.api.save();
  await harness.api.publishCurrentEvent();
  assert.equal(state.event.source, "PBN");
  assert.equal(state.activeEventId, "shared-test");
  assert.equal(state.controller.activeMatch.leftScore, 2);
  assert.equal(state.controller.eventId, "shared-test");
  assert.equal(state.session.eventId, "shared-test");
  assert.equal(state.schedule[0].eventId, "shared-test");
  assert.equal(state.sync.pending, 1);
  assert.equal(Object.keys(state.pendingCreations).length, 0);
  assert.equal(attempts, 2);
  assert.deepEqual(harness.errors, []);
});

test("lost save responses retry the same mutation before saving a newer score", async t => {
  const writes = []; let fail = true;
  const harness = await controllerHarness(request => {
    if (request.path.endsWith("/controller/shared-test") && request.method === "PUT") {
      writes.push(request.body);
      if (fail) { fail = false; throw Error("Response lost after server save"); }
      return response({ revision: writes.length === 2 ? 2 : 3 });
    }
  }); t.after(harness.close);
  const state = harness.local("shared-test"); state.event.source = "PBN";
  harness.api.logAction("SCORE_UPDATED");
  await harness.api.flushControllerSync();
  assert.equal(state.sync.pending, 1);
  assert.ok(state.sync.inFlight.mutationId);
  state.controller.activeMatch.leftScore = 2;
  harness.api.logAction("SCORE_UPDATED");
  await harness.api.flushControllerSync();
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(state.sync.pending, 1);
  await harness.api.flushControllerSync();
  assert.notEqual(writes[1].mutationId, writes[2].mutationId);
  assert.equal(writes[2].snapshot.controller.activeMatch.leftScore, 2);
  assert.equal(writes[2].revision, 2);
  assert.equal(state.sync.pending, 0);
});

test("a competing shared score requires review and keeps the device score", async t => {
  let saved;
  const harness = await controllerHarness(request => request.path.endsWith("/controller/shared-test") ? response({ revision: 3, snapshot: saved }) : undefined);
  t.after(harness.close);
  const state = harness.local("shared-test"); state.event.source = "PBN";
  state.controller.activeMatch.leftScore = 1;
  harness.api.logAction("SCORE_UPDATED");
  saved = structuredClone(state.eventWorkspaces["shared-test"]);
  saved.controller.activeMatch.leftScore = 2;
  await harness.api.restoreControllerWorkspace("shared-test");
  assert.equal(state.controller.activeMatch.leftScore, 1);
  assert.equal(state.sync.conflict, true);
  await harness.api.flushControllerSync();
  assert.equal(harness.requests.filter(request => request.method === "PUT").length, 0);
});

test("account switching ignores a late event creation response and hides the previous account's matches", async t => {
  const pending = deferred(); let waiting = false;
  const harness = await controllerHarness(request => {
    if (request.path.endsWith("/controller-events") && request.method === "POST") { waiting = true; return pending.promise; }
  }); t.after(harness.close);
  harness.local();
  const publishing = harness.api.publishCurrentEvent();
  await settle(); assert.equal(waiting, true);
  harness.api.selectMemberWorkspace({ id: "operator-b", screenName: "Operator B" });
  pending.resolve(response({ id: "late-shared-test" }, 201));
  await publishing;
  assert.equal(harness.api.state.ownerUserId, "operator-b");
  assert.equal(harness.api.state.activeEventId, null);
  assert.deepEqual([...harness.api.state.teams], []);
  assert.equal(harness.api.state.remoteEvents.length, 0);
  assert.equal(harness.api.state.eventWorkspaces["late-shared-test"], undefined);
});

test("switching back to an account restores its saved match without storing its sign-in token in the workspace", async t => {
  const harness = await controllerHarness(); t.after(harness.close);
  const state = harness.local(); state.controller.activeMatch.leftScore = 2;
  harness.api.save();
  const stored = harness.window.localStorage.getItem("pbn_game_time_controller_v3:operator-a");
  assert.equal(JSON.parse(stored).controller.activeMatch.leftScore, 2);
  assert.doesNotMatch(stored, /local-test-token/);
  harness.api.selectMemberWorkspace({ id: "operator-b", screenName: "Operator B" });
  assert.equal(harness.api.state.activeEventId, null);
  harness.api.selectMemberWorkspace({ id: "operator-a", screenName: "Operator A" });
  assert.equal(harness.api.state.activeEventId, "local-scrimmage-test");
  assert.equal(harness.api.state.controller.activeMatch.leftScore, 2);
});

test("opening a shared event restores its real match and does not queue a score change merely for viewing", async t => {
  let saved;
  const harness = await controllerHarness(request => request.path.endsWith("/controller/shared-test") ? response({ revision: 1, snapshot: saved }) : undefined);
  t.after(harness.close);
  const state = harness.local("shared-test"); state.event.source = "PBN";
  state.controller.activeMatch.leftScore = 2;
  harness.api.save();
  saved = structuredClone(state.eventWorkspaces["shared-test"]); delete saved.sync;
  harness.local("local-other-test");
  await harness.api.activateRemoteEvent({ ...saved.event, teams: saved.teams, schedule: saved.schedule, eventCode: "ABC123" }, { openControl: false });
  assert.equal(state.activeEventId, "shared-test");
  assert.equal(state.controller.activeMatch.leftScore, 2);
  assert.equal(state.event.eventCode, "ABC123");
  assert.equal(state.sync.pending, 0);
  assert.deepEqual([...state.teams], ["Alpha", "Bravo"]);
});

test("native staff claims request a fresh precise location and reuse the claim ID after a lost response", async t => {
  const claims = []; let fail = true;
  const harness = await controllerHarness(request => {
    if (request.path.endsWith("/staff/claim")) {
      claims.push(request.body);
      if (fail) { fail = false; throw Error("Response lost"); }
      return response({ code: "ABC123", configured: true, roles: [], days: [] });
    }
  }); t.after(harness.close);
  harness.api.setStaff({ code: "ABC123", configured: true, roles: [], days: [] }, "2026-11-22");
  await harness.api.claimStaffRole("controller");
  await harness.api.claimStaffRole("controller");
  assert.equal(claims.length, 2);
  assert.equal(claims[0].requestId, claims[1].requestId);
  assert.equal(claims[1].location.accuracy, 5);
  assert.equal(harness.locationRequests[0].maximumAge, 0);
  assert.equal(harness.locationRequests[0].enableHighAccuracy, true);
  assert.equal(harness.requests.find(request => request.path.endsWith("/staff/claim")).headers.Authorization, "Bearer local-test-token");
});

test("denied location leaves the role unclaimed and gives a useful retry message", async t => {
  const harness = await controllerHarness(); t.after(harness.close);
  harness.window.__qa.location = async () => { throw Error("Location permission denied"); };
  harness.api.setStaff({ code: "ABC123", configured: true, roles: [], days: [] }, "2026-11-22");
  await harness.api.claimStaffRole("controller");
  assert.equal(harness.requests.filter(request => request.path.endsWith("/staff/claim")).length, 0);
  assert.match(harness.api.staffError, /Allow Precise Location/);
});

test("Controller links accept the intended event and reject unrelated or malformed links", () => {
  assert.equal(controllerEventFromLink("pbngametimecontroller://event/open?event=match-1"), "match-1");
  assert.equal(controllerEventFromLink("https://www.pbnetwork.tv/game-time/controller?event=match-1", "https://www.pbnetwork.tv"), "match-1");
  assert.equal(controllerEventFromLink("https://other.example/game-time/controller?event=match-1", "https://www.pbnetwork.tv"), null);
  assert.equal(controllerEventFromLink("https://www.pbnetwork.tv/game-time-controller/index.html?event=match-1", "https://www.pbnetwork.tv"), "match-1");
  for (const link of ["https://other.example/game-time-controller/index.html?event=match-1", "pbngametimecontroller://staff/open?event=match-1", "pbngametimecontroller://event/open?event=../match"]) assert.equal(controllerEventFromLink(link, "https://www.pbnetwork.tv"), null);
});

test("event standings count completed matches and a corrected unfinished match returns to the schedule", () => {
  const first = { id: "m1", leftTeam: "Alpha", rightTeam: "Bravo", leftScore: 3, rightScore: 1, complete: true };
  const controller = { completedMatches: { m1: first }, activeMatch: { id: "m2", leftTeam: "Alpha", rightTeam: "Bravo", leftScore: 9, rightScore: 0 } };
  assert.deepEqual(eventStandings(["Alpha", "Bravo"], controller).map(row => [row.w, row.l, row.diff]), [[1, 0, 2], [0, 1, -2]]);
  assert.equal(nextEventMatch([{ id: "m1" }, { id: "m2" }], controller).id, "m2");
  controller.activeMatch = { ...first, complete: false };
  assert.equal(nextEventMatch([{ id: "m1" }, { id: "m2" }], controller).id, "m1");
});

test("staff views escape names, preserve dated days and disable occupied roles", () => {
  const view = { name: '<img src=x onerror="alert(1)">', venue: "Field", code: "ABC123", days: [{ date: "2026-11-22", weekday: "Sun" }], configured: true, roles: [{ id: "controller", name: "Controller", occupied: true }], rate: 100, policy: { paintballsPerHour: 100 }, selectedDay: "2026-11-22", availableRoles: [] };
  const joined = staffJoinView({ view, code: view.code, day: view.selectedDay, busy: false });
  assert.doesNotMatch(joined, /<img/);
  assert.match(joined, /value="2026-11-22" selected/);
  assert.match(joined, /data-role-id="controller" disabled/);
  const managed = organizerStaffView({ view, fields: [], busy: false });
  assert.match(managed, /ENABLE STAFFING|SAVE STAFF SETTINGS/);
  assert.doesNotMatch(managed, /<img/);
});



test('commissioner imports a private tournament without publishing it', async t => {
  const harness=await controllerHarness();t.after(harness.close);
  harness.api.route('command-home');
  const doc=harness.window.document;
  assert.ok(doc.querySelector('a[href$="/game-time/app/scrimmages"]'));
  assert.equal(doc.querySelector('[data-action="open-challenge"]'),null);
  doc.querySelector('[data-action="open-new-event"]').click();
  for(const [id,value] of Object.entries({newEventName:'Private Cup',eventStartDate:'2030-06-05',newEventStartTime:'09:00',newEventTeams:'Alpha\nBravo\nCharlie\nDelta',newEventField:'2'}))doc.getElementById(id).value=value;
  const venue=doc.getElementById('eventVenue');venue.innerHTML='<option value="Home Field">Home Field</option>';venue.value='Home Field';
  doc.querySelector('[data-action="create-local-event"]').click();await settle();
  assert.equal(harness.api.state.event.visibility,'PRIVATE');assert.equal(harness.api.state.teams.length,4);
  assert.equal(harness.api.state.schedule.length,6);assert.equal(harness.api.state.fields.length,2);
  assert.equal(harness.requests.filter(r=>r.method==='POST' && /controller-events|controller-setups/.test(r.path)).length,0);
});

test('public listing is explicit and registered teams are reviewed before changing the draw',async t=>{
 let published=0;
 const harness=await controllerHarness(request=>{
  if(request.path.endsWith('/events/shared-test/publish')){published++;return response({fieldId:'test-field'});}
  if(request.path.endsWith('/community-events/shared-test/registrations'))return response({entries:[{kind:'TEAM',name:'Charlie'},{kind:'TEAM',name:'Delta'},{kind:'TEAM',name:'Echo'}]});
 });t.after(harness.close);
 const state=harness.local('shared-test');state.event.source='PBN';state.event.eventType='Paintball tournament';state.session.active=false;state.controller.activeMatch=null;
 state.event.startDate='2030-06-05';state.event.startTime='09:00';state.scheduleDraft={days:1,start:'09:00',matchMinutes:20,restSlots:1,version:1};
 harness.api.route('publishing');const doc=harness.window.document;
 assert.equal(published,0);doc.querySelector('[data-action="publish-public-event"]').click();await settle();
 assert.equal(published,1);assert.equal(state.event.publishedToGameTime,true);
 harness.api.route('teams');doc.querySelector('[data-action="edit-tournament-draw"]').click();
 doc.querySelector('[data-action="load-registered-teams"]').click();await settle();
 assert.deepEqual(state.teams,['Alpha','Bravo']);assert.equal(doc.querySelector('#drawTeams').value,'Charlie\nDelta\nEcho');
 doc.querySelector('[data-action="save-tournament-draw"]').click();await settle();
 assert.deepEqual(Array.from(state.teams),['Charlie','Delta','Echo']);assert.equal(state.schedule.length,3);
 assert.equal(state.scheduleDraft.published,false);
 assert.deepEqual(harness.errors,[]);
});


test('saved Controller accounts cannot load matches or resume a deep link before signing',async t=>{
 const h=await controllerHarness(req=>req.path.endsWith('/nda')?response({version:'1.0',hash:'fixture',document:'# Test NDA\nComplete test agreement.',acknowledgement:'I agree.',guardianRequired:false,receipt:null}):undefined,{waitForReady:false});t.after(h.close);
 assert.match(h.window.document.body.textContent,/Before you enter Game Time/);
 assert.equal(h.requests.filter(r=>r.path.endsWith('/controller-events')||r.path.endsWith('/staff/mine')).length,0);
 h.api.route('live-controller');await settle();
 assert.match(h.window.document.body.textContent,/Sign NDA & Continue/);
 assert.ok(!h.window.document.querySelector('[data-action="start-game"]'));
 const buttons=[...h.window.document.querySelectorAll('button')];buttons.find(b=>b.textContent==='Decline & sign out').click();await settle();
 assert.match(h.window.document.body.textContent,/SIGN IN TO YOUR ACCOUNT/);
});
