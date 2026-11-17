const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

const icon = (name) => {
  const paths = {
    undo: '<path d="M4 8h7a8 8 0 1 1-7 12M4 8l5-5M4 8l5 5"/>',
    home: '<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3z"/>',
    pause: '<rect x="5" y="3" width="5" height="18" rx="1.3" fill="currentColor" stroke="none"/><rect x="14" y="3" width="5" height="18" rx="1.3" fill="currentColor" stroke="none"/>',
    play: '<path d="m7 3 15 9-15 9z" fill="currentColor" stroke="none"/>',
    tools: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'
  };
  return `<svg class="arena-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ""}</svg>`;
};

const disabled = (enabled) => enabled ? "" : " disabled";

export function isFinalBreakCountdown(milliseconds) {
  return Number.isFinite(milliseconds) && milliseconds >= 0 && milliseconds <= 10000;
}

function inactiveMarkup(match) {
  if (!match) return "";
  return `<section class="arena-inactive" aria-label="${escape(match.label || "Game 2")}, inactive">
    <div class="arena-inactive-heading"><strong>${escape(match.label || "Game 2")}</strong><span>Inactive</span></div>
    <div class="arena-inactive-match">
      <div class="arena-inactive-team"><span title="${escape(match.leftName)}">${escape(match.leftName)}</span><strong>${escape(match.leftScore)}</strong></div>
      <span class="arena-inactive-clock" aria-label="Remaining game time ${escape(match.clock)}">${escape(match.clock)}</span>
      <div class="arena-inactive-team arena-inactive-team-right"><span title="${escape(match.rightName)}">${escape(match.rightName)}</span><strong>${escape(match.rightScore)}</strong></div>
    </div>
  </section>`;
}

function teamMarkup(side, active, view) {
  const left = side === "left";
  const name = left ? active.leftName : active.rightName;
  const pit = (left ? active.pitLeft : active.pitRight) || (left ? "Pit 1" : "Pit 2");
  const score = left ? active.leftScore : active.rightScore;
  const minusOverride = left ? view.scoreMinusLeftEnabled : view.scoreMinusRightEnabled;
  const canScore = Boolean(view.scoreEnabled && !view.settled);
  const canSubtract = canScore && (minusOverride ?? Number(score) > 0);
  const button = (operation) => {
    const plus = operation === "plus";
    return `<button type="button" class="arena-button arena-score-button" data-action="score-${operation}" data-side="${side}" aria-label="${plus ? "Add" : "Subtract"} one point ${plus ? "to" : "from"} ${escape(name)}, ${escape(pit)}"${disabled(plus ? canScore : canSubtract)}><span aria-hidden="true">${plus ? "+" : "−"}</span></button>`;
  };
  const longName = String(name ?? "").length > 18;
  return `<section class="arena-team arena-team-${side}" aria-label="${escape(pit)}, ${escape(name)}">
    <div class="arena-pit"><i aria-hidden="true"></i><span>${escape(pit)}</span></div>
    <h3 class="arena-team-name${longName ? " arena-team-name-long" : ""}" title="${escape(name)}">${escape(name)}</h3>
    <strong class="arena-score" aria-label="${escape(name)} score ${escape(score)}">${escape(score)}</strong>
    <div class="arena-score-controls">${left ? button("minus") + button("plus") : button("plus") + button("minus")}</div>
  </section>`;
}

/**
 * Render the live controller without coupling presentation to clock or match state.
 * completionMarkup is trusted markup supplied by the app, never user-entered text.
 */
