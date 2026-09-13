(() => {
  "use strict";

  const STORAGE_KEY = "pbn_game_time_controller_v3";
  const EVENT_LOG_KEY = "pbn_game_time_action_log_v1";
  const $ = (selector) => document.querySelector(selector);
  const app = $("#app");
  const modal = $("#modal");
  const modalBody = $("#modalBody");
  const now = () => new Date().toISOString();
  const clone = (value) => JSON.parse(JSON.stringify(value));

  const defaultState = {
    version: 3,
    authenticated: false,
    route: "login",
    connection: { configured: false, name: "PBN Backend", baseUrl: "" },
    audio: { countdownCue: "scoreboard-beep" },
    operator: { name: "Demo Operator", role: "Event Director" },
    session: { active: false, type: null, label: null, format: null, pointLimit: null, deckStyle: null },
    league: { id: "league-demo", name: "PBN Demo League", season: "2026 Season" },
    event: { id: "event-demo", name: "Fall Championship", date: "Sep 19–20, 2026", venue: "PBN Field Complex", format: "Race-to preset", status: "Draft" },
    divisions: [{ id: "d1", name: "Open X-Ball", teams: 8, format: "Race-to-4" }, { id: "d2", name: "3v3 Novice", teams: 6, format: "Race-to-2" }],
    teams: ["RED LEGION", "DAMAGE", "AFTERMATH", "DYNASTY", "IMPACT", "HEAT", "INFAMOUS", "REBELS"],
    fields: [{ id: "f1", name: "Field 1", pitLeft: "Pit 1", pitRight: "Pit 2" }, { id: "f2", name: "Field 2", pitLeft: "Pit 3", pitRight: "Pit 4" }],
    staff: [{ name: "Brady", role: "Event Director" }, { name: "Unassigned", role: "Field Referee" }, { name: "Unassigned", role: "Broadcast Crew" }],
    schedule: [
      { id: "m1", time: "9:00 AM", field: "Field 1", left: "RED LEGION", right: "DAMAGE", status: "On deck" },
      { id: "m2", time: "9:20 AM", field: "Field 1", left: "AFTERMATH", right: "DYNASTY", status: "Scheduled" },
      { id: "m3", time: "9:40 AM", field: "Field 1", left: "IMPACT", right: "HEAT", status: "Scheduled" },
      { id: "m4", time: "10:00 AM", field: "Field 1", left: "INFAMOUS", right: "REBELS", status: "Scheduled" },
      { id: "m5", time: "10:20 AM", field: "Field 1", left: "DAMAGE", right: "AFTERMATH", status: "Scheduled" }
    ],
    standings: [
      { team: "RED LEGION", w: 2, l: 0, diff: 5 }, { team: "DYNASTY", w: 2, l: 0, diff: 3 },
      { team: "DAMAGE", w: 1, l: 1, diff: 1 }, { team: "IMPACT", w: 1, l: 1, diff: 0 }
    ],
    controller: {
      phase: "READY",
      gameMs: 600000,
      breakMs: 120000,
      breakDefaultMs: 120000,
      activeAnchor: null,
      activeMatch: { id: "m1", leftTeamId: "m1-left", rightTeamId: "m1-right", leftTeam: "RED LEGION", rightTeam: "DAMAGE", leftScore: 0, rightScore: 0, leftPhysicalTeamId: "m1-left", rightPhysicalTeamId: "m1-right", leftPhysicalTeam: "RED LEGION", rightPhysicalTeam: "DAMAGE", gameMs: 600000 },
      inactiveMatch: { id: "m2", leftTeamId: "m2-left", rightTeamId: "m2-right", leftTeam: "AFTERMATH", rightTeam: "DYNASTY", leftScore: 0, rightScore: 0, leftPhysicalTeamId: "m2-left", rightPhysicalTeamId: "m2-right", leftPhysicalTeam: "AFTERMATH", rightPhysicalTeam: "DYNASTY", gameMs: 600000 },
      pendingBaseSide: null,
      pointHistory: [],
      undoStack: [],
      lastAnnouncement: null
    },
    scheduleDraft: { step: 1, days: 2, fields: 2, start: "09:00", matchMinutes: 20, breaks: "Lunch at 12:00", generated: false, published: false, version: 1 },
    activity: [],
    sync: { pending: 0, lastSync: null }
  };

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || saved.version !== 3) return clone(defaultState);
      return { ...clone(defaultState), ...saved, controller: { ...clone(defaultState.controller), ...(saved.controller || {}) } };
    } catch { return clone(defaultState); }
  }

  let state = loadState();
  let frame = null;
  let clockPickerMode = "jump";
  let audioContext = null;
  let cuePlayer = null;
  let cuePlayerName = null;

  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function getLog() { try { return JSON.parse(localStorage.getItem(EVENT_LOG_KEY)) || []; } catch { return []; } }
  function logAction(type, payload = {}) {
    const entry = { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, at: now(), type, payload, syncStatus: state.connection.configured ? "pending" : "local-only" };
    const log = [...getLog(), entry].slice(-500);
    localStorage.setItem(EVENT_LOG_KEY, JSON.stringify(log));
    state.activity = log.slice(-30).reverse();
    if (state.connection.configured) state.sync.pending += 1;
    save();
    return entry;
  }
  function toast(message) { const el = $("#toast"); el.textContent = message; el.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2200); }
  function formatMs(ms) { const total = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; }
  function spokenDuration(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    const parts = [];
    if (minutes) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
    if (seconds) parts.push(`${seconds} ${seconds === 1 ? "second" : "seconds"}`);
    return parts.join(" and ") || "zero seconds";
  }
  function route(name) { stopFrame(); state.route = name; save(); render(); }
  function nav(active) {
    return `<nav class="bottom-nav" aria-label="Primary navigation">
      <button data-route="command-home" class="${active === "command-home" ? "active" : ""}"><span>⌂</span>Home</button>
      <button data-route="master-schedule" class="${active === "master-schedule" ? "active" : ""}"><span>▤</span>Schedule</button>
      <button data-route="live-controller" class="${active === "live-controller" ? "active" : ""}"><span>◉</span>Control</button>
      <button data-route="settings" class="${active === "settings" ? "active" : ""}"><span>⚙</span>Settings</button>
    </nav>`;
  }
  function topbar(title, back = "event-dashboard") { return `<header class="topbar"><button class="icon-btn" data-route="${back}" aria-label="Back">←</button><h1>${title}</h1><span class="status ${state.connection.configured ? "good" : "warn"}">${state.connection.configured ? "SYNCED" : "OFFLINE"}</span></header>`; }
  function page(content, active, className = "") { app.innerHTML = `<div class="app-shell"><section class="screen ${className}">${content}</section>${active ? nav(active) : ""}</div>`; }

  const pageDefinitions = {
    "login": renderLogin,
    "command-home": renderCommandHome,
    "leagues": renderLeagues,
    "league-home": renderLeagueHome,
    "event-dashboard": renderDashboard,
    "event-settings": () => renderFormPage("Event Settings", [
      ["Event name", state.event.name], ["Date", state.event.date], ["Venue", state.event.venue], ["Scoring preset", state.event.format]
    ]),
    "schedule-builder": renderScheduleBuilder,
    "master-schedule": renderMasterSchedule,
    "live-controller": renderController,
    "standings": renderStandings,
    "playoffs": renderPlayoffs,
    "teams": renderTeams,
    "divisions": renderDivisions,
    "fields": renderFields,
    "staff": renderStaff,
    "activity": renderActivity,
    "publishing": renderPublishing,
    "settings": renderSettings
  };

  function render() { (pageDefinitions[state.route] || renderLogin)(); }

  function renderLogin() {
    page(`<div style="padding-top:18vh;text-align:center"><div class="brand">PBN</div><p class="subtitle">GAME TIME CONTROLLER</p><section class="card hero" style="text-align:left;margin-top:42px"><span class="eyebrow">OPERATOR ACCESS</span><h2>Run the event.</h2><p>Sign in when the PBN backend is ready, or enter the safe offline demo now.</p><button class="primary wide" data-action="demo-login">ENTER OFFLINE DEMO</button><button class="secondary wide" style="margin-top:10px" data-action="connection">CONNECT PBN BACKEND</button></section></div>`, null);
  }
  function renderCommandHome() {
    const session = state.session || defaultState.session;
    page(`<div class="command-head"><div class="brand">PBN</div><p class="subtitle">GAME TIME CONTROLLER</p></div>
      ${session.active ? `<section class="active-session"><span class="live-dot"></span><div><span class="eyebrow">ACTIVE ${session.type === "scrimmage" ? "SCRIMMAGE" : "EVENT"}</span><h2>${session.label || "Controller session"}</h2><p>Your clock and scores are saved on this device.</p></div><button class="primary" data-route="live-controller">RETURN TO CONTROLLER</button></section>` : `
      <section class="command-intro"><span class="eyebrow">EVENT COMMAND</span><h1>What are you running?</h1><p>Choose the fast scrimmage setup or prepare a complete scheduled event.</p></section>
      <button class="command-choice quick" data-action="open-scrimmage"><span class="choice-icon">▶</span><span><strong>START A SCRIMMAGE</strong><small>Pick a format, name the teams, and start playing</small></span><b>›</b></button>
      <button class="command-choice" data-route="event-dashboard"><span class="choice-icon">▤</span><span><strong>SET UP A FULL EVENT</strong><small>Schedule, divisions, fields, staff, and publishing</small></span><b>›</b></button>`}
      <section class="recent-event"><div class="section-title"><h2>Planned event</h2><span class="status warn">${state.event.status.toUpperCase()}</span></div><button class="event-summary" data-route="event-dashboard"><div><span class="eyebrow">${state.league.name}</span><strong>${state.event.name}</strong><small>${state.event.date} · ${state.event.venue}</small></div><b>CONTINUE ›</b></button></section>`, "command-home", "command-screen");
  }
  function renderLeagues() {
    page(`${topbar("My Leagues", "login")}<section class="card hero"><span class="eyebrow">CURRENT ORGANIZATION</span><h2>${state.league.name}</h2><p>${state.league.season} · one event ready for testing</p><button class="primary wide" data-route="league-home">OPEN LEAGUE</button></section><div class="section-title"><h2>Other leagues</h2></div><div class="card empty">Connect the PBN backend to load additional organizations.</div>`, null);
  }
  function renderLeagueHome() {
    page(`${topbar(state.league.name, "leagues")}<section class="card hero"><span class="eyebrow">${state.league.season}</span><h2>${state.event.name}</h2><p>${state.event.date} · ${state.event.venue}</p><button class="primary wide" data-route="event-dashboard">OPEN EVENT</button></section><div class="section-title"><h2>League actions</h2></div><div class="grid"><button class="menu-card" data-route="teams"><span class="count">${state.teams.length}</span><strong>Teams</strong><small>Review event teams</small></button><button class="menu-card" data-route="divisions"><span class="count">${state.divisions.length}</span><strong>Divisions</strong><small>Formats and assignments</small></button></div>`, null);
  }
  function renderDashboard() {
    const next = state.schedule[0];
    const steps = eventSetupSteps();
    const complete = steps.filter(step => step.done).length;
    const nextStep = steps.find(step => !step.done) || steps[steps.length - 1];
    page(`${topbar("Event Command", "command-home")}<section class="event-command-hero"><div><span class="eyebrow">${state.event.status} · ${state.event.date}</span><h2>${state.event.name}</h2><p>${state.event.venue}</p></div><button class="run-event" data-action="run-event">▶ RUN EVENT</button></section>
      <div class="section-title"><h2>Up next</h2><span class="status">${next.time}</span></div><button class="next-match" data-action="run-event"><div><strong>${next.left} vs ${next.right}</strong><small>${next.field} · ${next.status}</small></div><span>OPEN CONTROLLER ›</span></button>
      <div class="readiness-head"><div><span class="eyebrow">EVENT READINESS</span><h2>${complete} of ${steps.length} complete</h2></div><strong>${Math.round(complete / steps.length * 100)}%</strong></div><div class="readiness-bar"><span style="width:${complete / steps.length * 100}%"></span></div>
      <section class="setup-path">${steps.map((step, index) => `<button class="setup-step ${step.done ? "done" : index === steps.indexOf(nextStep) ? "current" : ""}" data-route="${step.route}"><i>${step.done ? "✓" : index + 1}</i><span><strong>${step.title}</strong><small>${step.detail}</small></span><b>›</b></button>`).join("")}</section>
      <button class="primary wide continue-setup" data-route="${nextStep.route}">CONTINUE WHERE I LEFT OFF</button>
      <details class="event-tools"><summary>More event tools</summary><div><button data-route="standings">Scores & standings</button><button data-route="playoffs">Playoffs</button><button data-route="activity">Activity log</button><button data-route="settings">Recovery & connection</button></div></details>`, "command-home", "event-command-screen");
  }
  function eventSetupSteps() {
    const assignedStaff = state.staff.filter(person => person.name !== "Unassigned").length;
    return [
      { title: "Event details", detail: "Format, dates, venue, and rules", route: "event-settings", done: Boolean(state.event.name && state.event.date && state.event.venue) },
      { title: "Teams & divisions", detail: `${state.teams.length} teams · ${state.divisions.length} divisions`, route: "teams", done: state.teams.length >= 2 && state.divisions.length >= 1 },
      { title: "Build schedule", detail: state.scheduleDraft.generated ? `${state.schedule.length} matches generated` : "Generate and review match times", route: state.scheduleDraft.generated ? "master-schedule" : "schedule-builder", done: state.scheduleDraft.generated },
      { title: "Fields & pits", detail: `${state.fields.length} fields configured`, route: "fields", done: state.fields.length >= 1 },
      { title: "Staff & broadcast", detail: assignedStaff === state.staff.length ? "All roles assigned" : `${state.staff.length - assignedStaff} roles need attention`, route: "staff", done: assignedStaff === state.staff.length },
      { title: "Publish event", detail: state.scheduleDraft.published ? "Schedule and event are live" : "Publish when setup is ready", route: "publishing", done: state.scheduleDraft.published }
    ];
  }
  function menu(target, count, title, text) { return `<button class="menu-card" data-route="${target}"><span class="count">${count}</span><strong>${title}</strong><small>${text}</small></button>`; }
  function renderFormPage(title, fields) {
    page(`${topbar(title)}<section class="card"><div class="field-grid">${fields.map(([label, value]) => `<div class="field"><label>${label}</label><input value="${value}" aria-label="${label}"></div>`).join("")}</div><button class="primary wide" style="margin-top:16px" data-action="save-form">SAVE CHANGES</button></section>`, "settings");
  }
  function renderScheduleBuilder() {
    const d = state.scheduleDraft;
    page(`${topbar("Schedule Builder")}<div class="steps">${[1,2,3,4].map(n => `<i class="${n <= d.step ? "on" : ""}"></i>`).join("")}</div><section class="card"><span class="eyebrow">STEP ${d.step} OF 4</span>${scheduleStep(d)}<div class="button-row">${d.step > 1 ? `<button class="secondary" data-action="schedule-back">BACK</button>` : ""}<button class="primary" data-action="schedule-next">${d.step === 4 ? "GENERATE SCHEDULE" : "CONTINUE"}</button></div></section>`, "master-schedule");
  }
  function scheduleStep(d) {
    if (d.step === 1) return `<h2>Event structure</h2><div class="field-grid"><div class="field"><label>Event days</label><input id="draftDays" type="number" value="${d.days}"></div><div class="field"><label>Active fields</label><input id="draftFields" type="number" value="${d.fields}"></div></div>`;
    if (d.step === 2) return `<h2>Match timing</h2><div class="field-grid"><div class="field"><label>First match</label><input id="draftStart" type="time" value="${d.start}"></div><div class="field"><label>Minutes per slot</label><input id="draftMinutes" type="number" value="${d.matchMinutes}"></div></div>`;
    if (d.step === 3) return `<h2>Constraints</h2><div class="field-grid"><div class="field"><label>Required breaks</label><input id="draftBreaks" value="${d.breaks}"></div><div class="field"><label>Rest protection</label><select><option>Minimum one match slot</option><option>Minimum two match slots</option></select></div></div>`;
    return `<h2>Review schedule health</h2><div class="list"><div class="list-row"><div><strong>Team rest</strong><small>No back-to-back conflicts detected</small></div><span class="status good">PASS</span></div><div class="list-row"><div><strong>Field capacity</strong><small>${d.fields} fields across ${d.days} days</small></div><span class="status good">PASS</span></div><div class="list-row"><div><strong>Published protection</strong><small>Future edits create a new version</small></div><span class="status good">ON</span></div></div>`;
  }
  function renderMasterSchedule() {
    page(`${topbar("Master Schedule")}<section class="card"><div class="section-title" style="margin-top:0"><h2>Schedule v${state.scheduleDraft.version}</h2><span class="status ${state.scheduleDraft.published ? "good" : "warn"}">${state.scheduleDraft.published ? "PUBLISHED" : "DRAFT"}</span></div><div class="list">${state.schedule.map(matchRow).join("")}</div><div class="button-row"><button class="secondary" data-route="schedule-builder">EDIT VERSION</button><button class="primary" data-action="publish-schedule">PUBLISH</button></div></section>`, "master-schedule");
  }
  function matchRow(m) { return `<div class="list-row"><div><strong>${m.left} vs ${m.right}</strong><small>${m.time} · ${m.field}</small></div><span class="status">${m.status}</span></div>`; }

  function renderController() {
    const singleDeck = state.session?.type === "scrimmage" && state.session.deckStyle !== "split";
    const splitScrimmage = state.session?.type === "scrimmage" && state.session.deckStyle === "split";
    const nextRows = splitScrimmage
      ? `<div class="next-row"><span>${state.controller.inactiveMatch.leftTeam}</span><b>VS</b><span>${state.controller.inactiveMatch.rightTeam}</span><span>ON DECK</span></div>`
      : state.schedule.slice(1,6).map(m => `<div class="next-row"><span>${m.left}</span><b>VS</b><span>${m.right}</span><span>${m.time}</span></div>`).join("");
    page(`<div class="controller-bg"><header class="controller-head"><button class="reset-preview" data-action="undo" aria-label="Undo last controller action" title="Undo last action">↶</button><h1 class="brand">PBN</h1><p class="subtitle">GAME TIME CONTROLLER</p></header>
      ${singleDeck ? `<div class="controller-mode">SINGLE DECK SCRIMMAGE</div>` : `<section class="scorebug"><span class="team">${state.controller.inactiveMatch.leftTeam}</span><strong class="score">${state.controller.inactiveMatch.leftScore}</strong><span class="clock">${formatMs(state.controller.inactiveMatch.gameMs)}</span><strong class="score">${state.controller.inactiveMatch.rightScore}</strong><span class="team">${state.controller.inactiveMatch.rightTeam}</span></section>`}
      <section class="active-game"><span class="pit-label left">PIT 1</span><span class="pit-label right">PIT 2</span><div class="match-grid"><div class="team-panel"><h3>${state.controller.activeMatch.leftPhysicalTeam}</h3><strong>${scoreForPhysical("left")}</strong></div><div class="clock-panel"><span class="clock-label">GAME TIME</span><strong id="gameClock" class="game-clock">${formatMs(state.controller.gameMs)}</strong><button id="breakClock" class="break-clock ${state.controller.breakMs <= 10000 && state.controller.breakMs > 0 ? "warning" : ""}" data-action="set-break" aria-label="Set break clock">${formatMs(state.controller.breakMs)}</button></div><div class="team-panel"><h3>${state.controller.activeMatch.rightPhysicalTeam}</h3><strong>${scoreForPhysical("right")}</strong></div></div></section>
      <div class="controls"><div class="score-control"><button data-action="score-minus" data-side="left">−</button><button data-action="score-plus" data-side="left">＋</button></div><button class="pause" data-action="pause">${state.controller.phase === "BREAK_PAUSED" || state.controller.phase === "GAME_PAUSED" ? "▶ RESUME" : "Ⅱ&nbsp; PAUSE"}</button><div class="score-control"><button data-action="score-plus" data-side="right">＋</button><button data-action="score-minus" data-side="right">−</button></div></div>
      ${controllerMainButton()}${state.controller.phase === "POINT_STOPPED_WAITING_DECISION" ? decisionPanel() : ""}
      ${singleDeck ? "" : `<section class="controller-card"><h2>NEXT UP</h2>${nextRows}</section>`}
      <div class="controller-nav"><button data-route="command-home">HOME</button>${state.session?.type === "event" ? `<button data-route="master-schedule">FULL SCHEDULE</button><button data-route="standings">STANDINGS</button>` : ""}</div></div>`, null, "controller-screen");
    startFrame();
  }
  function scoreForPhysical(side) {
    const match = state.controller.activeMatch;
    const teamId = side === "left" ? match.leftPhysicalTeamId : match.rightPhysicalTeamId;
    return teamId === match.leftTeamId ? match.leftScore : match.rightScore;
  }
  function controllerMainButton() {
    const phase = state.controller.phase;
    if (phase === "READY") return `<button class="main-command" data-action="start-break">▶ START BREAK</button>`;
    if (phase === "BREAK_PAUSED") return `<button class="main-command base" disabled><span>BREAK PAUSED</span><small>PRESS RESUME TO CONTINUE</small></button>`;
    if (phase === "POINT_LIVE" || phase === "GAME_PAUSED") return `<div class="base-pair"><button class="main-command base" data-action="base" data-side="left"><span>⚑ LEFT BASE</span><small>STOP GAME CLOCK</small></button><button class="main-command base" data-action="base" data-side="right"><span>RIGHT BASE ⚑</span><small>STOP GAME CLOCK</small></button></div>`;
    if (phase === "BREAK_RUNNING") return `<button class="main-command base" data-action="base" disabled><span>BREAK RUNNING</span><small style="display:block;font-size:8px">GAME STARTS AT 00:00</small></button>`;
    return `<button class="main-command base" disabled>POINT STOPPED</button>`;
  }
  function decisionPanel() { return `<section class="decision"><h3>${state.controller.pendingBaseSide?.toUpperCase()} BASE · DECISION</h3><div class="decision-grid"><button class="approve" data-action="approve-point">APPROVE POINT</button><button class="reverse" data-action="reverse-point">REVERSE POINT</button><button class="no-point" data-action="no-point">NO POINT</button></div><button class="secondary wide" style="margin-top:8px;min-height:38px" data-action="undo">UNDO LAST ACTION</button></section>`; }

  function renderStandings() { page(`${topbar("Scores & Standings")}<section class="card"><span class="eyebrow">LIVE · OPEN X-BALL</span><div class="list">${state.standings.map((s,i) => `<div class="list-row"><strong style="width:22px">${i+1}</strong><div><strong>${s.team}</strong><small>${s.w} W · ${s.l} L</small></div><span class="status ${i<2?"good":""}">${s.diff >= 0 ? "+" : ""}${s.diff}</span></div>`).join("")}</div></section>`, "event-dashboard"); }
  function renderPlayoffs() { page(`${topbar("Playoffs")}<section class="card"><span class="eyebrow">PROJECTED · NOT OFFICIAL</span><h2>Semifinals</h2><div class="list"><div class="list-row"><div><strong>1 RED LEGION vs 4 IMPACT</strong><small>Projected from current standings</small></div></div><div class="list-row"><div><strong>2 DYNASTY vs 3 DAMAGE</strong><small>Projected from current standings</small></div></div></div><button class="primary wide" style="margin-top:16px" data-action="finalize-playoffs">FINALIZE WHEN QUALIFYING ENDS</button></section>`, "event-dashboard"); }
  function renderTeams() { page(`${topbar("Teams")}<div class="list">${state.teams.map((t,i) => `<button class="list-row" data-action="team-detail"><strong style="width:24px">${i+1}</strong><div><strong>${t}</strong><small>Roster managed in future player app</small></div><span>›</span></button>`).join("")}</div>`, "event-dashboard"); }
  function renderDivisions() { page(`${topbar("Divisions")}<div class="list">${state.divisions.map(d => `<button class="list-row"><div><strong>${d.name}</strong><small>${d.teams} teams · ${d.format}</small></div><span>›</span></button>`).join("")}</div>`, "event-dashboard"); }
  function renderFields() { page(`${topbar("Fields & Pits")}<div class="list">${state.fields.map(f => `<button class="list-row"><div><strong>${f.name}</strong><small>${f.pitLeft} · ${f.pitRight}</small></div><span class="status good">ACTIVE</span></button>`).join("")}</div>`, "event-dashboard"); }
  function renderStaff() { page(`${topbar("Staff")}<div class="list">${state.staff.map(s => `<button class="list-row"><div><strong>${s.name}</strong><small>${s.role}</small></div><span>›</span></button>`).join("")}</div><div class="card empty" style="margin-top:12px">Backend connection will provide invitations and permission assignments.</div>`, "event-dashboard"); }
  function renderActivity() { const log = getLog(); page(`${topbar("Activity Log")}<section class="card"><span class="eyebrow">APPEND-ONLY LOCAL AUDIT</span><div class="list">${log.length ? log.slice().reverse().map(a => `<div class="list-row"><div><strong>${a.type.replaceAll("_", " ")}</strong><small>${new Date(a.at).toLocaleString()}</small></div><span class="status">${a.syncStatus}</span></div>`).join("") : `<div class="empty">Actions will appear here immediately, even offline.</div>`}</div></section>`, "event-dashboard"); }
  function renderPublishing() { page(`${topbar("Publishing Center")}<section class="card"><span class="eyebrow">PUBLIC OUTPUTS</span><div class="list"><div class="list-row"><div><strong>Public schedule</strong><small>Awaiting backend URL</small></div><span class="status warn">NOT CONNECTED</span></div><div class="list-row"><div><strong>Live scores</strong><small>Local controller state ready</small></div><span class="status good">READY</span></div><div class="list-row"><div><strong>PBNetwork.tv overlay</strong><small>Contract placeholder included</small></div><span class="status">SCAFFOLDED</span></div></div></section>`, "event-dashboard"); }
  function renderSettings() { page(`${topbar("Settings & Recovery")}<section class="card"><span class="eyebrow">AUDIO CUES</span><h2>Countdown sound</h2><p class="muted">Choose a sound. Each choice plays immediately so you can compare it.</p><div class="field"><label>Countdown beep</label><select id="countdownCue"><option value="scoreboard-beep" ${state.audio?.countdownCue === "scoreboard-beep" ? "selected" : ""}>Sharp electronic scoreboard</option><option value="referee-timer-beep" ${state.audio?.countdownCue === "referee-timer-beep" ? "selected" : ""}>Clean referee timer</option><option value="tournament-beep" ${state.audio?.countdownCue === "tournament-beep" ? "selected" : ""}>Loud tournament start system</option></select></div></section><section class="card" style="margin-top:12px"><span class="eyebrow">CONNECTION</span><h2>${state.connection.name}</h2><p class="muted">${state.connection.configured ? state.connection.baseUrl : "No backend configured. All test actions remain safely on this device."}</p><button class="primary wide" data-action="connection">${state.connection.configured ? "UPDATE CONNECTION" : "SET UP CONNECTION"}</button></section><section class="card" style="margin-top:12px"><span class="eyebrow">RECOVERY</span><h2>Local event package</h2><p class="muted">${getLog().length} logged actions · ${state.sync.pending} awaiting sync</p><div class="button-row"><button class="secondary" data-action="export-log">EXPORT LOG</button><button class="danger" data-action="reset-all">RESET DEMO</button></div></section>`, "settings"); }

  function startFrame() { stopFrame(); const tick = () => { updateClocks(); frame = requestAnimationFrame(tick); }; frame = requestAnimationFrame(tick); }
  function stopFrame() { if (frame) cancelAnimationFrame(frame); frame = null; }
  function startAnchor(kind, ms) { state.controller.activeAnchor = { kind, startedAt: Date.now(), startingMs: ms }; save(); }
  function anchoredRemaining(anchor) { return Math.max(0, anchor.startingMs - (Date.now() - anchor.startedAt)); }
  function updateClocks() {
    const c = state.controller;
    if (!c.activeAnchor) return;
    const remaining = anchoredRemaining(c.activeAnchor);
    if (c.activeAnchor.kind === "break") {
      c.breakMs = remaining;
      const el = $("#breakClock"); if (el) { el.textContent = formatMs(remaining); el.classList.toggle("warning", remaining <= 10000 && remaining > 0); }
      announceCountdown(remaining);
      if (remaining <= 0) {
        c.breakMs = 0;
        if (c.lastAnnouncement !== 0) { c.lastAnnouncement = 0; playCue("game-start-horn", synthHorn, () => speak("Game started")); }
        c.phase = "POINT_LIVE";
        startAnchor("game", c.gameMs);
        logAction("GAME_CLOCK_AUTO_STARTED", { gameMs: c.gameMs });
        renderController();
      }
    } else if (c.activeAnchor.kind === "game") {
      c.gameMs = remaining; c.activeMatch.gameMs = remaining;
      const el = $("#gameClock"); if (el) el.textContent = formatMs(remaining);
      if (remaining <= 0) { c.gameMs = 0; c.phase = "MATCH_COMPLETE"; c.activeAnchor = null; logAction("GAME_CLOCK_EXPIRED"); save(); renderController(); }
    }
    save();
  }
  function announceCountdown(ms) {
    const seconds = Math.ceil(ms / 1000);
    if ([30, 20, 10].includes(seconds) && state.controller.lastAnnouncement !== seconds) {
      state.controller.lastAnnouncement = seconds;
      speak(`${seconds} seconds`);
      if (seconds === 10) playCountdownCue();
      return;
    }
    if (seconds > 0 && seconds <= 10 && state.controller.lastAnnouncement !== seconds) {
      state.controller.lastAnnouncement = seconds;
      playCountdownCue();
    }
  }
  function playCountdownCue() { playCue(state.audio?.countdownCue || "scoreboard-beep", () => tone(1450, .16)); }
  function getCuePlayer(name) {
    if (!cuePlayer) {
      cuePlayer = new Audio();
      cuePlayer.preload = "auto";
      cuePlayer.setAttribute("playsinline", "");
    }
    if (cuePlayerName !== name) {
      cuePlayer.pause();
      cuePlayer.src = `./audio/${name}.mp3`;
      cuePlayer.load();
      cuePlayerName = name;
    }
    return cuePlayer;
  }
  function unlockCueAudio() {
    const player = getCuePlayer(state.audio?.countdownCue || "scoreboard-beep");
    player.volume = 0;
    const attempt = player.play();
    if (!attempt?.then) { player.volume = 1; return Promise.resolve(); }
    return attempt.then(() => { player.pause(); player.currentTime = 0; player.volume = 1; }).catch(() => { player.volume = 1; });
  }
  function playCue(name, fallback, onFinished) {
    try {
      const player = getCuePlayer(name);
      player.pause();
      player.currentTime = 0;
      player.volume = 1;
      player.onended = onFinished || null;
      const attempt = player.play();
      if (attempt?.catch) attempt.catch(() => { fallback?.(); if (onFinished) setTimeout(onFinished, 2050); });
    } catch { fallback?.(); if (onFinished) setTimeout(onFinished, 2050); }
  }
  function ensureAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!audioContext) audioContext = new Ctx();
      if (audioContext.state === "suspended") audioContext.resume();
      return audioContext;
    } catch { return null; }
  }
  function tone(frequency, seconds) {
    try { const ctx = ensureAudio(); if (!ctx) return; const oscillator = ctx.createOscillator(); const gain = ctx.createGain(); oscillator.type = "sine"; oscillator.frequency.value = frequency; gain.gain.value = .72; oscillator.connect(gain); gain.connect(ctx.destination); oscillator.start(); gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + seconds); oscillator.stop(ctx.currentTime + seconds); } catch { /* Audio is an enhancement. */ }
  }
  function synthHorn() {
    try {
      const ctx = ensureAudio(); if (!ctx) return;
      const gain = ctx.createGain(); gain.gain.value = .68; gain.connect(ctx.destination);
      [260, 330].forEach((frequency) => { const oscillator = ctx.createOscillator(); oscillator.type = "sawtooth"; oscillator.frequency.value = frequency; oscillator.connect(gain); oscillator.start(); oscillator.stop(ctx.currentTime + 2); });
      gain.gain.setValueAtTime(.68, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + 2);
    } catch { /* Audio is an enhancement. */ }
  }
  function speak(text) { try { speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.rate = .86; utterance.volume = 1; speechSynthesis.speak(utterance); } catch { /* Audio is an enhancement. */ } }
  function snapshotController() {
    const { undoStack, ...current } = state.controller;
    undoStack.push(clone(current));
    state.controller.undoStack = undoStack.slice(-20);
  }
  function pauseClock() {
    const c = state.controller;
    if (c.phase === "BREAK_RUNNING" && c.activeAnchor) { c.breakMs = anchoredRemaining(c.activeAnchor); c.phase = "BREAK_PAUSED"; c.activeAnchor = null; }
    else if (c.phase === "POINT_LIVE" && c.activeAnchor) { c.gameMs = anchoredRemaining(c.activeAnchor); c.phase = "GAME_PAUSED"; c.activeAnchor = null; }
    else if (c.phase === "BREAK_PAUSED") { c.phase = "BREAK_RUNNING"; startAnchor("break", c.breakMs); }
    else if (c.phase === "GAME_PAUSED") { c.phase = "POINT_LIVE"; startAnchor("game", c.gameMs); }
    else return;
    const paused = c.phase.endsWith("PAUSED");
    logAction(paused ? "CLOCK_PAUSED" : "CLOCK_RESUMED", { phase: c.phase });
    if (paused) speak("Game stopped");
    renderController();
  }
  function base(side = "left") {
    const c = state.controller; if (c.phase !== "POINT_LIVE") return;
    c.gameMs = c.activeAnchor ? anchoredRemaining(c.activeAnchor) : c.gameMs; c.activeMatch.gameMs = c.gameMs; c.activeAnchor = null; c.phase = "POINT_STOPPED_WAITING_DECISION"; c.pendingBaseSide = side; logAction(side === "left" ? "BUZZER_LEFT" : "BUZZER_RIGHT", { side, gameMs: c.gameMs }); speak("Base"); renderController();
  }
  function decide(kind) {
    const c = state.controller; if (c.phase !== "POINT_STOPPED_WAITING_DECISION") return; snapshotController();
    const side = c.pendingBaseSide;
    const scoringSide = side === "left" ? "right" : "left";
    const scoringTeamId = scoringSide === "left" ? c.activeMatch.leftPhysicalTeamId : c.activeMatch.rightPhysicalTeamId;
    const scoringTeam = scoringSide === "left" ? c.activeMatch.leftPhysicalTeam : c.activeMatch.rightPhysicalTeam;
    const reversedTeamId = scoringSide === "left" ? c.activeMatch.rightPhysicalTeamId : c.activeMatch.leftPhysicalTeamId;
    const addPoint = (teamId) => {
      if (teamId === c.activeMatch.leftTeamId) c.activeMatch.leftScore += 1;
      else c.activeMatch.rightScore += 1;
    };
    if (kind === "approve") {
      addPoint(scoringTeamId);
    }
    if (kind === "reverse") { addPoint(reversedTeamId); speak("Point reversed"); }
    if (kind !== "no_point") {
      [c.activeMatch.leftPhysicalTeamId, c.activeMatch.rightPhysicalTeamId] = [c.activeMatch.rightPhysicalTeamId, c.activeMatch.leftPhysicalTeamId];
      [c.activeMatch.leftPhysicalTeam, c.activeMatch.rightPhysicalTeam] = [c.activeMatch.rightPhysicalTeam, c.activeMatch.leftPhysicalTeam];
    }
    c.pointHistory.push({ at: now(), decision: kind, baseSide: side, scoringTeamId, scoringTeam, gameMs: c.gameMs });
    c.activeMatch.gameMs = c.gameMs;
    if (state.session?.deckStyle === "split") {
      const completedMatch = c.activeMatch;
      c.activeMatch = c.inactiveMatch;
      c.inactiveMatch = completedMatch;
      c.gameMs = c.activeMatch.gameMs;
      logAction("ACTIVE_INACTIVE_SWAPPED", { activeMatchId: c.activeMatch.id });
    }
    c.pendingBaseSide = null; c.breakMs = c.breakDefaultMs; c.phase = "BREAK_RUNNING"; c.lastAnnouncement = null; startAnchor("break", c.breakMs); logAction(kind === "approve" ? "POINT_APPROVED" : kind === "reverse" ? "POINT_REVERSED" : "NO_POINT", { scoringTeamId, scoringTeam, baseSide: side }); renderController();
  }
  function undo() {
    const undoStack = state.controller.undoStack;
    const snapshot = undoStack.pop();
    if (!snapshot) return toast("Nothing to undo.");
    state.controller = { ...clone(snapshot), undoStack };
    logAction("UNDO");
    renderController();
  }

  function showClockPicker() {
    clockPickerMode = "jump";
    renderClockPicker();
    modal.showModal();
  }
  function renderClockPicker() {
    const options = [];
    for (let s = 5; s <= 60; s += 5) options.push(s);
    for (let s = 90; s <= 300; s += 30) options.push(s);
    for (let s = 360; s <= 1500; s += 60) options.push(s);
    modalBody.innerHTML = `<h2>${clockPickerMode === "default" ? "Set New Default" : "Set Clock To"}</h2><button type="button" class="clock-default ${clockPickerMode === "default" ? "active" : ""}" data-action="set-default-mode">SET NEW DEFAULT (${formatMs(state.controller.breakDefaultMs)})</button><div class="clock-options">${options.map(s => `<button type="button" data-clock-seconds="${s}">${formatMs(s * 1000)}</button>`).join("")}</div>`;
  }
  function setBreakClock(ms) {
    const c = state.controller;
    const wasRunning = c.phase === "BREAK_RUNNING";
    const wasPaused = c.phase === "BREAK_PAUSED";
    c.breakMs = ms;
    c.lastAnnouncement = null;
    if (clockPickerMode === "default") c.breakDefaultMs = ms;
    if (wasRunning) { c.phase = "BREAK_RUNNING"; startAnchor("break", ms); }
    else if (wasPaused) { c.phase = "BREAK_PAUSED"; c.activeAnchor = null; }
    else { c.phase = "READY"; c.activeAnchor = null; }
    logAction(clockPickerMode === "default" ? "BREAK_DEFAULT_CHANGED" : "BREAK_CLOCK_JUMPED", { ms, running: wasRunning, paused: wasPaused });
    ensureAudio();
    speak(spokenDuration(ms));
    modal.close();
    renderController();
  }
  function showConnection() {
    modalBody.innerHTML = `<h2>Connect PBN Backend</h2><p class="muted">Store only the public base URL here. Configure the secret reference <strong>PBN_BACKEND_ACCESS_TOKEN</strong> in the engine after import.</p><div class="field"><label>Backend base URL</label><input id="connectionUrl" placeholder="https://api.example.com" value="${state.connection.baseUrl}"></div><button class="primary wide" style="margin-top:14px" type="button" data-action="save-connection">SAVE CONNECTION NAME</button>`;
    modal.showModal();
  }
  function showScrimmageSetup() {
    modalBody.innerHTML = `<h2>Start a Scrimmage</h2><p class="muted">Single Deck is the simplest two-team setup. Choose Split Deck when four teams are rotating.</p><div class="field-grid"><div class="field"><label>Deck style</label><select id="scrimmageDeck"><option value="single">Single Deck (2 teams)</option><option value="split">Split Deck (4 teams)</option></select></div><div class="field"><label>Scoring format</label><select id="scrimmageFormat"><option value="race-to">Race-to</option><option value="uncapped">Uncapped points</option></select></div><div class="field"><label>Point limit</label><select id="scrimmagePointLimit">${[1,2,3,4,5,6,7].map(n => `<option value="${n}" ${n === 3 ? "selected" : ""}>${n} points</option>`).join("")}</select></div><div class="field"><label>Left team</label><input id="scrimmageLeft" value="TEAM 1" maxlength="24"></div><div class="field"><label>Right team</label><input id="scrimmageRight" value="TEAM 2" maxlength="24"></div><div id="splitDeckTeams" class="field-grid hidden"><div class="field"><label>Second match — left team</label><input id="scrimmageNextLeft" value="TEAM 3" maxlength="24"></div><div class="field"><label>Second match — right team</label><input id="scrimmageNextRight" value="TEAM 4" maxlength="24"></div></div></div><button class="primary wide" style="margin-top:16px" type="button" data-action="start-scrimmage">OPEN CONTROLLER</button>`;
    modal.showModal();
  }
  function teamId(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`; }
  function scrimmageMatch(id, left, right) {
    const leftTeamId = teamId(`${id}-left`);
    const rightTeamId = teamId(`${id}-right`);
    return { id, leftTeamId, rightTeamId, leftTeam: left, rightTeam: right, leftScore: 0, rightScore: 0, leftPhysicalTeamId: leftTeamId, rightPhysicalTeamId: rightTeamId, leftPhysicalTeam: left, rightPhysicalTeam: right, gameMs: 600000 };
  }
  function startScrimmage() {
    const left = $("#scrimmageLeft").value.trim() || "TEAM 1";
    const right = $("#scrimmageRight").value.trim() || "TEAM 2";
    const format = $("#scrimmageFormat").value;
    const pointLimit = Number($("#scrimmagePointLimit").value);
    const deckStyle = $("#scrimmageDeck").value;
    const c = clone(defaultState.controller);
    c.activeMatch = scrimmageMatch(`scrimmage-${Date.now()}`, left, right);
    if (deckStyle === "split") {
      const nextLeft = $("#scrimmageNextLeft").value.trim() || "TEAM 3";
      const nextRight = $("#scrimmageNextRight").value.trim() || "TEAM 4";
      c.inactiveMatch = scrimmageMatch(`scrimmage-next-${Date.now()}`, nextLeft, nextRight);
    } else c.inactiveMatch = null;
    state.controller = c;
    state.session = { active: true, type: "scrimmage", label: `${left} vs ${right}`, format, pointLimit, deckStyle };
    logAction("SCRIMMAGE_STARTED", { left, right, format, pointLimit, deckStyle });
    modal.close();
    route("live-controller");
  }
  function runEvent() {
    if (state.session?.type !== "event") {
      const c = clone(defaultState.controller);
      const active = state.schedule[0];
      const inactive = state.schedule[1];
      c.activeMatch = scrimmageMatch(active.id, active.left, active.right);
      c.inactiveMatch = scrimmageMatch(inactive.id, inactive.left, inactive.right);
      state.controller = c;
    }
    state.session = { active: true, type: "event", label: state.event.name, format: state.event.format, pointLimit: null, deckStyle: "split" };
    logAction("EVENT_CONTROL_OPENED", { eventId: state.event.id });
    route("live-controller");
  }
  function exportLog() {
    const blob = new Blob([JSON.stringify({ exportedAt: now(), event: state.event, actions: getLog() }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "pbn-event-action-log.json"; a.click(); URL.revokeObjectURL(url); toast("Local action log exported.");
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button"); if (!button) return;
    if (button.dataset.route) return route(button.dataset.route);
    if (button.dataset.clockSeconds) {
      setBreakClock(Number(button.dataset.clockSeconds) * 1000); return;
    }
    const action = button.dataset.action;
    if (action === "demo-login") { state.authenticated = true; logAction("OFFLINE_DEMO_STARTED"); route("command-home"); }
    else if (action === "open-scrimmage") showScrimmageSetup();
    else if (action === "start-scrimmage") startScrimmage();
    else if (action === "run-event") runEvent();
    else if (action === "connection") showConnection();
    else if (action === "save-connection") { const value = $("#connectionUrl").value.trim(); state.connection.baseUrl = value; state.connection.configured = Boolean(value); save(); modal.close(); toast(value ? "Connection reference saved." : "Offline mode kept."); render(); }
    else if (action === "save-form") { logAction("EVENT_SETTINGS_UPDATED"); toast("Changes saved locally."); }
    else if (action === "schedule-back") { state.scheduleDraft.step = Math.max(1, state.scheduleDraft.step - 1); save(); renderScheduleBuilder(); }
    else if (action === "schedule-next") { if (state.scheduleDraft.step < 4) state.scheduleDraft.step += 1; else { state.scheduleDraft.generated = true; state.scheduleDraft.version += 1; logAction("SCHEDULE_GENERATED", { version: state.scheduleDraft.version }); return route("master-schedule"); } save(); renderScheduleBuilder(); }
    else if (action === "publish-schedule") { state.scheduleDraft.published = true; state.event.status = "Published"; logAction("SCHEDULE_PUBLISHED", { version: state.scheduleDraft.version }); renderMasterSchedule(); }
    else if (action === "start-break") { const ms = state.controller.breakMs || state.controller.breakDefaultMs; ensureAudio(); unlockCueAudio().finally(() => speak(spokenDuration(ms))); state.controller.phase = "BREAK_RUNNING"; state.controller.lastAnnouncement = null; startAnchor("break", ms); logAction("BREAK_STARTED", { ms }); renderController(); }
    else if (action === "pause") pauseClock();
    else if (action === "base") base(button.dataset.side || "left");
    else if (action === "approve-point") decide("approve");
    else if (action === "reverse-point") decide("reverse");
    else if (action === "no-point") decide("no_point");
    else if (action === "undo") undo();
    else if (action === "set-break") showClockPicker();
    else if (action === "set-default-mode") { clockPickerMode = "default"; renderClockPicker(); }
    else if (action === "score-plus" || action === "score-minus") { snapshotController(); const side = button.dataset.side; const match = state.controller.activeMatch; const teamId = side === "left" ? match.leftPhysicalTeamId : match.rightPhysicalTeamId; const key = teamId === match.leftTeamId ? "leftScore" : "rightScore"; match[key] = Math.max(0, match[key] + (action === "score-plus" ? 1 : -1)); logAction("MANUAL_SCORE_CORRECTION", { side, teamId, delta: action === "score-plus" ? 1 : -1 }); renderController(); }
    else if (action === "export-log") exportLog();
    else if (action === "reset-all") { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(EVENT_LOG_KEY); state = clone(defaultState); render(); }
    else if (action === "finalize-playoffs") toast("Qualifying is still active. Projection was not finalized.");
    else if (action === "team-detail") toast("Roster details belong to the future player app.");
  });

  document.addEventListener("change", (event) => {
    if (event.target.id === "scrimmageDeck") $("#splitDeckTeams")?.classList.toggle("hidden", event.target.value !== "split");
    if (event.target.id === "scrimmageFormat") $("#scrimmagePointLimit")?.closest(".field")?.classList.toggle("hidden", event.target.value === "uncapped");
    if (event.target.id === "countdownCue") { state.audio = { ...(state.audio || {}), countdownCue: event.target.value }; save(); playCountdownCue(); }
  });

  state.activity = getLog().slice(-30).reverse();
  if (state.controller.activeAnchor) {
    const remaining = anchoredRemaining(state.controller.activeAnchor);
    if (state.controller.activeAnchor.kind === "break") state.controller.breakMs = remaining;
    else state.controller.gameMs = remaining;
  }
  render();
})();
