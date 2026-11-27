var validEventId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
function controllerEventFromLink(input, hostedOrigin) {
  try {
    const url = new URL(input);
    const native = url.protocol === "pbngametimecontroller:" && url.hostname === "event" && url.pathname === "/open";
    const hosted = hostedOrigin && url.origin === hostedOrigin && ["/game-time/controller", "/game-time/controller/", "/game-time-controller/index.html"].includes(url.pathname);
    const eventId = url.searchParams.get("event");
    return (native || hosted) && validEventId(eventId) ? eventId : null;
  } catch {
    return null;
  }
}

export { controllerEventFromLink };

