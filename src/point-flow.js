export const POINT_TYPES = Object.freeze([
  Object.freeze({ kind: "approve", label: "Approve", voice: "Point approved" }),
  Object.freeze({ kind: "reverse", label: "Reverse", voice: "Point reversed" }),
  Object.freeze({ kind: "none", label: "No points", voice: "No points" })
]);

const WAITING = "POINT_STOPPED_WAITING_DECISION";
const MAX_SCORE = 1000;
const copy = (value) => structuredClone(value);
const typeFor = (kind) => POINT_TYPES.find((type) => type.kind === kind);

function activeMatch(controller) {
  const match = controller?.activeMatch;
  if (!match?.id || !match.leftTeamId || !match.rightTeamId || match.leftTeamId === match.rightTeamId) {
    throw new Error("A match with two assigned teams is required.");
  }
  for (const score of [match.leftScore, match.rightScore]) {
    if (!Number.isSafeInteger(score) || score < 0 || score > MAX_SCORE) {
      throw new Error("Team scores must be between 0 and 1000.");
    }
  }
  return match;
}

function remainingTime(value, fallback) {
  const safe = Number.isFinite(value) ? value : Number.isFinite(fallback) ? fallback : 0;
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(safe)));
}

function physicalTeam(match, side) {
  if (side !== "left" && side !== "right") throw new Error("Choose the left or right team.");
  const teamId = side === "left" ? match.leftPhysicalTeamId : match.rightPhysicalTeamId;
  if (teamId !== match.leftTeamId && teamId !== match.rightTeamId) {
    throw new Error("This pit is not assigned to either team.");
  }
  return teamId;
}

function freshDraft(controller, gameMs, { id, at } = {}) {
  const match = activeMatch(controller);
  return {
    id: id || `${match.id}:point:${(controller.pointHistory?.length || 0) + 1}:${gameMs}`,
    matchId: match.id,
    kind: null,
    baseline: {
      leftTeamId: match.leftTeamId,
      rightTeamId: match.rightTeamId,
      leftScore: match.leftScore,
      rightScore: match.rightScore
    },
    deltas: { [match.leftTeamId]: 0, [match.rightTeamId]: 0 },
    gameMs,
    at: at ?? null
  };
}

function validateDraft(controller) {
  if (controller?.phase !== WAITING || !controller.pointDraft) {
    throw new Error("Stop the game with Base before recording a point.");
  }
  const match = activeMatch(controller);
  const draft = controller.pointDraft;
  const baseline = draft.baseline;
  if (!draft.id || draft.matchId !== match.id ||
      baseline?.leftTeamId !== match.leftTeamId || baseline?.rightTeamId !== match.rightTeamId) {
    throw new Error("This pending point belongs to a different match or team assignment.");
  }
  if (baseline.leftScore !== match.leftScore || baseline.rightScore !== match.rightScore) {
    throw new Error("The match score changed while this point was pending. Undo or reopen the point.");
  }
  if (draft.kind !== null && !typeFor(draft.kind)) throw new Error("Choose Approve, Reverse, or No points.");
  if (!draft.deltas || typeof draft.deltas !== "object" || Array.isArray(draft.deltas)) {
    throw new Error("This pending point has invalid score adjustments.");
  }
  const teamIds = [match.leftTeamId, match.rightTeamId];
  for (const teamId of Object.keys(draft.deltas)) {
    if (!teamIds.includes(teamId)) throw new Error("This pending point includes an unknown team.");
  }
  for (const [teamId, score] of [[match.leftTeamId, match.leftScore], [match.rightTeamId, match.rightScore]]) {
    const delta = draft.deltas[teamId] ?? 0;
    if (!Number.isSafeInteger(delta) || score + delta < 0 || score + delta > MAX_SCORE) {
      throw new Error("Point adjustments must keep team scores between 0 and 1000.");
    }
  }
  if (controller.pointHistory?.some((point) => point.pointId === draft.id)) {
    throw new Error("This point has already been recorded.");
  }
  return draft;
}

/** Freeze the game without choosing a team or changing a score. Metadata comes from the caller. */
export function beginPointDraft(controller, remainingGameMs = controller?.gameMs, metadata = {}) {
  if (!["POINT_LIVE", "GAME_PAUSED"].includes(controller?.phase)) {
    throw new Error("Base is available while a point is playing or paused.");
  }
  activeMatch(controller);
  const next = copy(controller);
  next.gameMs = remainingTime(remainingGameMs, controller.gameMs);
  next.activeMatch.gameMs = next.gameMs;
  next.activeAnchor = null;
  next.phase = WAITING;
  next.pendingBaseSide = null;
  next.pointDraft = freshDraft(next, next.gameMs, metadata);
  return next;
}

/** Restore a legacy stopped point without guessing a winner from its former base side. */
export function normalizePointDraft(controller) {
  if (controller?.phase !== WAITING) return controller;
  if (controller.pointDraft) {
    validateDraft(controller);
    return controller;
  }
  activeMatch(controller);
  const next = copy(controller);
  next.gameMs = remainingTime(controller.gameMs);
  next.activeMatch.gameMs = next.gameMs;
  next.activeAnchor = null;
  next.pendingBaseSide = null;
  next.pointDraft = freshDraft(next, next.gameMs);
  return next;
}

