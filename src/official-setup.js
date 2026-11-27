import { htmlText as h } from './companion-view.js';

const labels = { TOURNAMENT: 'Tournament', SCRIMMAGE: 'Team scrimmage', CHALLENGE: 'Challenge' };
const options = (values, selected) => values.map(item => { const [value, label] = Array.isArray(item) ? item : [item, item]; return `<option value="${h(value)}"${String(value) === String(selected) ? ' selected' : ''}>${h(label)}</option>`; }).join('');
const select = (id, label, values, value) => `<div class="field"><label for="setup-${id}">${h(label)}</label><select id="setup-${id}" data-setup-key="${id}">${options(values, value)}</select></div>`;
const input = (id, label, value, type = 'text', extra = '') => `<div class="field"><label for="setup-${id}">${h(label)}</label><input id="setup-${id}" data-setup-key="${id}" type="${type}" value="${h(value)}" ${extra}></div>`;
const rules = [['Follow the field referee. Major and minor penalties follow the agreed field rules.', 'Field referee rules'], ['NXL major and minor penalties apply. The head referee makes the final decision.', 'NXL penalties'], ['ICPL major and minor penalties apply. The head referee makes the final decision.', 'ICPL penalties']];

export function createOfficialSetup({ modal, body, request, stamp, getPending, setPending, saved, openController, origin }) {
  let kind, context, values, opponents = [], opponentFields = [], loading = false, busy = false, error = '', receipt = null, turn = 0, lookup = 0, account;
  const current = () => account === stamp();
  const collect = () => { for (const node of body.querySelectorAll('[data-setup-key]')) values[node.dataset.setupKey] = node.value; values.playerIds = [...body.querySelectorAll('[data-setup-player]:checked')].map(node => node.value); };
  const link = path => `${origin()}/game-time/app${path}`;
  function render() {
    if (!current()) return;
    if (receipt) {
      body.innerHTML = `<section class="setup-receipt"><span class="eyebrow">SAVED IN GAMETIME</span><h2>${h(receipt.name)}</h2><strong class="setup-code">${h(receipt.eventCode)}</strong><p role="status">${h(receipt.statusLabel)}</p><p>${h(receipt.venue)}</p><a class="primary companion-return" href="${h(link(receipt.gameTimePath))}" target="_blank" rel="noreferrer">VIEW IN GAMETIME ↗</a>${receipt.canControl ? '<button type="button" class="secondary wide" data-setup-action="open">OPEN CONTROLLER</button>' : '<p class="form-note">Finish the agreement or invitation in GameTime. This setup will appear here as ready when confirmations are complete.</p>'}</section>`;
      return;
    }
    const pending = getPending();
    if (pending) {
      body.innerHTML = `<h2>Finish saving ${h(labels[pending.kind].toLowerCase())}</h2><p>Your setup request is kept on this device until GameTime confirms it. Retrying uses the same request.</p>${error ? `<p class="form-error" role="alert">${h(error)}</p>` : ''}<button type="button" class="primary wide" data-setup-action="save"${busy ? ' disabled' : ''}>${busy ? 'SAVING…' : 'RETRY SAVE'}</button><a class="companion-return" href="${h(link('/events/mine'))}" target="_blank" rel="noreferrer">CHECK MY GAMETIME EVENTS ↗</a>`;
      return;
    }
    if (loading || !context) {
      body.innerHTML = `<h2>Set up ${h(labels[kind].toLowerCase())}</h2><p role="status">${h(error || 'Loading your GameTime fields and teams…')}</p>${error ? '<button type="button" class="secondary" data-setup-action="reload">RETRY</button>' : ''}`;
      return;
    }
    const settingsOpen = !!body.querySelector('[data-setup-settings]')?.open;
    const advanced = content => `<details class="setup-full setup-settings" data-setup-settings${settingsOpen ? ' open' : ''}><summary>${h(kind === 'TOURNAMENT' ? `Event settings · ${values.visibility === 'PUBLIC' ? 'Public' : 'Private'} · ${values.deckStyle === 'SPLIT' ? 'Split deck' : 'Single deck'}` : `Match settings · ${values.equipment} · ${values.breakSeconds}s between points`)}</summary><p class="form-note">Defaults are ready to use. Change these only when your event needs different rules.</p><div class="field-grid">${content}</div></details>`;
    const team = context.teams.find(team => team.id === values.teamId), duel = kind === 'CHALLENGE' && values.challengeKind === 'DUEL';
    const zones = [...new Set([values.timezone, 'America/Chicago', 'America/New_York', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'Pacific/Honolulu', 'America/Anchorage', 'UTC'])];
    const teamSelect = select('teamId', 'Your PBN team (Coach)', [['', 'Choose your team'], ...context.teams.map(team => [team.id, team.name])], values.teamId);
    const terms = kind === 'TOURNAMENT' ? `${input('name', 'Event name', values.name, 'text', 'required minlength="3" maxlength="100"')}${select('format', 'Scoring format', ['Race-to', 'Uncapped', 'Round robin', 'ICPL'], values.format)}${select('raceTo', 'Race-to score', [1, 2, 3, 4, 5, 6, 7], values.raceTo)}${advanced(`${select('visibility', 'Who can see this event?', [['PUBLIC', 'Public — field Upcoming Events'], ['PRIVATE', 'Private — organizer only']], values.visibility)}${input('endDate', 'Last event day', values.endDate, 'date', 'required')}${select('deckStyle', 'Deck style', [['SINGLE', 'Single deck'], ['SPLIT', 'Split deck — at least 4 teams']], values.deckStyle)}`)}<div class="field setup-full"><label for="setup-teams">Team names (one per line)</label><textarea id="setup-teams" data-setup-key="teams" rows="5" required maxlength="5184">${h(values.teams)}</textarea><small>Creates an opening match for each pair. Add later rounds from the event schedule.</small></div>` : `${kind === 'CHALLENGE' ? `${select('challengeKind', 'Challenge type', [['DUEL', 'Player vs player'], ['TEAM', 'Team vs team']], values.challengeKind)}${select('entry', 'Entry per player (Paintballs)', context.entryTiers, values.entry)}` : ''}${!duel ? teamSelect : ''}${kind === 'CHALLENGE' ? `${duel ? `${select('source', 'Find a GameTime player', [['friends', 'My GameTime friends'], ['home', 'My home field'], ['favorites', 'My favorite fields']], values.source)}${values.source === 'favorites' ? select('opponentFieldId', 'Favorite field', opponentFields.map(field => [field.id, field.name]), values.opponentFieldId) : ''}` : `${input('search', 'Search opposing team name', values.search, 'text', 'maxlength="80"')}<button type="button" class="secondary" data-setup-action="search">FIND TEAMS</button>`}${select('opponentId', duel ? 'Opponent' : 'Opposing PBN team', [['', opponents.length ? 'Choose opponent' : 'No opponents found'], ...opponents.map(item => [item.id, item.name])], values.opponentId)}` : ''}${select('mode', 'Match format', [['RACE_TO', 'Race to points'], ['TIMED', 'Timed match']], values.mode)}${values.mode === 'RACE_TO' ? select('raceTo', 'Points to win', [1, 2, 3, 4, 5, 6, 7], values.raceTo) : select('matchMinutes', 'Match time (minutes)', [3, 5, 7, 10, 12, 15, 20, 25, 30, 45, 60], values.matchMinutes)}${!duel ? select('playersPerTeam', 'Players per team', Array.from({ length: 20 }, (_, i) => i + 1), values.playersPerTeam) : ''}${advanced(`${select('equipment', 'Equipment', ['Mech', 'Electronic', 'Pump', 'Airsoft', 'Mixed'], values.equipment)}${select('fieldType', 'Playing field', ['Airball', 'Hyperball', 'Woods', 'Urban'], values.fieldType)}${kind === 'SCRIMMAGE' ? select('deckStyle', 'Deck style', [['SINGLE', 'Single deck'], ['SPLIT', 'Split deck']], values.deckStyle) : ''}${select('timeoutsPerTeam', 'Timeouts per team', [0, 1, 2, 3, 4, 5], values.timeoutsPerTeam)}${select('timeoutSeconds', 'Timeout duration', [30, 60, 90, 120].map(n => [n, `${n} seconds`]), values.timeoutSeconds)}${select('breakSeconds', 'Between points', [20, 30, 60, 90, 120, 180, 300].map(n => [n, `${n} seconds`]), values.breakSeconds)}${select('penaltyRules', 'Penalty rules', rules, values.penaltyRules)}`)}${kind === 'CHALLENGE' && !duel && team ? `<fieldset class="setup-full setup-roster"><legend>Your starting roster — choose ${h(values.playersPerTeam)}</legend>${team.members.map(member => `<label><input type="checkbox" data-setup-player value="${h(member.userId)}"${values.playerIds.includes(member.userId) ? ' checked' : ''}> ${h(member.name)}</label>`).join('')}</fieldset>` : ''}`;
    body.innerHTML = `<h2>Set up ${h(labels[kind].toLowerCase())}</h2><p class="form-note">${kind === 'TOURNAMENT' ? 'Publish a GameTime event with your field, teams, opening schedule and shared event code.' : kind === 'SCRIMMAGE' ? 'Post a real request from your PBN team. The opposing Coach responds in GameTime, and both Coaches confirm the final rules before play.' : 'Choose a real opponent and agreed match rules. Review your entry and send the invitation in GameTime before any match starts.'}</p><fieldset class="setup-fields"><div class="field-grid">${select('fieldId', 'GameTime venue', [['', 'Choose a field'], ...context.fields.map(field => [field.id, field.name])], values.fieldId)}${input('date', kind === 'TOURNAMENT' ? 'First event day' : 'Match day', values.date, 'date', 'required')}${input('time', 'Start time at the venue', values.time, 'time', 'required')}${select('timezone', 'Venue time zone', zones, values.timezone)}${terms}</div></fieldset>${!context.teams.length && (kind === 'SCRIMMAGE' || kind === 'CHALLENGE' && !duel) ? `<p class="form-note">You need a PBN team with a Coach role. <a href="${h(link('/my-team'))}" target="_blank" rel="noreferrer">Manage your teams in GameTime ↗</a></p>` : ''}<p class="form-error" role="alert">${h(error)}</p><button class="primary wide" type="button" data-setup-action="save"${busy ? ' disabled' : ''}>${busy ? 'SAVING…' : kind === 'TOURNAMENT' ? 'CREATE GAMETIME EVENT' : kind === 'SCRIMMAGE' ? 'CREATE SCRIMMAGE REQUEST' : 'CREATE CHALLENGE DRAFT'}</button>`;
  }
  async function findOpponents() {
    if (kind !== 'CHALLENGE' || !context || getPending()) return;
    const sequence = ++lookup, run = turn;
    try {
      const duel = values.challengeKind === 'DUEL';
      const query = new URLSearchParams(duel ? { source: values.source, ...(values.source === 'favorites' && values.opponentFieldId ? { fieldId: values.opponentFieldId } : {}) } : { q: values.search || '' });
      const data = await request(duel ? 'coins/opponents?' + query : 'teams?' + query);
      if (!current() || sequence !== lookup || run !== turn) return;
      opponents = (duel ? data.players : data.search || []).filter(item => item.id !== values.teamId);
      opponentFields = data.favoriteFields || [];
      if (duel && values.source === 'favorites') values.opponentFieldId = data.selectedFieldId || '';
      if (!opponents.some(item => item.id === values.opponentId)) values.opponentId = '';
      error = ''; render();
    } catch (cause) { if (current() && sequence === lookup && run === turn) { error = cause.message; render(); } }
  }
  async function load() {
    const run = ++turn; loading = true; error = ''; render();
    try {
      const data = await request('controller-setups/context');
      if (!current() || run !== turn) return;
      context = data; values.teamId ||= data.teams[0]?.id || ''; values.entry ||= data.entryTiers[0]; loading = false; render();
      if (kind === 'CHALLENGE') await findOpponents();
    } catch (cause) { if (current() && run === turn) { loading = false; error = cause.message; render(); } }
  }
  function payload() {
    collect();
    if (!values.fieldId) throw Error('Choose a registered GameTime field.');
    for (const node of body.querySelectorAll('input[required], textarea[required]')) { if (!node.checkValidity()) { const section = node.closest('details'); if (section) section.open = true; node.reportValidity(); throw Error('Complete the highlighted field.'); } }
    const common = { requestId: crypto.randomUUID(), kind, fieldId: values.fieldId, date: values.date, time: values.time, timezone: values.timezone };
    if (kind === 'TOURNAMENT') {
      const teams = values.teams.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
      if (teams.length < 2 || teams.length > 64 || teams.some(name => name.length > 80) || new Set(teams.map(name => name.toLowerCase())).size !== teams.length) throw Error('Add 2–64 different team names, one per line (up to 80 letters each).');
      if (values.deckStyle === 'SPLIT' && teams.length < 4) throw Error('Split deck needs at least four teams.');
      return { ...common, name: values.name.trim(), teams, endDate: values.endDate, format: values.format, raceTo: +values.raceTo, deckStyle: values.deckStyle, visibility: values.visibility };
    }
    const duel = kind === 'CHALLENGE' && values.challengeKind === 'DUEL';
    if (!duel && !values.teamId) throw Error('Choose a PBN team that you coach.');
    if (kind === 'CHALLENGE' && !values.opponentId) throw Error('Choose an opposing player or team.');
    if (kind === 'CHALLENGE' && !duel && values.playerIds.length !== +values.playersPerTeam) throw Error(`Choose exactly ${values.playersPerTeam} players for your roster.`);
    const terms = { fieldId: values.fieldId, equipment: values.equipment, equipmentOther: '', fieldType: values.fieldType, fieldTypeOther: '', mode: values.mode, raceTo: values.mode === 'RACE_TO' ? +values.raceTo : null, matchMinutes: values.mode === 'TIMED' ? +values.matchMinutes : null, playersPerTeam: duel ? 1 : +values.playersPerTeam, deckStyle: kind === 'CHALLENGE' ? 'SINGLE' : values.deckStyle, timeoutsPerTeam: +values.timeoutsPerTeam, timeoutSeconds: +values.timeoutSeconds, breakSeconds: +values.breakSeconds, penaltyRules: values.penaltyRules, notes: '', layoutAssetId: null };
    return { ...common, teamId: values.teamId, terms, ...(kind === 'CHALLENGE' ? { challengeKind: values.challengeKind, opponentId: values.opponentId, entry: +values.entry, playerIds: values.playerIds } : {}) };
  }
  async function submit() {
    if (busy || !current()) return;
    let command;
    try { command = getPending() || payload(); } catch (cause) { error = cause.message; render(); return; }
    const run = turn; setPending(command); busy = true; error = ''; render();
    try {
      const result = await request('controller-setups', { method: 'POST', body: JSON.stringify(command) });
      if (!current() || run !== turn) return;
      setPending(null); receipt = result; busy = false; render(); await saved(result);
    } catch (cause) {
      if (!current() || run !== turn) return;
      busy = false; error = cause.message;
      // Validation failures occur before creation. Uncertain saves keep the exact request for retry.
      if ([400, 403, 404, 422].includes(cause.status)) {
        setPending(null);
        if (!context) { const message = error; await load(); if (!current() || run !== turn - 1) return; error = message; }
      }
      render();
    }
  }
  body.addEventListener('click', event => {
    const action = event.target.closest('[data-setup-action]')?.dataset.setupAction;
    if (!action) return;
    event.preventDefault(); event.stopPropagation();
    if (action === 'save') void submit();
    else if (action === 'search') { collect(); void findOpponents(); }
    else if (action === 'reload') void load();
    else if (action === 'open' && receipt?.canControl) { modal.close(); void openController(receipt.id); }
  });
  body.addEventListener('change', event => {
    if (!event.target.matches('[data-setup-key]') || busy || getPending()) return;
    const previousDate = values.date;
    collect();
    const key = event.target.dataset.setupKey;
    if (key === 'date' && (values.endDate === previousDate || values.endDate < values.date)) values.endDate = values.date;
    if (key === 'teamId') { values.playerIds = []; values.opponentId = ''; }
    if (['challengeKind', 'source', 'opponentFieldId'].includes(key)) { values.opponentId = ''; opponents = []; render(); void findOpponents(); }
    else if (['mode', 'teamId', 'playersPerTeam', 'date'].includes(key)) render();
  });
  return {
    async show(nextKind) {
      if (busy && current()) { if (!modal.open) modal.showModal(); return; }
      account = stamp(); kind = nextKind; context = null; receipt = null; opponents = []; opponentFields = []; error = ''; busy = false;
      const tomorrow = new Date(Date.now() + 86400000), date = [tomorrow.getFullYear(), String(tomorrow.getMonth() + 1).padStart(2, '0'), String(tomorrow.getDate()).padStart(2, '0')].join('-');
      values = { name: '', teams: '', date, endDate: date, time: '09:00', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago', fieldId: '', teamId: '', challengeKind: 'DUEL', source: 'friends', opponentFieldId: '', opponentId: '', search: '', playerIds: [], entry: '', visibility: 'PUBLIC', format: 'Race-to', raceTo: '3', deckStyle: 'SINGLE', mode: 'RACE_TO', matchMinutes: '10', playersPerTeam: '5', equipment: 'Electronic', fieldType: 'Airball', timeoutsPerTeam: '1', timeoutSeconds: '60', breakSeconds: '120', penaltyRules: rules[0][0] };
      const pending = getPending();
      if (pending) { kind = pending.kind; values = { ...values, ...pending, ...pending.terms, teams: Array.isArray(pending.teams) ? pending.teams.join('\n') : '', playerIds: pending.playerIds || [] }; }
      render(); if (!modal.open) modal.showModal();
      if (!pending) await load();
    }
  };
}

