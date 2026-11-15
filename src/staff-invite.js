export function staffInviteFromLink(value) {
  try {
    const url = new URL(value);
    const native = url.protocol === "pbngametimecontroller:" && url.host === "staff" && url.pathname === "/join";
    const web = url.origin === "https://www.pbnetwork.tv" && url.pathname === "/game-time/staff/join";
    const code = url.searchParams.get("code");
    if ((!native && !web) || !code || !/^[a-z0-9]{6}$/i.test(code)) return null;
    const day = url.searchParams.get("day");
    return { code: code.toUpperCase(), day: day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null };
  } catch { return null; }
}

export function staffInviteLink(code, day) {
  const url = new URL("https://www.pbnetwork.tv/game-time/staff/join");
  url.searchParams.set("code", code);
  if (day) url.searchParams.set("day", day);
  return url.toString();
}