export function selectPointType(controller, kind) {
  if (!typeFor(kind)) throw new Error("Choose Approve, Reverse, or No points.");
  const current = normalizePointDraft(controller);
  validateDraft(current);
  const next = copy(current);
  next.pointDraft.kind = kind;
  if (kind === "none") {
    next.pointDraft.deltas = { [next.activeMatch.leftTeamId]: 0, [next.activeMatch.rightTeamId]: 0 };
  }
  return next;
}

/** Stage adjustments by stable team ID; never rotate, announce, or change canonical scores here. */
export function adjustPointScore(controller, physicalSide, delta) {
  if (!Number.isSafeInteger(delta) || delta === 0) throw new Error("Use a whole-point score adjustment.");
  const current = normalizePointDraft(controller);
  const draft = validateDraft(current);
  if (draft.kind === "none") throw new Error("No points leaves both scores unchanged. Choose Approve or Reverse to adjust a score.");
  if (!typeFor(draft.kind)) throw new Error("Choose Approve or Reverse before adjusting a team score.");
  const match = current.activeMatch;
  const teamId = physicalTeam(match, physicalSide);
  const baselineScore = teamId === match.leftTeamId ? draft.baseline.leftScore : draft.baseline.rightScore;
  const target = Math.max(0, Math.min(MAX_SCORE, baselineScore + (draft.deltas[teamId] ?? 0) + delta));
  const next = copy(current);
  next.pointDraft.deltas[teamId] = target - baselineScore;
  return next;
}

/** Return a canonical score outside a draft, or the staged score for the team occupying this pit. */
export function previewPointScore(controller, physicalSide) {
  const match = activeMatch(controller);
  const teamId = physicalTeam(match, physicalSide);
  const score = teamId === match.leftTeamId ? match.leftScore : match.rightScore;
  if (controller.phase !== WAITING || !controller.pointDraft) return score;
  const draft = validateDraft(controller);
  return score + (draft.kind === "none" ? 0 : draft.deltas[teamId] ?? 0);
}

/** Commit once; the caller owns speech, logs, side changes, break clocks, and split-deck rotation. */
export function commitPointDraft(controller, { at } = {}) {
  const current = normalizePointDraft(controller);
  const draft = validateDraft(current);
  const type = typeFor(draft.kind);
  if (!type) throw new Error("Choose Approve, Reverse, or No points before starting the break.");
  const match = current.activeMatch;
  const adjustments = draft.kind === "none"
    ? { [match.leftTeamId]: 0, [match.rightTeamId]: 0 }
    : { [match.leftTeamId]: draft.deltas[match.leftTeamId] ?? 0, [match.rightTeamId]: draft.deltas[match.rightTeamId] ?? 0 };
  if (draft.kind !== "none" && !Object.values(adjustments).some((delta) => delta !== 0)) {
    throw new Error("Adjust a team score before starting the break, or choose No points.");
  }

  const next = copy(current);
  next.activeMatch.leftScore = draft.baseline.leftScore + adjustments[match.leftTeamId];
  next.activeMatch.rightScore = draft.baseline.rightScore + adjustments[match.rightTeamId];
  next.gameMs = remainingTime(current.gameMs, draft.gameMs);
  next.activeMatch.gameMs = next.gameMs;
  next.activeAnchor = null;
  const gainingTeams = Object.keys(adjustments).filter((teamId) => adjustments[teamId] > 0);
  const scoringTeamId = gainingTeams.length === 1 ? gainingTeams[0] : null;
  const scoringTeam = scoringTeamId === match.leftTeamId ? match.leftTeam
    : scoringTeamId === match.rightTeamId ? match.rightTeam : null;
  const scoringPhysicalSide = !scoringTeamId ? null
    : scoringTeamId === match.leftPhysicalTeamId ? "left" : "right";
  const decision = {
    at: at ?? draft.at ?? null,
    pointId: draft.id,
    matchId: draft.matchId,
    kind: draft.kind,
    decision: draft.kind === "none" ? "no_point" : draft.kind,
    baseSide: null,
    scoringTeamId,
    scoringTeam,
    gameMs: next.gameMs,
    adjustments,
    baseline: copy(draft.baseline),
    scores: { leftScore: next.activeMatch.leftScore, rightScore: next.activeMatch.rightScore }
  };
  next.pointHistory = [...(next.pointHistory || []), copy(decision)];
  next.pendingBaseSide = null;
  next.pointDraft = null;
  next.phase = "POINT_CONFIRMED";
  next.pointConfirmation = {
    ...copy(decision),
    scoringPhysicalSide,
    label: `${type.voice.toUpperCase()}${scoringTeam ? ` · ${scoringTeam}` : ""}`
  };
  return { controller: next, voice: type.voice, decision };
}
