export function raceToComplete(match, format, pointLimit, deckStyle) {
  const limit = Number(pointLimit);
  return String(format).toLowerCase() === "race-to" && deckStyle !== "split" && Number.isInteger(limit) && limit > 0 && limit <= 7 && Math.max(match.leftScore, match.rightScore) >= limit && match.leftScore !== match.rightScore;
}