export function renderControllerView(view) {
  const active = view.active || {};
  const canUndo = Boolean(view.undoEnabled && !view.settled);
  const selectedType = ["approve", "reverse", "none"].includes(view.selectedType) ? view.selectedType : null;
  const breakEditable = view.breakEditable !== false && !view.settled;
  const types = [["approve", "Approve"], ["reverse", "Reverse"], ["none", "No points"]];
  const headerAction = view.eventCode
    ? `<button type="button" class="arena-event-code" data-action="copy-event-code" aria-label="Copy event code ${escape(view.eventCode)}"><small>Event code</small><strong>${escape(view.eventCode)}</strong></button>`
    : `<button type="button" class="arena-header-undo" data-action="undo" aria-label="Undo last controller action"${disabled(canUndo)}>${icon("undo")}</button>`;

  return `<div class="arena-controller${view.inactive ? " arena-split" : " arena-single"}${view.completionMarkup ? " arena-complete" : ""}" data-controller-phase="${escape(view.phase)}">
    <div class="arena-atmosphere" aria-hidden="true"><i class="arena-bunker arena-bunker-one"></i><i class="arena-bunker arena-bunker-two"></i><i class="arena-bunker arena-bunker-three"></i><i class="arena-bunker arena-bunker-four"></i></div>
    <header class="arena-header"><span class="arena-brand" aria-label="PBN">PBN</span><h1>Game Time Controller</h1>${headerAction}</header>
    ${inactiveMarkup(view.inactive)}
    <section class="arena-active" aria-label="${escape(active.label || "Game 1")}, active">
      <div class="arena-active-heading"><h2>${escape(active.label || "Game 1")}</h2><span>${view.settled ? "Final" : "Active"}</span></div>
      <div class="arena-clock-stack">
        <span class="arena-clock-label">Game time</span>
        <strong id="gameClock" class="arena-game-clock">${escape(active.gameClock)}</strong>
        <div class="arena-break-stack"><span>Break</span><button type="button" id="breakClock" class="arena-break-clock${view.breakWarning ? " warning" : ""}" data-action="set-break" aria-label="Set break clock, ${escape(active.breakClock)}"${disabled(breakEditable)}>${escape(active.breakClock)}</button></div>
        <p class="arena-clock-status" role="status">${escape(active.status || "Clock stopped")}</p>
      </div>
      <div class="arena-clock-controls">
        <button type="button" class="arena-button arena-clock-button" data-action="base"${disabled(view.baseEnabled && !view.settled)}>Base</button>
        <button type="button" class="arena-button arena-clock-button" data-action="pause"${disabled(view.pauseEnabled && !view.settled)}>${icon(view.paused ? "play" : "pause")}<span>${view.paused ? "Resume" : "Pause"}</span></button>
      </div>
      <div class="arena-point-type"><p id="arenaPointTypeLabel">Point type</p><div class="arena-type-options" role="group" aria-labelledby="arenaPointTypeLabel">${types.map(([kind, label]) => `<button type="button" class="arena-button arena-type-button${selectedType === kind ? " is-selected" : ""}" data-action="point-type" data-kind="${kind}" aria-pressed="${selectedType === kind}"${disabled(view.typeEnabled && !view.settled)}>${label}</button>`).join("")}</div></div>
      <div class="arena-teams${view.sideSwapFading ? " is-swapping" : ""}">${teamMarkup("left", active, view)}${teamMarkup("right", active, view)}</div>
      ${view.completionMarkup ? `<section class="arena-completion" aria-label="Match result">${view.completionMarkup}</section>` : ""}
      <button type="button" class="arena-button arena-start-break" data-action="start-break"${disabled(view.startBreakEnabled && !view.settled)}>${icon("play")}<span>${escape(view.startBreakLabel || "Start break")}</span></button>
    </section>
    <footer class="arena-footer${view.hasEventTools ? " arena-footer-with-tools" : ""}">
      <button type="button" class="arena-footer-button arena-undo" data-action="undo"${disabled(canUndo)}>${icon("undo")}<span>Undo last action</span></button>
      ${view.hasEventTools ? `<button type="button" class="arena-footer-button arena-tools" data-action="event-tools" aria-label="Event tools, schedule and match rules">${icon("tools")}<span>Event</span></button>` : ""}
      <button type="button" class="arena-footer-button arena-home" data-route="command-home">${icon("home")}<span>Home</span></button>
    </footer>
  </div>`;
}
