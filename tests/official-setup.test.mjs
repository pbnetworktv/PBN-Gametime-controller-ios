import assert from 'node:assert/strict';
import test from 'node:test';
import { controllerHarness, response, settle, deferred } from './companion-harness.mjs';
const context = { fields: [{ id: 'field-1', name: 'Official Field' }], teams: [{ id: 'team-1', name: 'Home Team', members: [{ userId: 'operator-a', name: 'Operator A' }] }], entryTiers: [100, 200] };
function fill(window, selector, value, change = false) { const node = window.document.querySelector(selector); assert.ok(node, selector); node.value = value; if (change) node.dispatchEvent(new window.Event('change', { bubbles: true })); }
const click = (window, selector) => window.document.querySelector(selector).click();
function values(window) { fill(window, '#setup-fieldId', 'field-1'); fill(window, '#setup-date', '2030-06-05'); fill(window, '#setup-time', '10:00'); fill(window, '#setup-timezone', 'America/Chicago'); }
const result = (kind, id, canControl = false) => ({ id, kind, name: 'Shared Setup', venue: 'Official Field', startsAt: '2030-06-05T15:00:00Z', status: 'WAITING', statusLabel: canControl ? 'Published in GameTime' : 'Waiting for confirmation', eventCode: 'ABC123', canControl, gameTimePath: '/events/community/' + id });

test('a tournament saves once after a lost reply and leaves the current practice intact', async t => {
  let first, attempts = 0, created;
  const harness = await controllerHarness(request => {
    if (request.path.endsWith('/controller-setups/context')) return response(context);
    if (request.path.endsWith('/controller-setups') && request.method === 'POST') {
      attempts++; first ||= request.body; assert.deepEqual(request.body, first);
      if (attempts === 1) throw Error('Connection interrupted');
      created = result('TOURNAMENT', 'shared-event', true); return response(created, 201);
    }
    if (created && request.path.endsWith('/controller-setups')) return response({ items: [created] });
  }); t.after(harness.close);
  const state = harness.local(), id = state.activeEventId;
  await harness.api.officialSetup.show('TOURNAMENT');
  assert.equal(harness.window.document.querySelector('.modal-card .close').formNoValidate, true, 'closing an incomplete setup must not be blocked by required fields');
  values(harness.window);
  fill(harness.window, '#setup-name', 'Real Cup'); fill(harness.window, '#setup-endDate', '2030-06-05'); fill(harness.window, '#setup-teams', 'Alpha\nBravo');
  click(harness.window, '[data-setup-action="save"]'); await settle();
  assert.match(harness.window.document.querySelector('#modalBody').textContent, /RETRY SAVE/);
  assert.equal(state.officialSetupPending.kind, 'TOURNAMENT'); assert.equal(state.officialSetupPending.visibility, 'PUBLIC');
  assert.equal(state.activeEventId, id); assert.equal(state.controller.activeMatch.leftTeam, 'Alpha');
  click(harness.window, '[data-setup-action="save"]'); await settle();
  assert.equal(attempts, 2); assert.equal(state.officialSetupPending, null);
  assert.match(harness.window.document.querySelector('#modalBody').textContent, /SAVED IN GAMETIME.*ABC123/s);
  assert.ok(harness.window.document.querySelector('[data-setup-action="open"]'));
  assert.match(harness.window.document.querySelector('.setup-receipt a').href, /\/game-time\/app\/events\/community\/shared-event$/);
  assert.equal(state.activeEventId, id); assert.deepEqual(harness.errors, []);
});

test('scrimmage uses a registered Coach team and stays pending, with a direct GameTime agreement link', async t => {
  let created;
  const harness = await controllerHarness(request => {
    if (request.path.endsWith('/controller-setups/context')) return response(context);
    if (request.path.endsWith('/controller-setups') && request.method === 'POST') { created = { ...result('SCRIMMAGE', request.body.requestId), gameTimePath: '/scrimmages?event=' + request.body.requestId }; return response(created, 201); }
    if (created && request.path.endsWith('/controller-setups')) return response({ items: [created] });
  }); t.after(harness.close);
  await harness.api.officialSetup.show('SCRIMMAGE'); values(harness.window);
  click(harness.window, '[data-setup-action="save"]'); await settle();
  const command = harness.requests.find(request => request.path.endsWith('/controller-setups') && request.method === 'POST').body;
  assert.equal(command.kind, 'SCRIMMAGE'); assert.equal(command.teamId, 'team-1'); assert.equal(command.terms.playersPerTeam, 5); assert.equal(command.timezone, 'America/Chicago');
  assert.equal('teams' in command, false); assert.equal(harness.window.document.querySelector('[data-setup-action="open"]'), null);
  harness.window.document.querySelector('#modal').close(); harness.api.route('command-home');
  const card = harness.window.document.querySelector('.setup-pending'); assert.match(card.textContent, /SCRIMMAGE.*ABC123.*Waiting for confirmation/s); assert.ok(card.querySelector('a').href.includes('/scrimmages?event='));
});

test('challenge chooses an eligible GameTime opponent and sends a draft without funding it', async t => {
  const writes = [];
  const harness = await controllerHarness(request => {
    if (request.path.endsWith('/controller-setups/context')) return response(context);
    if (request.path.endsWith('/coins/opponents')) return response({ players: [{ id: 'friend-1', name: 'GameTime Friend' }], favoriteFields: [] });
    if (request.path.endsWith('/controller-setups') && request.method === 'POST') { writes.push(request.body); return response(result('CHALLENGE', request.body.requestId), 201); }
  }); t.after(harness.close);
  await harness.api.officialSetup.show('CHALLENGE'); values(harness.window);
  fill(harness.window, '#setup-opponentId', 'friend-1'); click(harness.window, '[data-setup-action="save"]'); await settle();
  assert.equal(writes.length, 1); assert.equal(writes[0].opponentId, 'friend-1'); assert.equal(writes[0].challengeKind, 'DUEL'); assert.equal(writes[0].terms.playersPerTeam, 1); assert.equal(writes[0].entry, 100);
  assert.equal(harness.requests.filter(request => request.method === 'POST' && request.path.includes('/coins/')).length, 0);
});

test('a late setup reply never crosses an account change', async t => {
  const pending = deferred(); let started = false;
  const harness = await controllerHarness(request => {
    if (request.path.endsWith('/controller-setups/context')) return response(context);
    if (request.path.endsWith('/controller-setups') && request.method === 'POST') { started = true; return pending.promise; }
  }); t.after(harness.close);
  await harness.api.officialSetup.show('SCRIMMAGE'); values(harness.window); click(harness.window, '[data-setup-action="save"]'); await settle(); assert.ok(started);
  harness.api.selectMemberWorkspace({ id: 'other-account' }); pending.resolve(response(result('SCRIMMAGE', 'old-id'), 201)); await settle();
  assert.equal(harness.window.document.querySelector('#modal').open, false); assert.equal(harness.api.state.ownerUserId, 'other-account'); assert.equal(harness.api.state.officialSetupPending, null); assert.equal(harness.api.state.remoteSetups.length, 0); assert.equal(harness.window.document.body.textContent.includes('SAVED IN GAMETIME'), false);
});
