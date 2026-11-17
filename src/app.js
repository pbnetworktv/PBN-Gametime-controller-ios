import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { PBNControllerAudio } from "@pbnetwork/controller-audio";
import { staffInviteFromLink, staffInviteLink } from "./staff-invite.js";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { controllerDeckStyle,raceToComplete,applyMatchTerms,useTeamTimeout } from "./controller-rules.js";
import { beginPointDraft, normalizePointDraft, selectPointType, adjustPointScore, previewPointScore, commitPointDraft } from "./point-flow.js";
import { renderControllerView, isFinalBreakCountdown } from "./controller-view.js";
import { createControllerAudio, isAudioCancellation } from "./controller-audio.js";

(() => {
  "use strict";

  const STORAGE_KEY = "pbn_game_time_controller_v3";
  const EVENT_LOG_KEY = "pbn_game_time_action_log_v1";
  const VENUE_DIRECTORY_KEY = "pbn_controller_venue_directory_v1";
  const AUTH_SESSION_KEY = "pbn_member_session_v1";
  const DEFAULT_API_ORIGIN = "https://www.pbnetwork.tv";
  const OTHER_VENUE = "__other_venue__";
  const SCORING_PRESETS = [
    ["Race-to", "Race-to"], ["Uncapped", "Uncapped points"], ["Round robin", "Round robin"], ["ICPL", "ICPL"]
  ];
  const BREAK_OPTIONS = [["", "No required break"], ["Lunch", "Lunch break"], ["Field maintenance", "Field maintenance"], ["Scheduled break", "Scheduled break"]];
  const $ = (selector) => document.querySelector(selector);
  const app = $("#app");
  const modal = $("#modal");
  const modalBody = $("#modalBody");
  const now = () => new Date().toISOString();
  const clone = (value) => JSON.parse(JSON.stringify(value));

  const defaultState = {
    version: 3,
    authenticated: false,
    authMode: null,
    member: null,
    remoteEvents: [],
    activeEventId: "event-demo",
    eventWorkspaces: {},
    route: "login",
    connection: { configured: false, name: "PBN Backend", baseUrl: "" },
    audio: { countdownCue: "field-reference-beep", cueLibraryVersion: 2 },
    operator: { name: "Demo Operator", role: "Event Director" },
    session: { active: false, type: null, label: null, format: null, pointLimit: null, deckStyle: null },
    league: { id: "league-demo", name: "PBN Demo League", season: "2026 Season" },
    event: { id: "event-demo", source: "demo", name: "Fall Championship", date: "Sep 19–20, 2026", startDate: "2026-09-19", endDate: "2026-09-20", venue: "PBN Field Complex", format: "Race-to preset", status: "Draft" },
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
      pointDraft: null,
      pointHistory: [],
      undoStack: [],
      lastAnnouncement: null
    },
    scheduleDraft: { step: 1, days: 2, fields: 2, start: "09:00", matchMinutes: 20, breaks: "Lunch at 12:00", restSlots: 1, generated: false, published: false, version: 1 },
    activity: [],
    sync: { pending: 0, lastSync: null }
  };

  function normalizeControllerState(controller) {
    let next = { ...clone(defaultState.controller), ...controller };
    next.undoStack = Array.isArray(next.undoStack) ? next.undoStack : [];
    next.pointHistory = Array.isArray(next.pointHistory) ? next.pointHistory : [];
    if (next.activeMatch) next.activeMatch.gameNumber ||= next.inactiveMatch?.gameNumber === 1 ? 2 : 1;
    if (next.inactiveMatch) next.inactiveMatch.gameNumber ||= next.activeMatch?.gameNumber === 1 ? 2 : 1;
    try {
      next = normalizePointDraft(next);
      delete next.pointDraftError;
    } catch (error) {
      // Preserve a mismatched draft for recovery instead of resetting saved matches.
      next.pointDraftError = error.message;
    }
    return next;
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || saved.version !== 3) return clone(defaultState);
      const migratedAudio = saved.audio?.cueLibraryVersion === 2
        ? { ...clone(defaultState.audio), ...saved.audio }
        : clone(defaultState.audio);
      const migrated = { ...clone(defaultState), ...saved, audio: migratedAudio, controller: { ...clone(defaultState.controller), ...(saved.controller || {}) } };
      if (!Object.prototype.hasOwnProperty.call(saved, "activeEventId") && saved.event?.id && saved.event.id !== "event-demo") {
        migrated.activeEventId = saved.event.id;
        migrated.eventWorkspaces = {};
        migrated.divisions = [];
        migrated.teams = [];
        migrated.fields = [];
        migrated.staff = [];
        migrated.schedule = [];
        migrated.standings = [];
        migrated.controller = { ...clone(defaultState.controller), eventId: saved.event.id, activeMatch: null, inactiveMatch: null, activeAnchor: null, pointHistory: [], undoStack: [] };
        migrated.scheduleDraft = { ...clone(defaultState.scheduleDraft), eventId: saved.event.id, fields: 0, generated: false, published: false };
        migrated.session = { active: false, type: null, eventId: saved.event.id, label: saved.event.name, format: saved.event.format, pointLimit: saved.event.pointLimit || null, deckStyle: saved.event.deckStyle || null };
      }
      if (migrated.session?.type === "event" && migrated.session.eventId === migrated.event?.id) {
        const configuredDeck = migrated.event.matchTerms?.deckStyle || migrated.event.deckStyle;
        migrated.session.deckStyle = controllerDeckStyle(configuredDeck, Boolean(migrated.controller.inactiveMatch));
        if (migrated.session.deckStyle === "single") migrated.controller.inactiveMatch = null;
      }
      migrated.controller = normalizeControllerState(migrated.controller);
      for (const workspace of Object.values(migrated.eventWorkspaces || {})) {
        if (workspace?.controller) workspace.controller = normalizeControllerState(workspace.controller);
      }
      return migrated;
    } catch { return clone(defaultState); }
  }

  let state = loadState();
  let frame = null;
  let clockPickerMode = "jump";
  let audioContext = null;
  let cueSequence = 0;
  let cueCompletionTimer = null;
  let lastAudioErrorAt = 0;
  const controllerAudio = createControllerAudio({
    native: Capacitor.getPlatform() === "ios" ? PBNControllerAudio : null,
    onError: () => {
      if (Date.now() - lastAudioErrorAt < 3000) return;
      lastAudioErrorAt = Date.now();
      toast("Could not play the announcement. Try Test announcements in Settings.");
    }
  });
  let authView = "sign-in";
  let authBusy = false;
  let pendingStaffInvite = null;
  let staffAuthReady = false;
  let staffPreview = null;
  let staffLookup = 0;
  let staffCode = "";
  let staffDay = null;
  let staffError = "";
  let staffBusy = false;
  let syncTimer = null;
  let syncBusy = false;
  let lastClockPersist = 0;
  const coinConfirmations = new Map();
  const coinSyncedScores = new Map();
  const scoreKey = (controller) => {
      const match = controller?.activeMatch;
      return controller?.phase === "MATCH_COMPLETE" && match ? `${match.id}/${match.leftScore}/${match.rightScore}` : null;
  };
  let coinConfirming = false;
  const remoteRevisions = new Map();
  let venueDirectory = [];
  try {
    const cached = JSON.parse(localStorage.getItem(VENUE_DIRECTORY_KEY));
    if (Array.isArray(cached)) venueDirectory = cached;
  } catch { /* The directory can be fetched again. */ }
  let venueDirectoryRequest = null;

  function queueControllerSync() {
    if (state.authMode !== "member" || !state.remoteEvents.some(item => item.id === state.activeEventId)) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => void flushControllerSync(), 450);
  }
  async function flushControllerSync() {
    if (syncBusy) { queueControllerSync(); return; }
    const eventId = state.activeEventId;
    if (!eventId || !remoteRevisions.has(eventId) || state.event?.coinResult) return;
    syncBusy = true;
    const session = await readSecureSession();
    if (!session?.token) { syncBusy = false; return; }
    if (state.activeEventId !== eventId) { syncBusy = false; return; }
    try {
      captureActiveEventWorkspace();
      const snapshot = clone(state.eventWorkspaces[eventId]);
      const completedScore = scoreKey(snapshot.controller);
      const confirmCoinResult = coinConfirmations.get(eventId) === true && completedScore !== null && coinSyncedScores.get(eventId) === completedScore;
      const result = await authRequest(`/api/game-time/player/controller/${encodeURIComponent(eventId)}`, { method: "PUT", body: JSON.stringify({ revision: remoteRevisions.get(eventId), snapshot, confirmCoinResult }) }, session.token);
      coinSyncedScores.set(eventId, completedScore);
      remoteRevisions.set(eventId, result.revision);
      if (result.coinResult) {
        coinConfirmations.delete(eventId);
        if (state.activeEventId === eventId) state.event.coinResult = result.coinResult;
      }
      state.sync.lastSync = now(); state.sync.pending = 0; state.sync.error = null; save();
    } catch (error) { state.sync.error = error.message; state.sync.pending = 1; save(); if (error.status === 409 || coinConfirmations.has(eventId)) { coinConfirmations.delete(eventId); toast(error.message); } }
    finally {
      syncBusy = false;
      if (!coinConfirmations.has(eventId)) coinConfirming = false;
      else if (state.activeEventId === eventId) queueControllerSync();
      if (state.activeEventId === eventId && state.event?.coinChallenge && state.route === "live-controller" && state.controller.phase === "MATCH_COMPLETE") renderController();
    }
  }
  async function restoreControllerWorkspace(eventId) {
    const session = await readSecureSession();
    if (!session?.token) return;
    try {
      const saved = await authRequest(`/api/game-time/player/controller/${encodeURIComponent(eventId)}`, { method: "GET" }, session.token);
      remoteRevisions.set(eventId, saved?.revision ?? 0);
      coinSyncedScores.set(eventId, scoreKey(saved?.snapshot?.controller));
      if (saved?.snapshot) {
        const local = state.eventWorkspaces[eventId];
        const snapshot = saved.snapshot;
        const localSettings = local?.event?.controllerSettings;
        if (snapshot.event && localSettings?.updatedAt > (snapshot.event.controllerSettings?.updatedAt || "")) {
          snapshot.event.controllerSettings = localSettings;
        }
        if (local?.scheduleDraft?.updatedAt > (snapshot.scheduleDraft?.updatedAt || "")) {
          snapshot.scheduleDraft = local.scheduleDraft;
        }
        state.eventWorkspaces[eventId] = snapshot;
        if (saved.coinResult && snapshot.event) snapshot.event.coinResult = saved.coinResult;
      }
    } catch (error) { toast(`Controller is local until connection is restored: ${error.message}`); }
  }

  function captureActiveEventWorkspace() {
    const eventId = state.activeEventId;
    if (!eventId) return;
    state.eventWorkspaces ||= {};
    state.eventWorkspaces[eventId] = clone({
      eventId,
      savedAt: now(),
      agreementRevision: state.event?.agreementRevision,
      league: state.league,
      event: state.event,
      divisions: state.divisions,
      teams: state.teams,
      fields: state.fields,
      staff: state.staff,
      schedule: state.schedule,
      standings: state.standings,
      controller: state.controller,
      scheduleDraft: state.scheduleDraft,
      session: state.session
    });
  }
  function save() {
    captureActiveEventWorkspace();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]); }
  function remoteEventDateLabel(event) {
    const date = event.endDate && event.endDate !== event.startDate ? `${event.startDate} – ${event.endDate}` : event.startDate;
    return [date, event.startTime].filter(Boolean).join(" · ");
  }
  function eventDates(event) {
    const [start, end = start] = String(event.date || "").match(/\b\d{4}-\d{2}-\d{2}\b/g) || [];
    const demo = event.id === defaultState.event.id && event.date === defaultState.event.date ? defaultState.event : {};
    return {
      startDate: event.startDate || start || demo.startDate || "",
      endDate: event.endDate || end || demo.endDate || "",
      startTime: event.startTime || String(event.date || "").match(/ · (\d{2}:\d{2})$/)?.[1] || ""
    };
  }
  function scoringPreset(value) {
    const format = String(value || "").trim();
    if (/^race-to(?: preset|-[1-7])?$/i.test(format)) return "Race-to";
    return SCORING_PRESETS.find(([preset]) => preset.toLowerCase() === format.toLowerCase())?.[0] || format;
  }
  function eventSettingsLocked(event) {
    return Boolean(event.coinChallenge || event.matchTerms);
  }

  async function readSecureSession() {
    try {
      const value = await SecureStorage.getItem(AUTH_SESSION_KEY);
      return value ? JSON.parse(value) : null;
    } catch { return null; }
  }
  async function writeSecureSession(session) {
    await SecureStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  }
  async function clearSecureSession() {
    try { await SecureStorage.removeItem(AUTH_SESSION_KEY); } catch { /* already absent */ }
  }
  function authApiOrigin() {
    if (isHostedController()) return window.location.origin;
    const configured = state.connection?.baseUrl?.trim();
    return (configured || DEFAULT_API_ORIGIN).replace(/\/$/, "");
  }
  function isHostedController() {
    return /^https?:$/.test(window.location.protocol) && window.location.pathname === "/game-time-controller/index.html";
  }
  async function authRequest(path, options = {}, token = null) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${authApiOrigin()}${path}`, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "PBN account request failed.");
      error.status = response.status;
      throw error;
    }
    return payload.data;
  }
  async function acceptAuthSession(session) {
    await writeSecureSession(session);
    state.authenticated = true;
    state.authMode = "member";
    state.member = session.user;
    state.operator = { name: session.user.screenName || session.user.firstName || session.user.email, role: "PBN Member" };
    state.route = "command-home";
    await loadRemoteEvents(session.token);
    staffAuthReady = true;
    if (resumeStaffInvite()) return;
    save();
    render();
  }
  async function loadRemoteEvents(token) {
    try {
      const events = await authRequest("/api/game-time/player/controller-events", { method: "GET" }, token);
      state.remoteEvents = Array.isArray(events) ? events : [];
      const active = state.remoteEvents.find(event => event.id === state.activeEventId);
      if (active?.eventCode && state.event?.source === "PBN") state.event.eventCode = active.eventCode;
      save();
      return true;
    } catch (error) {
      state.sync.error = error.message || "Unable to load shared events.";
      return false;
    }
  }
  async function refreshRemoteEvents() {
    if (state.authMode !== "member") return;
    const session = await readSecureSession();
    if (!session?.token) return;
    const refreshed = await loadRemoteEvents(session.token);
    if (refreshed && state.route === "command-home") renderCommandHome();
  }
  async function restoreAuthSession() {
    const saved = await readSecureSession();
    if (!saved?.token) {
      state.authenticated = false;
      state.authMode = null;
      state.member = null;
      state.route = "login";
      save();
      render();
      return;
    }
    try {
      let session = saved;
      const refreshWithinMs = 7 * 24 * 60 * 60 * 1000;
      if (!saved.expiresAt || new Date(saved.expiresAt).getTime() - Date.now() <= refreshWithinMs) {
        const refreshed = await authRequest("/api/mobile-auth/refresh", { method: "POST" }, saved.token);
        session = refreshed;
        await writeSecureSession(session);
      } else {
        const current = await authRequest("/api/mobile-auth/me", { method: "GET" }, saved.token);
        session = { ...saved, ...current };
      }
      state.authenticated = true;
      state.authMode = "member";
      state.member = session.user;
      state.operator = { name: session.user.screenName || session.user.firstName || session.user.email, role: "PBN Member" };
      if (state.route === "login") state.route = "command-home";
      await loadRemoteEvents(session.token);
      save();
    } catch (error) {
      if (error.status === 401) {
        await clearSecureSession();
        state.authenticated = false;
        state.authMode = null;
        state.member = null;
        state.route = "login";
        save();
      } else if (saved.user) {
        state.authenticated = true;
        state.authMode = "member";
        state.member = saved.user;
        if (state.route === "login") state.route = "command-home";
        save();
      }
    }
    staffAuthReady = true;
    if (!resumeStaffInvite()) render();
  }
  function getLog() { try { return JSON.parse(localStorage.getItem(EVENT_LOG_KEY)) || []; } catch { return []; } }
  function logAction(type, payload = {}) {
    const entry = { id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, eventId: state.activeEventId || state.event?.id || null, at: now(), type, payload, syncStatus: state.connection.configured ? "pending" : "local-only" };
    const log = [...getLog(), entry].slice(-500);
    localStorage.setItem(EVENT_LOG_KEY, JSON.stringify(log));
    state.activity = log.slice(-30).reverse();
    if (state.connection.configured) state.sync.pending += 1;
    save();
    queueControllerSync();
    return entry;
  }
  function getEventLog(eventId = state.activeEventId || state.event?.id) {
    return getLog().filter((entry) => entry.eventId === eventId);
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
  function route(name) {
    stopFrame();
    if (modal.open) modal.close();
    state.route = name;
    save();
    render();
    if (name === "command-home") void refreshRemoteEvents();
  }
  function nav(active) {
    return `<nav class="bottom-nav" aria-label="Primary navigation">
      <button data-route="command-home" class="${active === "command-home" ? "active" : ""}"><span>⌂</span>Home</button>
      <button data-route="master-schedule" class="${active === "master-schedule" ? "active" : ""}"><span>▤</span>Schedule</button>
      <button data-route="live-controller" class="${active === "live-controller" ? "active" : ""}"><span>◉</span>Control</button>
      <button data-route="settings" class="${active === "settings" ? "active" : ""}"><span>⚙</span>Settings</button>
    </nav>`;
  }
  function topbar(title, back = "event-dashboard") { const saved = Boolean(state.sync.lastSync) && !state.sync.error && !state.sync.pending; return `<header class="topbar"><button class="icon-btn" data-route="${back}" aria-label="Back">←</button><h1>${title}</h1><span class="status ${saved ? "good" : "warn"}">${saved ? "SAVED" : state.sync.error ? "SYNC ERROR" : "LOCAL"}</span></header>`; }
  function page(content, active, className = "") { app.innerHTML = `<div class="app-shell"><section class="screen ${className}">${content}</section>${active ? nav(active) : ""}</div>`; }

  const pageDefinitions = {
    "login": renderLogin,
    "command-home": renderCommandHome,
    "join-staff": renderStaffJoin,
    "leagues": renderLeagues,
    "league-home": renderLeagueHome,
    "event-dashboard": renderDashboard,
    "event-settings": renderEventSettings,
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
    const signIn = authView === "sign-in";
    page(`<div class="auth-screen"><section class="auth-card"><div class="auth-logo"><strong>PBN</strong><small>PAINTBALL BROADCAST NETWORK</small></div><h1>${signIn ? "SIGN IN TO YOUR ACCOUNT" : "CREATE YOUR PBN ACCOUNT"}</h1><p class="auth-intro">${signIn ? "Use your account credentials to run Game Time." : "Create one free account for PBN Game Time and PBNetwork.tv."}</p>
      <form id="${signIn ? "signInForm" : "signUpForm"}" class="auth-form">
        ${signIn ? "" : `<div class="auth-name-row"><div class="field"><label>First name</label><input id="authFirstName" autocomplete="given-name" required maxlength="40"></div><div class="field"><label>Last name</label><input id="authLastName" autocomplete="family-name" required maxlength="40"></div></div>`}
        <div class="field"><label>Email</label><input id="authEmail" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required></div>
        <div class="field"><label>Password</label><input id="authPassword" type="password" autocomplete="${signIn ? "current-password" : "new-password"}" placeholder="Enter your password" minlength="8" required></div>
        ${signIn ? "" : `<div class="field"><label>Confirm password</label><input id="authConfirmPassword" type="password" autocomplete="new-password" minlength="8" required></div><label class="terms-check"><input id="authTerms" type="checkbox" required><span>I agree to the <a href="https://www.pbnetwork.tv/legal/terms" target="_blank">Terms</a> and <a href="https://www.pbnetwork.tv/legal/privacy" target="_blank">Privacy Policy</a>.</span></label>`}
        <p id="authError" class="auth-error" role="alert"></p>
        <button class="auth-submit" type="submit" ${authBusy ? "disabled" : ""}>${authBusy ? "Please wait…" : signIn ? "Sign in" : "Create account"}</button>
      </form>
      <p class="auth-switch-copy">${signIn ? "Need a free account?" : "Already have an account?"} <button data-action="toggle-auth">${signIn ? "Sign up" : "Sign in"}</button></p>
    </section></div>`, null);
  }
  function renderCommandHome() {
    const session = state.session || defaultState.session;
    const sharedEvents = Array.isArray(state.remoteEvents) ? state.remoteEvents : [];
    const savedSessions = Object.entries(state.eventWorkspaces || {})
      .filter(([id, workspace]) => id !== state.activeEventId && workspace?.event && workspace.event.source !== "PBN" && (id !== "event-demo" || workspace.session?.active))
      .sort(([, left], [, right]) => String(right.savedAt || "").localeCompare(String(left.savedAt || "")));
    page(`<div class="command-head"><div class="brand">PBN</div><p class="subtitle">GAME TIME CONTROLLER</p></div>
      <button class="command-choice" data-route="join-staff"><span class="choice-icon">✓</span><span><strong>JOIN EVENT STAFF</strong><small>Enter an event code to find the event and day</small></span><b>›</b></button>
      ${session.active ? `<section class="active-session"><span class="live-dot"></span><div><span class="eyebrow">ACTIVE ${session.type === "scrimmage" ? "SCRIMMAGE" : "EVENT"}</span><h2>${escapeHtml(session.label || "Controller session")}</h2><p>Your clock and scores are saved on this device. Starting another session pauses this one so you can return later.</p></div><button class="primary" data-route="live-controller">RETURN TO CONTROLLER</button></section>` : `<section class="command-intro"><span class="eyebrow">EVENT COMMAND</span><h1>What are you running?</h1><p>Choose a quick scrimmage or set up a local planned event.</p></section>`}
      <button class="command-choice quick" data-action="open-scrimmage"><span class="choice-icon">▶</span><span><strong>START A SCRIMMAGE</strong><small>Pick a format, name the teams, and start playing</small></span><b>›</b></button>
      <button class="command-choice" data-action="open-new-event"><span class="choice-icon">▤</span><span><strong>START NEW EVENT</strong><small>Create a local planned event with its own teams and opening matches</small></span><b>›</b></button>
      ${savedSessions.length ? `<section class="recent-event"><div class="section-title"><h2>Saved sessions</h2><span class="status">ON THIS DEVICE</span></div><div class="list">${savedSessions.map(([id, workspace]) => renderSavedSession(id, workspace)).join("")}</div></section>` : ""}
      ${state.authMode === "member" ? `<section class="recent-event"><div class="section-title"><h2>My PBN events</h2><span class="status good">SYNCED</span></div>${sharedEvents.length ? sharedEvents.map(renderRemoteEventSummary).join("") : `<div class="card empty">No shared events yet. Create a draft from the Game Time tab on PBNetwork.tv.</div>`}</section>` : ""}
      ${state.event.source === "PBN" || session.type === "scrimmage" ? "" : `<section class="recent-event"><div class="section-title"><h2>${state.event.source === "demo" ? "Demo planned event" : "Local planned event"}</h2><span class="status warn">${escapeHtml(state.event.status.toUpperCase())}</span></div><button class="event-summary" data-route="event-dashboard"><div><span class="eyebrow">${escapeHtml(state.league.name)}</span><strong>${escapeHtml(state.event.name)}</strong><small>${escapeHtml(state.event.date)} · ${escapeHtml(state.event.venue)}</small></div><b>CONTINUE ›</b></button></section>`}`, "command-home", "command-screen");
  }
  function renderSavedSession(eventId, workspace) {
    const session = workspace.session || {};
    const controller = workspace.controller;
    const match = session.active ? controller?.activeMatch : null;
    const label = session.type === "scrimmage" ? "Scrimmage" : workspace.event.source === "PBN" ? "PBN event" : "Local planned event";
    const details = match
      ? `${match.leftTeam} ${match.leftScore} – ${match.rightScore} ${match.rightTeam} · ${formatMs(controller.gameMs)} remaining`
      : [workspace.event.date, workspace.event.venue].filter(Boolean).join(" · ");
    return `<button class="event-summary" data-action="resume-saved-session" data-event-id="${escapeHtml(eventId)}"><div><span class="eyebrow">${label}${controller?.phase?.endsWith("PAUSED") ? " · Paused" : ""}</span><strong>${escapeHtml(session.label || workspace.event.name)}</strong><small>${escapeHtml(details)}</small></div><b>${match ? "RESUME" : "OPEN"} ›</b></button>`;
  }
  function renderRemoteEventSummary(event) {
    const settings = state.eventWorkspaces?.[event.id]?.event?.controllerSettings;
    const details = !eventSettingsLocked(event) && settings ? settings : event;
    return `<button class="event-summary" data-action="open-remote-event" data-event-id="${escapeHtml(event.id)}"><div><span class="eyebrow">${escapeHtml(event.status)} · ${escapeHtml(event.visibility)}</span><strong>${escapeHtml(details.name)}</strong><small>${escapeHtml(remoteEventDateLabel(details))} · ${escapeHtml(details.venue)}</small></div><b>OPEN ›</b></button>`;
  }
  function renderLeagues() {
    page(`${topbar("My Leagues", "login")}<section class="card hero"><span class="eyebrow">CURRENT ORGANIZATION</span><h2>${state.league.name}</h2><p>${state.league.season} · one event ready for testing</p><button class="primary wide" data-route="league-home">OPEN LEAGUE</button></section><div class="section-title"><h2>Other leagues</h2></div><div class="card empty">Connect the PBN backend to load additional organizations.</div>`, null);
  }
  function renderLeagueHome() {
    page(`${topbar(state.league.name, "leagues")}<section class="card hero"><span class="eyebrow">${state.league.season}</span><h2>${escapeHtml(state.event.name)}</h2><p>${escapeHtml(state.event.date)} · ${escapeHtml(state.event.venue)}</p><button class="primary wide" data-route="event-dashboard">OPEN EVENT</button></section><div class="section-title"><h2>League actions</h2></div><div class="grid"><button class="menu-card" data-route="teams"><span class="count">${state.teams.length}</span><strong>Teams</strong><small>Review event teams</small></button><button class="menu-card" data-route="divisions"><span class="count">${state.divisions.length}</span><strong>Divisions</strong><small>Formats and assignments</small></button></div>`, null);
  }
  function eventCodeControl() {
    const code = state.event?.eventCode;
    if (typeof code !== "string" || !/^[A-Z0-9]{6}$/.test(code)) return "";
    return `<div class="button-row"><strong>Event code <span>${code}</span></strong><button class="secondary" type="button" data-action="copy-event-code" aria-label="Copy event code">Copy code</button><button class="secondary" type="button" data-action="share-staff-invite">Share staff link</button></div>`;
  }
  async function copyEventCode() {
    const code = state.event?.eventCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast("Event code copied.");
    } catch {
      toast("Could not copy. You can enter the displayed code on another Controller.");
    }
  }
  function renderStaffJoin() {
    const event = staffPreview;
    const canContinue = Boolean(staffDay || event?.startsAt);
    const dates = event?.days.map(day => `<option value="${escapeHtml(day.date)}" ${day.date === staffDay ? "selected" : ""}>${escapeHtml(day.weekday)} · ${escapeHtml(day.date)}</option>`).join("") || "";
    page(`${topbar("Join Event Staff", "command-home")}<section class="card">
      <form id="staffJoinForm"><div class="field"><label for="staffCode">Event code</label><input id="staffCode" value="${escapeHtml(staffCode)}" placeholder="D34A78" maxlength="12" autocapitalize="characters" autocomplete="off" required></div>
      <button type="submit" class="primary wide" ${staffBusy ? "disabled" : ""}>${staffBusy ? "Finding event…" : "Find event"}</button></form>
      ${staffError ? `<p role="alert">${escapeHtml(staffError)}</p>` : ""}
      </section>${event ? `<section class="card"><p class="eyebrow">${escapeHtml(event.code)}</p><h2>${escapeHtml(event.name)}</h2><p>${escapeHtml(event.venue)}</p>
      ${dates ? `<div class="field"><label for="staffDay">Scheduled day</label><select id="staffDay"><option value="">Choose a day</option>${dates}</select></div>` : event.startsAt ? `<p>Scheduled start in your local time · ${escapeHtml(new Date(event.startsAt).toLocaleString())}</p>` : ""}
      ${canContinue ? '<p role="status">Venue check-in and role claims are not available yet.</p><button type="button" class="secondary" data-action="copy-staff-day">Copy staff link</button>' : ""}
      </section>` : ""}`, "command-home");
  }

  async function lookupStaffEvent(input, day = null) {
    const lookup = ++staffLookup;
    staffCode = input.trim();
    staffPreview = null;
    staffDay = null;
    staffError = "";
    if (!/^[a-z0-9]{6}(?:-\((sun|mon|tue|wed|thu|fri|sat)\))?$/i.test(staffCode)) {
      staffBusy = false;
      staffError = "Enter the six-character event code.";
      return renderStaffJoin();
    }
    staffBusy = true;
    renderStaffJoin();
    try {
      const session = await readSecureSession();
      if (!session?.token) {
        if (lookup === staffLookup && state.route === "join-staff") {
          pendingStaffInvite = { code: staffCode, day };
          route("login");
        }
        return;
      }
      const params = new URLSearchParams({ code: staffCode });
      if (day) params.set("day", day);
      const event = await authRequest(`/api/game-time/player/staff/join?${params}`, {}, session.token);
      if (lookup === staffLookup) {
        staffPreview = event;
        staffDay = event.selectedDay;
      }
    } catch (error) {
      if (lookup === staffLookup) staffError = error.message || "Could not look up the event. Please try again.";
    } finally {
      if (lookup === staffLookup) {
        staffBusy = false;
        if (state.route === "join-staff") renderStaffJoin();
      }
    }
  }

  function resumeStaffInvite() {
    if (!staffAuthReady || !pendingStaffInvite || state.authMode !== "member") return false;
    const { code, day } = pendingStaffInvite;
    pendingStaffInvite = null;
    route("join-staff");
    void lookupStaffEvent(code, day);
    return true;
  }

  function openStaffInvite(url) {
    const invite = staffInviteFromLink(url, isHostedController() ? window.location.origin : undefined);
    if (!invite) return;
    pendingStaffInvite = invite;
    resumeStaffInvite();
  }

  async function shareStaffInvite() {
    const code = state.event?.eventCode;
    try {
      const session = await readSecureSession();
      if (!session?.token || !code) return;
      await authRequest("/api/game-time/player/staff/share", { method: "POST", body: JSON.stringify({ code }) }, session.token);
      const url = staffInviteLink(code);
      modalBody.innerHTML = `<h2>Share staff link</h2><div class="field"><label for="staffShareUrl">Invite link</label><input id="staffShareUrl" value="${escapeHtml(url)}" readonly></div><div class="button-row"><button type="button" class="primary" data-action="send-staff-invite">${navigator.share ? "Share link" : "Copy link"}</button><button class="secondary" value="cancel">Close</button></div>`;
      if (!modal.open) modal.showModal();
    } catch (error) {
      if (error.name !== "AbortError") toast(error.message || "Could not share the staff link.");
    }
  }

  async function sendStaffInvite() {
    const link = $("#staffShareUrl");
    if (!link) return;
    try {
      if (navigator.share) await navigator.share({ title: "Join Event Staff", url: link.value });
      else {
        await navigator.clipboard.writeText(link.value);
        toast("Staff link copied.");
      }
    } catch (error) {
      if (error.name !== "AbortError") { link.select(); toast("Select and copy the staff link."); }
    }
  }

  async function copyStaffDayLink() {
    if (!staffPreview) return;
    try {
      await navigator.clipboard.writeText(staffInviteLink(staffPreview.code, staffDay));
      toast("Staff link copied.");
    } catch { toast("Could not copy the staff link."); }
  }

  function renderDashboard() {
    const next = state.schedule[0];
    const steps = eventSetupSteps();
    const complete = steps.filter(step => step.done).length;
    const nextStep = steps.find(step => !step.done) || steps[steps.length - 1];
    page(`${topbar("Event Command", "command-home")}<section class="event-command-hero"><div><span class="eyebrow">${escapeHtml(state.event.status)} · ${escapeHtml(state.event.date)}</span><h2>${escapeHtml(state.event.name)}</h2><p>${escapeHtml(state.event.venue)}</p>${eventCodeControl() || `<small>Event ID: ${escapeHtml(state.event.id)}</small>`}</div><button class="run-event" data-action="run-event" ${next ? "" : "disabled"}>▶ RUN EVENT</button></section>
      <div class="section-title"><h2>Up next</h2>${next ? `<span class="status">${escapeHtml(next.time)}</span>` : ""}</div>${next ? `<button class="next-match" data-action="run-event"><div><strong>${escapeHtml(next.left)} vs ${escapeHtml(next.right)}</strong><small>${escapeHtml(next.field)} · ${escapeHtml(next.status)}</small></div><span>OPEN CONTROLLER ›</span></button>` : `<div class="card empty">No matches are assigned to this event yet. Add teams, then build the event schedule.</div>`}
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
      { title: "Staff & broadcast", detail: state.staff.length > 0 && assignedStaff === state.staff.length ? "All roles assigned" : state.staff.length ? `${state.staff.length - assignedStaff} roles need attention` : "No staff assigned", route: "staff", done: state.staff.length > 0 && assignedStaff === state.staff.length },
      { title: "Publish event", detail: state.scheduleDraft.published ? "Schedule and event are live" : "Publish when setup is ready", route: "publishing", done: state.scheduleDraft.published }
    ];
  }
  function menu(target, count, title, text) { return `<button class="menu-card" data-route="${target}"><span class="count">${count}</span><strong>${title}</strong><small>${text}</small></button>`; }
  function optionMarkup(options, value) {
    const selected = String(value ?? "");
    const choices = selected && !options.some(([key]) => String(key) === selected) ? [[selected, selected], ...options] : options;
    return choices.map(([key, label]) => `<option value="${escapeHtml(key)}" ${String(key) === selected ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
  }

  function selectField(id, label, options, value) {
    return `<div class="field"><label for="${id}">${label}</label><select id="${id}" name="${id}">${optionMarkup(options, value)}</select></div>`;
  }

  function numberOptions(min, max, label) {
    return Array.from({ length: max - min + 1 }, (_, index) => {
      const value = min + index;
      return [value, label(value)];
    });
  }

  function venueOptions(region, current) {
    const options = new Map();
    const add = (name, label = name) => {
      if (typeof name === "string" && name.trim() && !options.has(name.toLowerCase())) options.set(name.toLowerCase(), [name, label]);
    };
    // Keep the saved venue selectable even when the directory does not list it.
    add(current);
    for (const field of venueDirectory) {
      if (region && field.region !== region) continue;
      const location = [field.city, field.region].filter(Boolean).join(", ");
      add(field.name, location ? `${field.name} · ${location}` : field.name);
    }
    if (!region) {
      for (const event of state.remoteEvents) add(event.venue);
      add(defaultState.event.venue);
      add("Local practice");
    }
    return [["", "Choose a venue"], ...options.values(), [OTHER_VENUE, "Other venue…"]];
  }

  function refreshVenueOptions(regionChanged = false) {
    const venue = $("#eventVenue");
    const region = $("#venueRegion");
    if (!venue || !region || venue.matches(":disabled")) return;
    const regions = [...new Set(venueDirectory.map(field => field.region).filter(Boolean))].sort();
    region.innerHTML = optionMarkup([["", "All regions"], ...regions.map(name => [name, name])], region.value);
    region.closest(".field").hidden = !regions.length;
    const selected = venue.value;
    const current = state.event.venue;
    const options = venueOptions(region.value, current);
    const stillListed = options.some(([value]) => value === selected);
    venue.innerHTML = optionMarkup(options, regionChanged && !stillListed ? "" : selected);
    updateCustomVenue(venue);
  }

  function updateCustomVenue(venue) {
    const custom = $("#customVenue");
    if (!custom) return;
    const show = venue.value === OTHER_VENUE;
    custom.closest(".field").hidden = !show;
    custom.disabled = !show;
    custom.required = show;
  }

  function loadVenueDirectory() {
    if (state.authMode !== "member" || venueDirectoryRequest) return;
    venueDirectoryRequest = (async () => {
      const session = await readSecureSession();
      if (!session?.token) throw new Error("PBN session unavailable.");
      const fields = await authRequest("/api/game-time/player/fields", { method: "GET" }, session.token);
      venueDirectory = fields.filter(field => typeof field.name === "string" && field.name.trim())
        .map(field => ({ name: field.name.trim(), city: field.city, region: field.state }))
        .sort((left, right) => left.name.localeCompare(right.name));
      try { localStorage.setItem(VENUE_DIRECTORY_KEY, JSON.stringify(venueDirectory)); }
      catch { /* Use the directory already loaded in memory. */ }
      refreshVenueOptions();
    })().catch(() => { venueDirectoryRequest = null; });
  }

  function updateEventPointLimit(format) {
    const limit = $("#eventPointLimit");
    limit.closest(".field").hidden = format !== "Race-to";
  }

  function renderEventSettings() {
    const event = state.event;
    const dates = eventDates(event);
    const format = scoringPreset(event.format);
    const locked = eventSettingsLocked(event);
    const singleDay = event.eventType === "Paintball scrimmage" || (event.source === "local" && state.session?.type === "scrimmage");
    const presets = singleDay ? SCORING_PRESETS.slice(0, 2) : SCORING_PRESETS;
    const sessionLimit = state.session?.eventId === event.id ? state.session.pointLimit : null;
    const pointLimit = event.pointLimit || sessionLimit || String(event.format || "").match(/-([1-7])$/)?.[1] || 3;
    const notice = locked ? "These details come from the confirmed match rules." : event.source === "PBN" ? "Changes apply to the Controller’s event settings." : "";
    page(`${topbar("Event Settings")}
      <form id="eventSettingsForm" class="card">
        ${notice ? `<p class="form-note muted">${notice}</p>` : ""}
        <fieldset class="field-grid" ${locked ? "disabled" : ""}>
          <div class="field"><label for="eventName">Event name</label><input id="eventName" name="eventName" value="${escapeHtml(event.name)}" maxlength="100" required></div>
          <div class="field"><label for="eventStartDate">${dates.endDate && dates.endDate !== dates.startDate ? "Start date" : "Date"}</label><input id="eventStartDate" name="eventStartDate" type="date" value="${escapeHtml(dates.startDate)}" required></div>
          ${singleDay && (!dates.endDate || dates.endDate === dates.startDate) ? "" : `<div class="field"><label for="eventEndDate">End date (optional)</label><input id="eventEndDate" name="eventEndDate" type="date" min="${escapeHtml(dates.startDate)}" value="${escapeHtml(dates.endDate === dates.startDate ? "" : dates.endDate)}"></div>`}
          ${locked ? "" : `<div class="field" hidden><label for="venueRegion">Venue region</label><select id="venueRegion"><option value="">All regions</option></select></div>`}
          <div class="field"><label for="eventVenue">Venue</label><select id="eventVenue" name="eventVenue" required>${optionMarkup(locked ? [[event.venue, event.venue]] : venueOptions("", event.venue), event.venue)}</select></div>
          <div class="field" hidden><label for="customVenue">Venue name</label><input id="customVenue" name="customVenue" maxlength="160" disabled></div>
          ${selectField("eventFormat", "Scoring preset", [["", "Choose a preset"], ...presets], format)}
          ${selectField("eventPointLimit", "Race-to points", numberOptions(1, 7, n => `${n} ${n === 1 ? "point" : "points"}`), pointLimit)}
        </fieldset>
        ${locked ? "" : `<button class="primary wide form-save" type="submit">SAVE CHANGES</button>`}
      </form>`, "settings");
    updateEventPointLimit(format);
    if (!locked) {
      refreshVenueOptions();
      loadVenueDirectory();
    }
  }

  function saveEventSettings(form) {
    if (eventSettingsLocked(state.event)) return;
    const data = new FormData(form);
    const name = data.get("eventName").trim();
    const startDate = data.get("eventStartDate");
    const endDate = data.get("eventEndDate") || startDate;
    const venue = data.get("eventVenue") === OTHER_VENUE ? data.get("customVenue").trim() : data.get("eventVenue");
    const format = data.get("eventFormat");
    if (!name || !venue || !format) return toast("Enter a name and choose a venue and scoring preset.");
    const startTime = eventDates(state.event).startTime;
    const pointLimit = format === "Race-to" ? data.get("eventPointLimit") : "";
    const settings = { name, startDate, endDate, startTime, venue, format, pointLimit };
    Object.assign(state.event, settings, { date: remoteEventDateLabel(settings) });
    if (state.event.source === "PBN") state.event.controllerSettings = { ...settings, updatedAt: now() };
    if (state.session?.eventId === state.event.id) Object.assign(state.session, { label: name, format, pointLimit });
    logAction("EVENT_SETTINGS_UPDATED");
    renderEventSettings();
    toast("Controller event settings saved.");
  }
  function renderScheduleBuilder() {
    const d = state.scheduleDraft;
    page(`${topbar("Schedule Builder")}<div class="steps">${[1,2,3,4].map(n => `<i class="${n <= d.step ? "on" : ""}"></i>`).join("")}</div><form id="scheduleBuilderForm" class="card"><span class="eyebrow">STEP ${d.step} OF 4</span>${scheduleStep(d)}<div class="button-row">${d.step > 1 ? `<button class="secondary" type="button" data-action="schedule-back">BACK</button>` : ""}<button class="primary" type="submit">${d.step === 4 ? "GENERATE SCHEDULE" : "CONTINUE"}</button></div></form>`, "master-schedule");
    if (d.step === 3) updateScheduleBreakTime($("#draftBreaks").value);
  }
  function scheduleStep(d) {
    if (d.step === 1) return `<h2>Event structure</h2><div class="field-grid">
      ${selectField("draftDays", "Event days", numberOptions(1, 31, n => `${n} ${n === 1 ? "day" : "days"}`), d.days)}
      ${selectField("draftFields", "Active fields", numberOptions(0, 32, n => n === 0 ? "None configured" : `${n} ${n === 1 ? "field" : "fields"}`), d.fields)}
    </div>`;
    if (d.step === 2) return `<h2>Match timing</h2><div class="field-grid">
      <div class="field"><label for="draftStart">First match</label><input id="draftStart" name="draftStart" type="time" value="${escapeHtml(d.start)}" required></div>
      ${selectField("draftMinutes", "Minutes per slot", numberOptions(1, 180, n => `${n} ${n === 1 ? "minute" : "minutes"}`), d.matchMinutes)}
    </div>`;
    if (d.step === 3) {
      const savedBreak = String(d.breaks || "").match(/^(.+) at (\d{2}:\d{2})$/);
      const breakKind = BREAK_OPTIONS.some(([kind]) => kind === savedBreak?.[1]) ? savedBreak[1] : d.breaks;
      return `<h2>Constraints</h2><div class="field-grid">
        ${selectField("draftBreaks", "Required break", BREAK_OPTIONS, breakKind)}
        <div class="field"><label for="draftBreakTime">Break time</label><input id="draftBreakTime" name="draftBreakTime" type="time" value="${escapeHtml(savedBreak?.[2] || "12:00")}"></div>
        ${selectField("draftRest", "Rest protection", numberOptions(0, 10, n => n === 0 ? "No minimum rest" : `Minimum ${n} match ${n === 1 ? "slot" : "slots"}`), d.restSlots ?? 1)}
      </div>`;
    }
    const rest = d.restSlots ?? 1;
    return `<h2>Review schedule settings</h2><div class="list">
      <div class="list-row"><div><strong>Field capacity</strong><small>${escapeHtml(d.fields)} fields across ${escapeHtml(d.days)} days</small></div></div>
      <div class="list-row"><div><strong>Match timing</strong><small>Starts at ${escapeHtml(d.start)} · ${escapeHtml(d.matchMinutes)} minutes per slot</small></div></div>
      <div class="list-row"><div><strong>Breaks and rest</strong><small>${escapeHtml(d.breaks || "No required break")} · ${rest ? `Minimum ${escapeHtml(rest)} match ${rest === 1 ? "slot" : "slots"} between matches` : "No minimum rest"}</small></div></div>
    </div>`;
  }

  function updateScheduleBreakTime(kind) {
    const time = $("#draftBreakTime");
    const show = kind !== "" && BREAK_OPTIONS.some(([value]) => value === kind);
    time.closest(".field").hidden = !show;
    time.disabled = !show;
    time.required = show;
  }

  function saveScheduleStep(form) {
    const data = new FormData(form);
    const draft = state.scheduleDraft;
    if (draft.step === 1) {
      draft.days = Number(data.get("draftDays"));
      draft.fields = Number(data.get("draftFields"));
    } else if (draft.step === 2) {
      draft.start = data.get("draftStart") || draft.start;
      draft.matchMinutes = Number(data.get("draftMinutes"));
    } else if (draft.step === 3) {
      const kind = data.get("draftBreaks");
      const time = data.get("draftBreakTime");
      draft.breaks = time ? `${kind} at ${time}` : kind;
      draft.restSlots = Number(data.get("draftRest"));
    }
    draft.updatedAt = now();
    queueControllerSync();
  }

  function advanceScheduleBuilder(form) {
    saveScheduleStep(form);
    const draft = state.scheduleDraft;
    if (draft.step === 4) {
      draft.generated = true;
      draft.version += 1;
      logAction("SCHEDULE_GENERATED", { version: draft.version });
      return route("master-schedule");
    }
    draft.step += 1;
    save();
    renderScheduleBuilder();
  }
  function renderMasterSchedule() {
    page(`${topbar("Master Schedule")}<section class="card"><div class="section-title" style="margin-top:0"><h2>Schedule v${state.scheduleDraft.version}</h2><span class="status ${state.scheduleDraft.published ? "good" : "warn"}">${state.scheduleDraft.published ? "PUBLISHED" : "DRAFT"}</span></div><div class="list">${state.schedule.map(matchRow).join("")}</div><div class="button-row"><button class="secondary" data-route="schedule-builder">EDIT VERSION</button><button class="primary" data-action="publish-schedule">PUBLISH</button></div></section>`, "master-schedule");
  }
  function matchRow(m) { return `<div class="list-row"><div><strong>${escapeHtml(m.left)} vs ${escapeHtml(m.right)}</strong><small>${escapeHtml(m.time)} · ${escapeHtml(m.field)}</small></div><span class="status">${escapeHtml(m.status)}</span></div>`; }

  function controllerEditingLocked() {
    return Boolean(state.event?.coinResult || coinConfirming);
  }
  function currentDeckStyle() {
    return controllerDeckStyle(state.event?.matchTerms?.deckStyle || state.event?.deckStyle || state.session?.deckStyle, Boolean(state.controller.inactiveMatch));
  }
  function controllerStatus(controller) {
    if (controller.pointDraftError) return controller.pointDraftError;
    return ({
      READY: "Ready to start",
      POINT_LIVE: "Point in play",
      GAME_PAUSED: "Game paused",
      BREAK_RUNNING: "Break running",
      BREAK_PAUSED: "Break paused",
      POINT_STOPPED_WAITING_DECISION: "Clock stopped",
      POINT_CONFIRMED: "Point saved",
      MATCH_COMPLETE: "Match complete"
    })[controller.phase] || "Clock stopped";
  }
  function renderController() {
    if (!state.controller?.activeMatch) {
      page(topbar("Live Controller", "event-dashboard") + '<section class="card empty"><h2>No match is ready</h2><p>This event has no scheduled teams yet. Add teams and build its schedule before opening the controller.</p><small>Event ID: ' + escapeHtml(state.activeEventId || state.event?.id || "") + '</small></section>', "event-dashboard");
      return;
    }
    state.controller = normalizeControllerState(state.controller);
    // An older saved confirmation already contains its score. Only finish its rotation.
    if (state.controller.phase === "POINT_CONFIRMED") finalizePointDecision(false);
    const c = state.controller;
    const match = c.activeMatch;
    const pending = c.phase === "POINT_STOPPED_WAITING_DECISION";
    const locked = controllerEditingLocked();
    const kind = c.pointDraft?.kind;
    const edited = Object.values(c.pointDraft?.deltas || {}).some(value => value !== 0);
    const readyPoint = pending && !c.pointDraftError && (kind === "none" || ((kind === "approve" || kind === "reverse") && edited));
    const correcting = ["READY", "BREAK_PAUSED", "GAME_PAUSED", "MATCH_COMPLETE"].includes(c.phase);
    const scoreEnabled = !locked && !c.pointDraftError && (correcting || (pending && (kind === "approve" || kind === "reverse")));
    const visibleScore = side => {
      try { return previewPointScore(c, side); }
      catch { return scoreForPhysical(side); }
    };
    const next = currentDeckStyle() === "split" ? c.inactiveMatch : null;
    const field = state.fields.find(item => item.name === state.schedule.find(item => item.id === match.id)?.field) || state.fields[0];
    const view = {
      active: {
        label: "Game " + match.gameNumber,
        leftName: match.leftPhysicalTeam,
        rightName: match.rightPhysicalTeam,
        leftScore: visibleScore("left"),
        rightScore: visibleScore("right"),
        pitLeft: field?.pitLeft || "Pit 1",
        pitRight: field?.pitRight || "Pit 2",
        gameClock: state.event?.matchTerms?.mode === "RACE_TO" ? "TO " + state.event.matchTerms.raceTo : formatMs(c.gameMs),
        breakClock: formatMs(c.breakMs),
        status: controllerStatus(c)
      },
      inactive: next ? {
        label: "Game " + next.gameNumber,
        leftName: next.leftPhysicalTeam,
        rightName: next.rightPhysicalTeam,
        leftScore: scoreForPhysical("left", next),
        rightScore: scoreForPhysical("right", next),
        clock: state.event?.matchTerms?.mode === "RACE_TO" ? "TO " + state.event.matchTerms.raceTo : formatMs(next.gameMs)
      } : null,
      phase: c.phase,
      selectedType: kind,
      baseEnabled: !locked && ["POINT_LIVE", "GAME_PAUSED"].includes(c.phase),
      pauseEnabled: !locked && ["POINT_LIVE", "GAME_PAUSED", "BREAK_RUNNING", "BREAK_PAUSED"].includes(c.phase),
      paused: c.phase === "GAME_PAUSED" || c.phase === "BREAK_PAUSED",
      scoreEnabled,
      typeEnabled: !locked && pending && !c.pointDraftError,
      startBreakEnabled: !locked && (c.phase === "READY" || readyPoint),
      startBreakLabel: c.phase === "BREAK_RUNNING" ? "Break running" : c.phase === "BREAK_PAUSED" ? "Break paused" : "Start break",
      undoEnabled: !locked && c.undoStack.length > 0,
      breakEditable: !locked && !(state.event?.coinChallenge && c.phase === "MATCH_COMPLETE"),
      breakWarning: isFinalBreakCountdown(c.breakMs),
      scoreMinusLeftEnabled: scoreEnabled && visibleScore("left") > 0,
      scoreMinusRightEnabled: scoreEnabled && visibleScore("right") > 0,
      settled: locked,
      eventCode: state.event?.eventCode || null,
      hasEventTools: state.session?.type === "event" || Boolean(state.event?.matchTerms),
      completionMarkup: c.phase === "MATCH_COMPLETE" ? controllerCompletionPanel() : ""
    };
    page(renderControllerView(view), null, "controller-screen arena-screen");
    startFrame();
  }
  function scoreForPhysical(side, match = state.controller.activeMatch) {
    const teamId = side === "left" ? match.leftPhysicalTeamId : match.rightPhysicalTeamId;
    return teamId === match.leftTeamId ? match.leftScore : match.rightScore;
  }
  function controllerCompletionPanel() {
    const result = state.event?.coinResult;
    const controls = !state.event?.coinChallenge ? '<p>Final score saved.</p>'
      : result === "SETTLED" ? '<p>Official result saved · coins settled.</p>'
      : result === "REVIEW" ? '<p>Official result saved · awaiting review.</p>'
      : '<button type="button" class="primary wide" data-action="confirm-coin-result"' + (coinConfirming ? " disabled" : "") + '>' + (coinConfirming ? "Confirming…" : "Confirm final score") + '</button>';
    return '<section class="arena-result"><h3>Match complete</h3><p>Final score ' + scoreForPhysical("left") + ' — ' + scoreForPhysical("right") + '</p>' + controls + '</section>';
  }
  function showControllerTools() {
    const c = state.controller;
    const terms = state.event?.matchTerms;
    const betweenPoints = ["READY", "BREAK_RUNNING", "BREAK_PAUSED"].includes(c.phase);
    const timeouts = terms ? '<section class="controller-card"><h3>Team timeouts</h3><div class="button-row">' + ["left", "right"].map(side => {
      const id = side === "left" ? c.activeMatch.leftPhysicalTeamId : c.activeMatch.rightPhysicalTeamId;
      const name = side === "left" ? c.activeMatch.leftPhysicalTeam : c.activeMatch.rightPhysicalTeam;
      const remaining = Math.max(0, terms.timeoutsPerTeam - (c.timeoutsUsed?.[id] || 0));
      return '<button type="button" class="secondary" data-action="team-timeout" data-side="' + side + '"' + (!betweenPoints || !remaining || controllerEditingLocked() ? " disabled" : "") + '>' + escapeHtml(name) + ' · ' + remaining + ' left</button>';
    }).join("") + '</div></section>' : "";
    const rules = terms ? '<section class="controller-card"><h3>Agreed match rules</h3><p>Revision ' + escapeHtml(state.event.agreementRevision) + '</p><p>' + escapeHtml(terms.equipment) + ' · ' + escapeHtml(terms.fieldType) + ' · ' + terms.breakSeconds + 's breaks</p><p>' + escapeHtml(terms.penaltyRules) + '</p></section>' : "";
    const upcoming = state.schedule.filter(match => match.id !== c.activeMatch.id).slice(0, 5);
    const schedule = upcoming.length ? '<section class="controller-card"><h3>Next up</h3>' + upcoming.map(match => '<div class="list-row"><div><strong>' + escapeHtml(match.left) + ' vs ' + escapeHtml(match.right) + '</strong><small>' + escapeHtml(match.time) + ' · ' + escapeHtml(match.field) + '</small></div></div>').join("") + '</section>' : "";
    modalBody.innerHTML = '<h2>Event tools</h2>' + eventCodeControl() + timeouts + rules + schedule + '<div class="button-row"><button type="button" class="secondary" data-route="master-schedule">Full schedule</button><button type="button" class="secondary" data-route="standings">Standings</button></div>';
    modal.showModal();
  }

  function renderStandings() { page(`${topbar("Scores & Standings")}<section class="card"><span class="eyebrow">${escapeHtml(state.event.format || "EVENT")} · EVENT ID ${escapeHtml(state.activeEventId || state.event.id)}</span><div class="list">${state.standings.length ? state.standings.map((s,i) => `<div class="list-row"><strong style="width:22px">${i+1}</strong><div><strong>${s.team}</strong><small>${s.w} W · ${s.l} L</small></div><span class="status ${i<2?"good":""}">${s.diff >= 0 ? "+" : ""}${s.diff}</span></div>`).join("") : `<div class="empty">No scores have been recorded for this event.</div>`}</div></section>`, "event-dashboard"); }
  function renderPlayoffs() {
    const teams = state.standings.slice(0, 4).map((standing) => standing.team);
    const bracket = teams.length >= 4 ? `<h2>Semifinals</h2><div class="list"><div class="list-row"><div><strong>1 ${escapeHtml(teams[0])} vs 4 ${escapeHtml(teams[3])}</strong><small>Projected from this event's standings</small></div></div><div class="list-row"><div><strong>2 ${escapeHtml(teams[1])} vs 3 ${escapeHtml(teams[2])}</strong><small>Projected from this event's standings</small></div></div></div>` : `<div class="empty">This event does not have enough results to project playoffs.</div>`;
    page(`${topbar("Playoffs")}<section class="card"><span class="eyebrow">PROJECTED · NOT OFFICIAL</span>${bracket}</section>`, "event-dashboard");
  }
  function renderTeams() { page(`${topbar("Teams")}<div class="list">${state.teams.map((t,i) => `<button class="list-row" data-action="team-detail"><strong style="width:24px">${i+1}</strong><div><strong>${escapeHtml(t)}</strong><small>Roster managed in future player app</small></div><span>›</span></button>`).join("")}</div>`, "event-dashboard"); }
  function renderDivisions() { page(`${topbar("Divisions")}<div class="list">${state.divisions.map(d => `<button class="list-row"><div><strong>${escapeHtml(d.name)}</strong><small>${escapeHtml(d.teams)} teams · ${escapeHtml(d.format)}</small></div><span>›</span></button>`).join("")}</div>`, "event-dashboard"); }
  function renderFields() { page(`${topbar("Fields & Pits")}<div class="list">${state.fields.map(f => `<button class="list-row"><div><strong>${f.name}</strong><small>${f.pitLeft} · ${f.pitRight}</small></div><span class="status good">ACTIVE</span></button>`).join("")}</div>`, "event-dashboard"); }
  function renderStaff() { page(`${topbar("Staff")}<div class="list">${state.staff.map(s => `<button class="list-row"><div><strong>${s.name}</strong><small>${s.role}</small></div><span>›</span></button>`).join("")}</div><div class="card empty" style="margin-top:12px">Backend connection will provide invitations and permission assignments.</div>`, "event-dashboard"); }
  function renderActivity() { const log = getEventLog(); page(`${topbar("Activity Log")}<section class="card"><span class="eyebrow">APPEND-ONLY LOCAL AUDIT</span><div class="list">${log.length ? log.slice().reverse().map(a => `<div class="list-row"><div><strong>${a.type.replaceAll("_", " ")}</strong><small>${new Date(a.at).toLocaleString()}</small></div><span class="status">${a.syncStatus}</span></div>`).join("") : `<div class="empty">Actions will appear here immediately, even offline.</div>`}</div></section>`, "event-dashboard"); }
  function renderPublishing() { page(`${topbar("Publishing Center")}<section class="card"><span class="eyebrow">PUBLIC OUTPUTS</span><div class="list"><div class="list-row"><div><strong>Public schedule</strong><small>Awaiting backend URL</small></div><span class="status warn">NOT CONNECTED</span></div><div class="list-row"><div><strong>Live scores</strong><small>Local controller state ready</small></div><span class="status good">READY</span></div><div class="list-row"><div><strong>PBNetwork.tv overlay</strong><small>Contract placeholder included</small></div><span class="status">SCAFFOLDED</span></div></div></section>`, "event-dashboard"); }
  function renderSettings() { page(`${topbar("Settings & Recovery")}<section class="card"><span class="eyebrow">ACCOUNT</span><h2>${state.authMode === "member" ? (state.member?.screenName || state.member?.email || "PBN Member") : "Offline demo"}</h2><p class="muted">${state.authMode === "member" ? `${state.member?.email || ""} · securely remembered on this device` : "No PBN account is connected to this local demo."}</p>${state.authMode === "member" ? `<div class="button-row"><button class="secondary" data-action="sign-out">SIGN OUT</button><button class="danger" data-action="delete-account">DELETE ACCOUNT</button></div>` : ""}</section><section class="card" style="margin-top:12px"><span class="eyebrow">AUDIO CUES</span><button type="button" class="secondary wide" data-action="test-announcements">TEST ANNOUNCEMENTS</button><p class="muted">Play Base, the three point results, Game started, and Game stopped.</p><h2>Countdown sound</h2><p class="muted">Choose a sound. Each choice plays immediately so you can compare it.</p><div class="field"><label>Countdown beep</label><select id="countdownCue"><option value="field-reference-beep" ${state.audio?.countdownCue === "field-reference-beep" ? "selected" : ""}>Field controller reference</option><option value="scoreboard-beep" ${state.audio?.countdownCue === "scoreboard-beep" ? "selected" : ""}>Sharp electronic scoreboard</option><option value="referee-timer-beep" ${state.audio?.countdownCue === "referee-timer-beep" ? "selected" : ""}>Clean referee timer</option><option value="tournament-beep" ${state.audio?.countdownCue === "tournament-beep" ? "selected" : ""}>Loud tournament start system</option></select></div></section><section class="card" style="margin-top:12px"><span class="eyebrow">CONNECTION</span><h2>${state.connection.name}</h2><p class="muted">${state.connection.configured ? state.connection.baseUrl : `Account service: ${DEFAULT_API_ORIGIN}`}</p><button class="primary wide" data-action="connection">${state.connection.configured ? "UPDATE CONNECTION" : "SET UP CONNECTION"}</button></section><section class="card" style="margin-top:12px"><span class="eyebrow">RECOVERY</span><h2>Local event package</h2><p class="muted">${getEventLog().length} logged actions · ${state.sync.pending} awaiting sync</p><div class="button-row"><button class="secondary" data-action="export-log">EXPORT LOG</button><button class="danger" data-action="reset-all">RESET DEMO</button></div></section>`, "settings"); }

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
      const el = $("#breakClock"); if (el) { el.textContent = formatMs(remaining); el.classList.toggle("warning", isFinalBreakCountdown(remaining)); }
      announceCountdown(remaining);
      if (remaining <= 0) {
        c.breakMs = 0;
        c.phase = "POINT_LIVE";
        startAnchor("game", c.gameMs);
        const startedAt = c.activeAnchor.startedAt;
        const matchId = c.activeMatch.id;
        if (c.lastAnnouncement !== 0) {
          c.lastAnnouncement = 0;
          playCue("game-start-horn", synthHorn, () => {
            if (state.controller.phase === "POINT_LIVE" && state.controller.activeMatch.id === matchId && state.controller.activeAnchor?.startedAt === startedAt) speak("Game started");
          });
        }
        logAction("GAME_CLOCK_AUTO_STARTED", { gameMs: c.gameMs });
        renderController();
      }
    } else if (c.activeAnchor.kind === "game") {
      c.gameMs = remaining; c.activeMatch.gameMs = remaining;
      const el = $("#gameClock"); if (el && state.event?.matchTerms?.mode !== "RACE_TO") el.textContent = formatMs(remaining);
      if (remaining <= 0 && state.event?.matchTerms?.mode !== "RACE_TO") {
        stopControllerAudio();
        snapshotController();
        const next = beginPointDraft(c, 0, { id: crypto.randomUUID(), at: now() });
        next.undoStack = c.undoStack;
        next.breakMs = next.nextBreakMs ?? next.breakDefaultMs;
        state.controller = next;
        logAction("GAME_CLOCK_EXPIRED", { matchId: next.activeMatch.id, awaitingDecision: true });
        speak("Game stopped");
        renderController();
      }
    }
    if (Date.now() - lastClockPersist >= 1000) { lastClockPersist = Date.now(); save(); }
  }
  function announceCountdown(ms) {
    const seconds = Math.ceil(ms / 1000);
    if ([30, 20, 10].includes(seconds) && state.controller.lastAnnouncement !== seconds) {
      state.controller.lastAnnouncement = seconds;
      speak(`${seconds} seconds`, { interrupt: false });
      if (seconds === 10) playCountdownCue();
      return;
    }
    if (seconds > 0 && seconds <= 10 && state.controller.lastAnnouncement !== seconds) {
      state.controller.lastAnnouncement = seconds;
      playCountdownCue();
    }
  }
  function playCountdownCue() { playCue(state.audio?.countdownCue || "field-reference-beep", () => tone(1450, .16)); }
  function unlockCueAudio() {
    return controllerAudio.prepare(state.audio?.countdownCue || "field-reference-beep");
  }
  function stopControllerAudio() {
    cueSequence += 1;
    clearTimeout(cueCompletionTimer);
    cueCompletionTimer = null;
    void controllerAudio.stop();
  }
  function playCue(name, fallback, onFinished) {
    const sequence = ++cueSequence;
    clearTimeout(cueCompletionTimer);
    cueCompletionTimer = null;
    const finish = () => { if (sequence === cueSequence) onFinished?.(); };
    void controllerAudio.playCue(name).then(finish, error => {
      if (sequence !== cueSequence || isAudioCancellation(error)) return;
      fallback?.();
      if (onFinished) cueCompletionTimer = setTimeout(finish, 2050);
    });
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
  function speak(text, options) { void controllerAudio.say(text, options); }
  function testAnnouncements() {
    stopControllerAudio();
    void unlockCueAudio();
    ["Base", "Point approved", "Point reversed", "No points", "Game started", "Game stopped"].forEach((text, index) => speak(text, { interrupt: index === 0 }));
  }
  function snapshotController() {
    const { undoStack, ...current } = state.controller;
    const snapshot = clone(current);
    if (snapshot.activeAnchor) {
      const remaining = anchoredRemaining(snapshot.activeAnchor);
      if (snapshot.activeAnchor.kind === "break") snapshot.breakMs = remaining;
      else {
        snapshot.gameMs = remaining;
        if (snapshot.activeMatch) snapshot.activeMatch.gameMs = remaining;
      }
      snapshot.activeAnchor = { kind: snapshot.activeAnchor.kind, startedAt: Date.now(), startingMs: remaining };
    }
    state.controller.undoStack = [...undoStack, snapshot].slice(-20);
  }
  function pauseClock() {
    if (controllerEditingLocked()) return;
    const c = state.controller;
    if (!["BREAK_RUNNING", "POINT_LIVE", "BREAK_PAUSED", "GAME_PAUSED"].includes(c.phase)) return;
    stopControllerAudio();
    snapshotController();
    if (c.phase === "BREAK_RUNNING") {
      c.breakMs = c.activeAnchor ? anchoredRemaining(c.activeAnchor) : c.breakMs;
      c.phase = "BREAK_PAUSED";
      c.activeAnchor = null;
    } else if (c.phase === "POINT_LIVE") {
      c.gameMs = c.activeAnchor ? anchoredRemaining(c.activeAnchor) : c.gameMs;
      c.activeMatch.gameMs = c.gameMs;
      c.phase = "GAME_PAUSED";
      c.activeAnchor = null;
    } else if (c.phase === "BREAK_PAUSED") {
      c.phase = "BREAK_RUNNING";
      startAnchor("break", c.breakMs);
    } else {
      c.phase = "POINT_LIVE";
      startAnchor("game", c.gameMs);
    }
    const paused = c.phase.endsWith("PAUSED");
    logAction(paused ? "CLOCK_PAUSED" : "CLOCK_RESUMED", { phase: c.phase });
    if (paused) speak("Game stopped");
    else if (c.phase === "POINT_LIVE") speak("Game started");
    renderController();
  }
  function base() {
    if (controllerEditingLocked()) return;
    const c = state.controller;
    if (!["POINT_LIVE", "GAME_PAUSED"].includes(c.phase)) return;
    stopControllerAudio();
    const remaining = c.activeAnchor ? anchoredRemaining(c.activeAnchor) : c.gameMs;
    const next = beginPointDraft(c, remaining, { id: crypto.randomUUID(), at: now() });
    next.breakMs = next.nextBreakMs ?? next.breakDefaultMs;
    snapshotController();
    next.undoStack = c.undoStack;
    state.controller = next;
    logAction("BASE", { pointId: next.pointDraft.id, matchId: next.activeMatch.id, gameMs: remaining });
    speak("Base");
    renderController();
  }
  function choosePointType(kind) {
    if (controllerEditingLocked()) return;
    try {
      const next = selectPointType(state.controller, kind);
      if (kind === state.controller.pointDraft?.kind) return;
      snapshotController();
      next.undoStack = state.controller.undoStack;
      state.controller = next;
      logAction("POINT_TYPE_SELECTED", { pointId: next.pointDraft.id, kind });
      renderController();
    } catch (error) { toast(error.message); }
  }
  function adjustScore(side, delta) {
    if (controllerEditingLocked() || !["left", "right"].includes(side)) return;
    const c = state.controller;
    const match = c.activeMatch;
    if (!match) return;
    const teamId = side === "left" ? match.leftPhysicalTeamId : match.rightPhysicalTeamId;
    if (c.phase === "POINT_STOPPED_WAITING_DECISION") {
      try {
        const next = adjustPointScore(c, side, delta);
        if (previewPointScore(next, side) === previewPointScore(c, side)) return;
        snapshotController();
        next.undoStack = c.undoStack;
        state.controller = next;
        logAction("POINT_SCORE_ADJUSTED", { pointId: next.pointDraft.id, teamId, side, delta });
      } catch (error) { return toast(error.message); }
    } else {
      if (!["READY", "BREAK_PAUSED", "GAME_PAUSED", "MATCH_COMPLETE"].includes(c.phase)) return;
      const key = teamId === match.leftTeamId ? "leftScore" : "rightScore";
      const value = Math.max(0, Math.min(1000, match[key] + delta));
      if (value === match[key]) return;
      snapshotController();
      match[key] = value;
      logAction("MANUAL_SCORE_CORRECTION", { matchId: match.id, teamId, side, delta });
    }
    renderController();
  }
  function startBreak() {
    if (controllerEditingLocked()) return;
    const c = state.controller;
    if (c.phase === "POINT_STOPPED_WAITING_DECISION") {
      if (currentDeckStyle() === "split" && !c.inactiveMatch) return toast("No second match is assigned to this event.");
      try {
        const result = commitPointDraft(c, { at: now() });
        stopControllerAudio();
        snapshotController();
        result.controller.undoStack = c.undoStack;
        state.controller = result.controller;
        logAction(result.decision.kind === "approve" ? "POINT_APPROVED" : result.decision.kind === "reverse" ? "POINT_REVERSED" : "NO_POINT", result.decision);
        finalizePointDecision(false);
        ensureAudio();
        void unlockCueAudio();
        // Exactly one outcome voice, after the complete result has been saved.
        speak(result.voice);
        renderController();
      } catch (error) { toast(error.message); }
      return;
    }
    if (c.phase !== "READY") return;
    stopControllerAudio();
    snapshotController();
    const ms = c.breakMs || c.breakDefaultMs;
    c.breakMs = ms;
    c.phase = "BREAK_RUNNING";
    c.lastAnnouncement = null;
    startAnchor("break", ms);
    logAction("BREAK_STARTED", { ms });
    ensureAudio();
    void unlockCueAudio();
    speak(spokenDuration(ms));
    renderController();
  }
  function controllerMatchComplete(match) {
    if (match.complete) return true;
    const terms = state.event?.matchTerms;
    if (terms?.mode === "RACE_TO") {
      return Math.max(match.leftScore, match.rightScore) >= terms.raceTo && match.leftScore !== match.rightScore;
    }
    return match.gameMs <= 0 || raceToComplete(match, state.session.format, state.session.pointLimit, "single");
  }
  function finalizePointDecision(shouldRender = true) {
    const c = state.controller;
    if (c.phase !== "POINT_CONFIRMED") return;
    const confirmation = c.pointConfirmation;
    if (confirmation?.matchId && confirmation.matchId !== c.activeMatch.id) {
      c.phase = "GAME_PAUSED";
      c.activeAnchor = null;
      c.pointDraftError = "This saved result belongs to another match. Use Undo to recover it.";
      save();
      if (shouldRender) renderController();
      return;
    }
    const pointAwarded = confirmation?.kind === "approve" || confirmation?.kind === "reverse";
    c.activeMatch.gameMs = c.gameMs;
    if (pointAwarded) {
      [c.activeMatch.leftPhysicalTeamId, c.activeMatch.rightPhysicalTeamId] = [c.activeMatch.rightPhysicalTeamId, c.activeMatch.leftPhysicalTeamId];
      [c.activeMatch.leftPhysicalTeam, c.activeMatch.rightPhysicalTeam] = [c.activeMatch.rightPhysicalTeam, c.activeMatch.leftPhysicalTeam];
    }
    c.activeMatch.complete = controllerMatchComplete(c.activeMatch);
    c.pointConfirmation = null;
    c.pointDraft = null;
    c.pendingBaseSide = null;
    c.sideSwapFading = false;
    const shouldRotate = currentDeckStyle() === "split" && c.inactiveMatch && !c.inactiveMatch.complete;
    if (shouldRotate) {
      [c.activeMatch, c.inactiveMatch] = [c.inactiveMatch, c.activeMatch];
      c.gameMs = c.activeMatch.gameMs;
    }
    if (c.activeMatch.complete) {
      c.phase = "MATCH_COMPLETE";
      c.activeAnchor = null;
      logAction("MATCH_COMPLETED", { matchId: c.activeMatch.id });
    } else {
      c.breakMs = c.nextBreakMs ?? c.breakDefaultMs;
      delete c.nextBreakMs;
      c.phase = "BREAK_RUNNING";
      const seconds = Math.ceil(c.breakMs / 1000);
      // Do not let an immediate 30/20/10 call cancel the point announcement.
      c.lastAnnouncement = [30, 20, 10].includes(seconds) ? seconds : null;
      startAnchor("break", c.breakMs);
      if (shouldRotate) logAction("ACTIVE_INACTIVE_SWAPPED", { activeMatchId: c.activeMatch.id });
      logAction("BREAK_STARTED", { ms: c.breakMs, pointId: confirmation?.pointId });
    }
    save();
    if (shouldRender) renderController();
  }
  function undo() {
    if (controllerEditingLocked()) return;
    const undoStack = state.controller.undoStack;
    const snapshot = undoStack.pop();
    if (!snapshot) return toast("Nothing to undo.");
    state.controller = normalizeControllerState({ ...clone(snapshot), undoStack });
    const c = state.controller;
    if (c.activeAnchor) {
      const ms = c.activeAnchor.kind === "break" ? c.breakMs : c.gameMs;
      c.activeAnchor = { kind: c.activeAnchor.kind, startedAt: Date.now(), startingMs: ms };
    }
    stopControllerAudio();
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
    if (controllerEditingLocked() || !Number.isFinite(ms) || ms < 5000 || ms > 1500000) return;
    if (clockPickerMode === "default" && state.event?.matchTerms) return toast("The default break is fixed by the Coaches' agreement.");
    snapshotController();
    const wasRunning = c.phase === "BREAK_RUNNING";
    const wasPaused = c.phase === "BREAK_PAUSED";
    c.breakMs = ms;
    c.lastAnnouncement = null;
    if (clockPickerMode === "default") c.breakDefaultMs = ms;
    if (wasRunning) { c.phase = "BREAK_RUNNING"; startAnchor("break", ms); }
    else if (wasPaused) { c.phase = "BREAK_PAUSED"; c.activeAnchor = null; }
    else if (["POINT_LIVE", "GAME_PAUSED", "POINT_STOPPED_WAITING_DECISION"].includes(c.phase)) c.nextBreakMs = ms;
    logAction(clockPickerMode === "default" ? "BREAK_DEFAULT_CHANGED" : "BREAK_CLOCK_JUMPED", { ms, running: wasRunning, paused: wasPaused });
    ensureAudio();
    speak(spokenDuration(ms));
    modal.close();
    renderController();
  }
  function showConnection() {
    const mode = state.connection.baseUrl ? "custom" : "default";
    modalBody.innerHTML = `<h2>Connect PBN Backend</h2><div class="field-grid">
      ${selectField("connectionMode", "Backend", [["default", "PBNetwork.tv"], ["custom", "Custom server…"]], mode)}
      <div class="field"><label for="connectionUrl">Backend base URL</label><input id="connectionUrl" type="url" placeholder="https://api.example.com" value="${escapeHtml(state.connection.baseUrl)}" required aria-describedby="connectionHint"><p id="connectionHint" class="form-note muted">Store the public base URL here. Configure <strong>PBN_BACKEND_ACCESS_TOKEN</strong> in the engine after import.</p></div>
    </div><button class="primary wide form-save" type="button" data-action="save-connection">SAVE CONNECTION</button>`;
    updateConnectionMode(mode);
    modal.showModal();
  }
  function updateConnectionMode(mode) {
    const url = $("#connectionUrl");
    url.disabled = mode !== "custom";
    url.closest(".field").hidden = url.disabled;
  }
  function saveConnection() {
    const url = $("#connectionUrl");
    if (!url.reportValidity()) return;
    const value = url.disabled ? "" : url.value.trim();
    state.connection.baseUrl = value;
    state.connection.configured = Boolean(value);
    venueDirectoryRequest = null;
    save();
    modal.close();
    toast(value ? "Custom connection saved." : "Default PBN connection saved.");
    render();
  }
  function showScrimmageSetup() {
    modalBody.innerHTML = `<h2>Start a Scrimmage</h2><p class="muted">Single Deck is the simplest two-team setup. Choose Split Deck when four teams are rotating.</p><div class="field-grid"><div class="field"><label>Deck style</label><select id="scrimmageDeck"><option value="single">Single Deck (2 teams)</option><option value="split">Split Deck (4 teams)</option></select></div><div class="field"><label>Scoring format</label><select id="scrimmageFormat"><option value="race-to">Race-to</option><option value="uncapped">Uncapped points</option></select></div><div class="field"><label>Point limit</label><select id="scrimmagePointLimit">${[1,2,3,4,5,6,7].map(n => `<option value="${n}" ${n === 3 ? "selected" : ""}>${n} points</option>`).join("")}</select></div><div class="field"><label>Left team</label><input id="scrimmageLeft" value="TEAM 1" maxlength="24"></div><div class="field"><label>Right team</label><input id="scrimmageRight" value="TEAM 2" maxlength="24"></div><div id="splitDeckTeams" class="field-grid hidden"><div class="field"><label>Second match — left team</label><input id="scrimmageNextLeft" value="TEAM 3" maxlength="24"></div><div class="field"><label>Second match — right team</label><input id="scrimmageNextRight" value="TEAM 4" maxlength="24"></div></div></div><button class="primary wide" style="margin-top:16px" type="button" data-action="start-scrimmage">OPEN CONTROLLER</button>`;
    modal.showModal();
  }
  function localDateValue() {
    const today = new Date();
    return [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
  }
  function parkActiveWorkspace() {
    if (coinConfirming) {
      toast("Wait for the current result to finish saving, then try again.");
      return false;
    }
    stopFrame();
    stopControllerAudio();
    const controller = state.controller;
    const anchor = controller?.activeAnchor;
    if (anchor) {
      const remaining = anchoredRemaining(anchor);
      if (anchor.kind === "break") {
        controller.breakMs = remaining;
        controller.phase = "BREAK_PAUSED";
      } else {
        controller.gameMs = remaining;
        if (controller.activeMatch) controller.activeMatch.gameMs = remaining;
        controller.phase = "GAME_PAUSED";
      }
      controller.activeAnchor = null;
    }
    save();
    return true;
  }
  function resumeSavedSession(eventId) {
    const stored = state.eventWorkspaces?.[eventId];
    if (!stored?.event || stored.event.id !== eventId) return toast("That saved session could not be found on this device.");
    if (stored.event.source === "PBN") {
      const shared = (state.remoteEvents || []).find(event => event.id === eventId);
      if (!shared) return toast("Reopen this shared event from My PBN events when it is available.");
      return void activateRemoteEvent(shared);
    }
    if (state.activeEventId === eventId) return route(state.session?.active ? "live-controller" : "event-dashboard");
    const workspace = clone(stored);
    if (!parkActiveWorkspace()) return;
    state.activeEventId = eventId;
    state.event = workspace.event;
    if (workspace.league) state.league = workspace.league;
    for (const key of ["divisions", "teams", "fields", "staff", "schedule", "standings"]) state[key] = clone(workspace[key] || []);
    state.controller = normalizeControllerState(workspace.controller || emptyControllerForEvent(eventId));
    // A saved session is reopened at its saved clock, never restarted in the background.
    if (state.controller.activeAnchor) {
      const anchor = state.controller.activeAnchor;
      const remaining = anchoredRemaining(anchor);
      if (anchor.kind === "break") state.controller.breakMs = remaining;
      else {
        state.controller.gameMs = remaining;
        if (state.controller.activeMatch) state.controller.activeMatch.gameMs = remaining;
      }
      state.controller.phase = anchor.kind === "break" ? "BREAK_PAUSED" : "GAME_PAUSED";
      state.controller.activeAnchor = null;
    }
    state.scheduleDraft = clone(workspace.scheduleDraft || { ...defaultState.scheduleDraft, eventId, fields: state.fields.length, generated: false, published: false });
    state.session = clone(workspace.session || { ...defaultState.session, eventId, label: state.event.name });
    coinConfirming = false;
    logAction("SAVED_SESSION_OPENED", { eventId });
    route(state.session.active && state.controller.activeMatch ? "live-controller" : "event-dashboard");
  }
  function showNewEventSetup() {
    const date = localDateValue();
    modalBody.innerHTML = `<h2>Start New Event</h2><span class="eyebrow">LOCAL PLANNED EVENT</span><p class="muted">Create an event on this device with its own opening matches. Shared PBN events and event codes are created on PBNetwork.tv.</p>
      ${state.session?.active ? `<p class="muted">Creating this event pauses and saves your current session so you can return to it.</p>` : ""}
      <div class="field-grid">
        <div class="field"><label for="newEventName">Event name</label><input id="newEventName" maxlength="100" required placeholder="Practice day or tournament name"></div>
        <div class="field"><label for="eventStartDate">Date</label><input id="eventStartDate" type="date" value="${date}" required></div>
        <div class="field"><label for="newEventStartTime">First match</label><input id="newEventStartTime" type="time" value="09:00" required></div>
        <div class="field" hidden><label for="venueRegion">Venue region</label><select id="venueRegion"><option value="">All regions</option></select></div>
        <div class="field"><label for="eventVenue">Venue</label><select id="eventVenue" required>${optionMarkup(venueOptions("", ""), "")}</select></div>
        <div class="field" hidden><label for="customVenue">Venue name</label><input id="customVenue" maxlength="160" disabled></div>
        ${selectField("eventFormat", "Scoring preset", SCORING_PRESETS, "Race-to")}
        ${selectField("eventPointLimit", "Race-to points", numberOptions(1, 7, n => `${n} ${n === 1 ? "point" : "points"}`), 3)}
        ${selectField("newEventDeck", "Deck style", [["single", "Single Deck (2 teams)"], ["split", "Split Deck (4 teams)"]], "single")}
        ${selectField("newEventField", "Opening field", numberOptions(1, 32, n => `Field ${n}`), 1)}
        <div class="field"><label for="newEventDivision">Opening division</label><input id="newEventDivision" value="Open" maxlength="60" required></div>
        <div class="field"><label for="newEventLeft">Game 1 — left team</label><input id="newEventLeft" maxlength="24" required placeholder="Team 1"></div>
        <div class="field"><label for="newEventRight">Game 1 — right team</label><input id="newEventRight" maxlength="24" required placeholder="Team 2"></div>
        <div id="newEventSplitTeams" class="field-grid hidden"><div class="field"><label for="newEventNextLeft">Game 2 — left team</label><input id="newEventNextLeft" maxlength="24" required disabled placeholder="Team 3"></div><div class="field"><label for="newEventNextRight">Game 2 — right team</label><input id="newEventNextRight" maxlength="24" required disabled placeholder="Team 4"></div></div>
      </div><div class="button-row"><button class="secondary" value="cancel" formnovalidate>CANCEL</button><button class="primary" type="button" data-action="create-local-event">CREATE EVENT</button></div>`;
    modal.querySelector(".close").formNoValidate = true;
    modal.showModal();
    refreshVenueOptions();
    updateEventPointLimit("Race-to");
    loadVenueDirectory();
  }
  function createLocalEvent() {
    if (!modal.querySelector("form").reportValidity()) return;
    const name = $("#newEventName").value.trim();
    const date = $("#eventStartDate").value;
    const startTime = $("#newEventStartTime").value;
    const venue = $("#eventVenue").value === OTHER_VENUE ? $("#customVenue").value.trim() : $("#eventVenue").value;
    const format = $("#eventFormat").value;
    const pointLimit = format === "Race-to" ? Number($("#eventPointLimit").value) : null;
    const deckStyle = $("#newEventDeck").value;
    const fieldName = `Field ${$("#newEventField").value}`;
    const divisionName = $("#newEventDivision").value.trim();
    const teams = [$("#newEventLeft").value.trim(), $("#newEventRight").value.trim()];
    if (deckStyle === "split") teams.push($("#newEventNextLeft").value.trim(), $("#newEventNextRight").value.trim());
    if (!name || !venue || !divisionName || teams.some(team => !team)) return toast("Enter an event name, venue, division, and each team name.");
    const eventId = `local-event-${crypto.randomUUID()}`;
    if (!parkActiveWorkspace()) return;
    state.activeEventId = eventId;
    state.event = { id: eventId, source: "local", eventType: "Planned event", name, startDate: date, endDate: date, startTime, date: remoteEventDateLabel({ startDate: date, endDate: date, startTime }), venue, format, pointLimit, deckStyle, status: "Draft" };
    state.league = { id: `${eventId}-league`, name: "Local planned event", season: date.slice(0, 4) };
    const divisionId = `${eventId}-division-1`;
    const fieldId = `${eventId}-field-1`;
    state.divisions = [{ id: divisionId, name: divisionName, teams: teams.length, format }];
    state.teams = teams;
    state.fields = [{ id: fieldId, name: fieldName, pitLeft: "Pit 1", pitRight: "Pit 2" }];
    state.staff = [];
    state.standings = [];
    const [hours, minutes] = startTime.split(":").map(Number);
    state.schedule = Array.from({ length: teams.length / 2 }, (_, index) => {
      const slot = (hours * 60 + minutes + index * 20) % (24 * 60);
      return { id: `${eventId}-match-${index + 1}`, eventId, divisionId, fieldId, time: `${String(Math.floor(slot / 60)).padStart(2, "0")}:${String(slot % 60).padStart(2, "0")}`, field: fieldName, left: teams[index * 2], right: teams[index * 2 + 1], status: index ? "Scheduled" : "On deck" };
    });
    state.controller = emptyControllerForEvent(eventId);
    state.scheduleDraft = { ...clone(defaultState.scheduleDraft), eventId, step: 1, days: 1, fields: 1, start: startTime, breaks: "", generated: true, published: false, version: 1 };
    state.session = { active: false, type: "event", eventId, label: name, format, pointLimit, deckStyle };
    logAction("LOCAL_EVENT_CREATED", { eventId, deckStyle, teams: teams.length, matches: state.schedule.length });
    modal.close();
    route("event-dashboard");
  }
  function teamId(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`; }
  function scrimmageMatch(id, left, right, eventId = state.activeEventId || state.event?.id || null) {
    const leftTeamId = teamId(`${id}-left`);
    const rightTeamId = teamId(`${id}-right`);
    return { id, eventId, leftTeamId, rightTeamId, leftTeam: left, rightTeam: right, leftScore: 0, rightScore: 0, leftPhysicalTeamId: leftTeamId, rightPhysicalTeamId: rightTeamId, leftPhysicalTeam: left, rightPhysicalTeam: right, gameMs: 600000 };
  }
  function startScrimmage() {
    const left = $("#scrimmageLeft").value.trim() || "TEAM 1";
    const right = $("#scrimmageRight").value.trim() || "TEAM 2";
    const format = $("#scrimmageFormat").value;
    const pointLimit = Number($("#scrimmagePointLimit").value);
    const deckStyle = $("#scrimmageDeck").value;
    const c = clone(defaultState.controller);
    const localEventId = `local-scrimmage-${crypto.randomUUID()}`;
    if (!parkActiveWorkspace()) return;
    state.activeEventId = localEventId;
    const date = localDateValue();
    state.event = { id: localEventId, source: "local", eventType: "Paintball scrimmage", name: `${left} vs ${right}`, date, startDate: date, endDate: date, venue: "Local practice", format, pointLimit: format === "race-to" ? pointLimit : "", status: "Local" };
    c.eventId = localEventId;
    c.activeMatch = scrimmageMatch(`scrimmage-${Date.now()}`, left, right, localEventId);
    if (deckStyle === "split") {
      const nextLeft = $("#scrimmageNextLeft").value.trim() || "TEAM 3";
      const nextRight = $("#scrimmageNextRight").value.trim() || "TEAM 4";
      c.inactiveMatch = scrimmageMatch(`scrimmage-next-${Date.now()}`, nextLeft, nextRight, localEventId);
    } else c.inactiveMatch = null;
    state.controller = normalizeControllerState(c);
    state.league = { id: `${localEventId}-league`, name: "Local practice", season: date.slice(0, 4) };
    state.divisions = [];
    state.teams = [c.activeMatch.leftTeam, c.activeMatch.rightTeam, ...(c.inactiveMatch ? [c.inactiveMatch.leftTeam, c.inactiveMatch.rightTeam] : [])];
    state.fields = [{ id: `${localEventId}-field-1`, name: "Practice field", pitLeft: "Pit 1", pitRight: "Pit 2" }];
    state.staff = [];
    state.schedule = [];
    state.standings = [];
    state.scheduleDraft = { ...clone(defaultState.scheduleDraft), eventId: localEventId, days: 1, fields: 1, generated: false, published: false };
    state.session = { active: true, type: "scrimmage", eventId: localEventId, label: `${left} vs ${right}`, format, pointLimit, deckStyle };
    logAction("SCRIMMAGE_STARTED", { left, right, format, pointLimit, deckStyle });
    modal.close();
    route("live-controller");
  }
  function runEvent() {
    const eventId = state.activeEventId || state.event?.id;
    if (!eventId || eventId !== state.event?.id) return toast("This event could not be identified. Reopen it from My PBN events.");
    if (!state.schedule.length) return toast("Add teams and build a schedule before running this event.");
    const configuredDeck = state.event.matchTerms?.deckStyle || state.event.deckStyle;
    if (!state.session?.active || state.session?.type !== "event" || state.session?.eventId !== eventId || !state.controller?.activeMatch) {
      const c = clone(defaultState.controller);
      const active = state.schedule[0];
      const inactive = state.schedule[1];
      if (active.eventId && active.eventId !== eventId) return toast("That match belongs to a different event.");
      c.eventId = eventId;
      c.activeMatch = scrimmageMatch(active.id, active.left, active.right, eventId);
      c.inactiveMatch = controllerDeckStyle(configuredDeck, Boolean(inactive)) === "split" ? scrimmageMatch(inactive.id, inactive.left, inactive.right, eventId) : null;
      state.controller = applyMatchTerms(c,state.event.matchTerms);
    }
    const deckStyle = controllerDeckStyle(configuredDeck, Boolean(state.controller.inactiveMatch));
    if (deckStyle === "single") state.controller.inactiveMatch = null;
    state.session = { active: true, type: "event", eventId, label: state.event.name, format: state.event.format, pointLimit: state.event.pointLimit || null, deckStyle };
    logAction("EVENT_CONTROL_OPENED", { eventId });
    route("live-controller");
  }
  function exportLog() {
    const blob = new Blob([JSON.stringify({ exportedAt: now(), eventId: state.activeEventId || state.event?.id, event: state.event, actions: getEventLog() }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "pbn-event-action-log.json"; a.click(); URL.revokeObjectURL(url); toast("Local action log exported.");
  }

  async function submitAuthentication(form) {
    if (authBusy) return;
    authBusy = true;
    renderLogin();
    const isSignUp = form.id === "signUpForm";
    const body = {
      email: form.querySelector("#authEmail")?.value.trim(),
      password: form.querySelector("#authPassword")?.value,
    };
    if (isSignUp) Object.assign(body, {
      firstName: form.querySelector("#authFirstName")?.value.trim(),
      lastName: form.querySelector("#authLastName")?.value.trim(),
      confirmPassword: form.querySelector("#authConfirmPassword")?.value,
      agreeToTerms: Boolean(form.querySelector("#authTerms")?.checked),
    });
    try {
      const session = await authRequest(`/api/mobile-auth/${isSignUp ? "sign-up" : "sign-in"}`, { method: "POST", body: JSON.stringify(body) });
      await acceptAuthSession(session);
      toast(isSignUp ? "PBN account created." : "Signed in securely.");
    } catch (error) {
      authBusy = false;
      renderLogin();
      const errorElement = $("#authError");
      if (errorElement) errorElement.textContent = error.message || "Unable to sign in right now.";
    }
    authBusy = false;
  }

  async function signOut() {
    const session = await readSecureSession();
    try {
      if (session?.token) await authRequest("/api/mobile-auth/sign-out", { method: "POST" }, session.token);
    } catch { /* local sign-out must still complete */ }
    await clearSecureSession();
    state.authenticated = false;
    state.authMode = null;
    state.member = null;
    state.route = "login";
    save();
    render();
  }

  function confirmAccountDeletion() {
    modalBody.innerHTML = `<h2>Delete PBN account?</h2><p class="muted">Your account will be disabled immediately and scheduled for permanent deletion. This signs you out everywhere.</p><div class="button-row"><button class="secondary" value="cancel">CANCEL</button><button class="danger" type="button" data-action="confirm-delete-account">DELETE ACCOUNT</button></div>`;
    modal.showModal();
  }

  async function deleteAccount() {
    const session = await readSecureSession();
    if (!session?.token) return signOut();
    try {
      await authRequest("/api/mobile-auth/delete-account", { method: "DELETE" }, session.token);
      modal.close();
      await signOut();
      toast("Account scheduled for deletion.");
    } catch (error) { toast(error.message || "Account deletion failed."); }
  }

  function emptyControllerForEvent(eventId) {
    const controller = clone(defaultState.controller);
    controller.eventId = eventId;
    controller.activeMatch = null;
    controller.inactiveMatch = null;
    controller.phase = "READY";
    controller.activeAnchor = null;
    controller.pendingBaseSide = null;
    controller.pointHistory = [];
    controller.undoStack = [];
    return controller;
  }

  async function activateRemoteEvent(selected) {
    if (coinConfirming) return toast("Wait for the current result to finish saving, then try again.");
    const previousEventId = state.activeEventId;
    save();
    await restoreControllerWorkspace(selected.id);
    if (state.activeEventId !== previousEventId || modal.open) return;
    const eventId = selected.id;
    const stored = state.eventWorkspaces?.[eventId];
    if (eventId !== state.activeEventId && !parkActiveWorkspace()) return;
    const eventRecord = {
      ...(stored?.event || {}),
      id: eventId,
      source: "PBN",
      eventCode: selected.eventCode || stored?.event?.eventCode,
      name: String(selected.name).replace(/[<>"`]/g, ""),
      date: remoteEventDateLabel(selected),
      ...eventDates(selected),
      venue: String(selected.venue).replace(/[<>"`]/g, ""),
      format: selected.format || selected.eventType,
      eventType: selected.eventType,
      pointLimit: selected.pointLimit || "",
      matchTerms: selected.matchTerms || null,
      agreementRevision: selected.agreementRevision || null,
      coinChallenge: selected.coinChallenge === true,
      coinResult: stored?.event?.coinResult || selected.coinResult || null,
      deckStyle: selected.deckStyle || "",
      visibility: selected.visibility,
      status: selected.status === "DRAFT" ? "Draft" : selected.status
    };
    const settings = eventRecord.controllerSettings;
    if (eventSettingsLocked(eventRecord)) {
      delete eventRecord.controllerSettings;
    } else if (settings) {
      const { name, startDate, endDate, startTime, venue, format, pointLimit } = settings;
      Object.assign(eventRecord, { name, startDate, endDate, startTime, venue, format, pointLimit, date: remoteEventDateLabel(settings) });
    }
    const scheduleSource = stored?.schedule || (Array.isArray(selected.schedule) ? selected.schedule : []);
    const schedule = scheduleSource.map((match) => ({ ...match, left: String(match.left).replace(/[<>"`]/g, ""), right: String(match.right).replace(/[<>"`]/g, ""), eventId }));
    state.activeEventId = eventId;
    coinConfirming = false;
    state.event = eventRecord;
    if (stored?.league) state.league = clone(stored.league);
    state.divisions = clone(stored?.divisions || (Array.isArray(selected.divisions) ? selected.divisions : []));
    state.teams = clone(stored?.teams || (Array.isArray(selected.teams) ? selected.teams : []));
    state.fields = clone(stored?.fields || (Array.isArray(selected.fields) ? selected.fields : []));
    state.staff = clone(stored?.staff || (Array.isArray(selected.staff) ? selected.staff : []));
    state.schedule = clone(schedule);
    state.standings = clone(stored?.standings || (Array.isArray(selected.standings) ? selected.standings : []));
    state.controller = normalizeControllerState(clone(stored?.controller?.eventId === eventId ? stored.controller : emptyControllerForEvent(eventId)));
    state.scheduleDraft = clone(stored?.scheduleDraft || { ...defaultState.scheduleDraft, eventId, days: selected.endDate && selected.endDate !== selected.startDate ? 2 : 1, fields: 0, generated: false, published: false });
    const session = stored?.session?.eventId === eventId ? stored.session : { active: false, type: null, eventId, deckStyle: eventRecord.deckStyle || null };
    state.session = { ...session, label: eventRecord.name, format: eventRecord.format, pointLimit: eventRecord.pointLimit || null };
    logAction("REMOTE_EVENT_OPENED", { eventId });
    route("event-dashboard");
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button"); if (!button || button.disabled) return;
    if (button.dataset.route) return route(button.dataset.route);
    if (button.dataset.clockSeconds) {
      setBreakClock(Number(button.dataset.clockSeconds) * 1000); return;
    }
    const action = button.dataset.action;
    if (action === "demo-login") { state.authenticated = true; state.authMode = "demo"; logAction("OFFLINE_DEMO_STARTED"); route("command-home"); }
    else if (action === "toggle-auth") { authView = authView === "sign-in" ? "sign-up" : "sign-in"; renderLogin(); }
    else if (action === "open-remote-event") {
      const selected = (state.remoteEvents || []).find((item) => item.id === button.dataset.eventId);
      if (!selected) return toast("That PBN event is no longer available.");
      void activateRemoteEvent(selected);
    }
    else if (action === "copy-event-code") void copyEventCode();
    else if (action === "share-staff-invite") void shareStaffInvite();
    else if (action === "send-staff-invite") void sendStaffInvite();
    else if (action === "copy-staff-day") void copyStaffDayLink();
    else if (action === "sign-out") signOut();
    else if (action === "delete-account") confirmAccountDeletion();
    else if (action === "confirm-delete-account") deleteAccount();
    else if (action === "open-scrimmage") showScrimmageSetup();
    else if (action === "start-scrimmage") startScrimmage();
    else if (action === "open-new-event") showNewEventSetup();
    else if (action === "create-local-event") createLocalEvent();
    else if (action === "resume-saved-session") resumeSavedSession(button.dataset.eventId);
    else if (action === "run-event") runEvent();
    else if (action === "connection") showConnection();
    else if (action === "save-connection") saveConnection();
    else if (action === "test-announcements") testAnnouncements();
    else if (action === "schedule-back") {
      saveScheduleStep(button.form);
      state.scheduleDraft.step = Math.max(1, state.scheduleDraft.step - 1);
      save();
      renderScheduleBuilder();
    }
    else if (action === "publish-schedule") { state.scheduleDraft.published = true; state.event.status = "Published"; logAction("SCHEDULE_PUBLISHED", { version: state.scheduleDraft.version }); renderMasterSchedule(); }
    else if (action === "start-break") startBreak();
    else if (action === "team-timeout") {
      if (controllerEditingLocked()) return;
      try {
        const c = state.controller;
        const remaining = c.activeAnchor?.kind === "break" ? anchoredRemaining(c.activeAnchor) : c.breakMs;
        const next = useTeamTimeout(c, state.event.matchTerms, button.dataset.side, remaining);
        snapshotController();
        next.undoStack = state.controller.undoStack;
        state.controller = next;
        if (next.phase === "BREAK_RUNNING") startAnchor("break", next.breakMs);
        logAction("TEAM_TIMEOUT", { side: button.dataset.side });
        modal.close();
        renderController();
      } catch (error) { toast(error.message); }
    }
    else if (action === "pause") pauseClock();
    else if (action === "base") base();
    else if (action === "point-type") choosePointType(button.dataset.kind);
    else if (action === "event-tools") showControllerTools();
    else if (action === "confirm-coin-result") {
      const id = state.activeEventId;
      if (!state.event?.coinChallenge || state.event.coinResult || coinConfirming || state.controller.phase !== "MATCH_COMPLETE") return;
      if (!remoteRevisions.has(id)) return toast("Reconnect and reopen the challenge to confirm its score.");
      coinConfirming = true;
      coinConfirmations.set(id, true);
      renderController();
      queueControllerSync();
    }
    else if (action === "undo" && !state.event?.coinResult && !coinConfirming) undo();
    else if (action === "set-break" && !state.event?.coinResult && !coinConfirming && !(state.event?.coinChallenge && state.controller.phase === "MATCH_COMPLETE")) showClockPicker();
    else if (action === "set-default-mode") { clockPickerMode = "default"; renderClockPicker(); }
    else if (action === "score-plus" || action === "score-minus") adjustScore(button.dataset.side, action === "score-plus" ? 1 : -1);
    else if (action === "export-log") exportLog();
    else if (action === "reset-all") { const auth = { authenticated: state.authenticated, authMode: state.authMode, member: state.member, operator: state.operator, route: state.authenticated ? "command-home" : "login" }; localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(EVENT_LOG_KEY); state = { ...clone(defaultState), ...auth }; save(); render(); }
    else if (action === "finalize-playoffs") toast("Qualifying is still active. Projection was not finalized.");
    else if (action === "team-detail") toast("Roster details belong to the future player app.");
  });

  document.addEventListener("change", (event) => {
    if (event.target.id === "eventStartDate" && $("#eventEndDate")) $("#eventEndDate").min = event.target.value;
    if (event.target.id === "venueRegion") refreshVenueOptions(true);
    if (event.target.id === "eventVenue") updateCustomVenue(event.target);
    if (event.target.id === "eventFormat") updateEventPointLimit(event.target.value);
    if (event.target.id === "draftBreaks") updateScheduleBreakTime(event.target.value);
    if (event.target.id === "connectionMode") updateConnectionMode(event.target.value);
    if (event.target.id === "staffDay") { staffDay = event.target.value || null; renderStaffJoin(); $("#staffDay")?.focus(); }
    if (event.target.id === "scrimmageDeck") $("#splitDeckTeams")?.classList.toggle("hidden", event.target.value !== "split");
    if (event.target.id === "newEventDeck") {
      const split = event.target.value === "split";
      $("#newEventSplitTeams")?.classList.toggle("hidden", !split);
      for (const id of ["#newEventNextLeft", "#newEventNextRight"]) if ($(id)) $(id).disabled = !split;
    }
    if (event.target.id === "scrimmageFormat") $("#scrimmagePointLimit")?.closest(".field")?.classList.toggle("hidden", event.target.value === "uncapped");
    if (event.target.id === "countdownCue") { state.audio = { ...(state.audio || {}), countdownCue: event.target.value }; save(); playCountdownCue(); }
  });

  document.addEventListener("submit", (event) => {
    if (event.target.id === "eventSettingsForm") {
      event.preventDefault();
      saveEventSettings(event.target);
      return;
    }
    if (event.target.id === "scheduleBuilderForm") {
      event.preventDefault();
      advanceScheduleBuilder(event.target);
      return;
    }
    if (event.target.id === "staffJoinForm") {
      event.preventDefault();
      void lookupStaffEvent(event.target.querySelector("#staffCode").value);
      return;
    }
    if (event.target.id !== "signInForm" && event.target.id !== "signUpForm") return;
    event.preventDefault();
    submitAuthentication(event.target);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { void refreshRemoteEvents(); queueControllerSync(); }
  });

  state.activity = getLog().slice(-30).reverse();
  if (state.controller.activeAnchor) {
    const remaining = anchoredRemaining(state.controller.activeAnchor);
    if (state.controller.activeAnchor.kind === "break") state.controller.breakMs = remaining;
    else state.controller.gameMs = remaining;
  }
  app.innerHTML = `<div class="auth-loading"><div class="brand">PBN</div><p>Restoring secure session…</p></div>`;
  if (window.Capacitor?.isNativePlatform()) {
    void App.addListener("appUrlOpen", event => openStaffInvite(event.url)).catch(() => {});
    void App.getLaunchUrl().then(event => { if (event?.url) openStaffInvite(event.url); }).catch(() => {});
  }
  else if (isHostedController()) openStaffInvite(window.location.href);
  restoreAuthSession();
})();
