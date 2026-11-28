import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";

const root = new URL("../", import.meta.url);
const source = await readFile(new URL("src/app.js", root), "utf8");
const html = await readFile(new URL("src/index.html", root), "utf8");
const hooks = `window.__controller = {
  get state() { return state; }, save, publishCurrentEvent, flushControllerSync,
  restoreControllerWorkspace, activateRemoteEvent, selectMemberWorkspace, logAction,
  officialSetup, refreshRemoteEvents, claimStaffRole, route, emptyControllerForEvent, scrimmageMatch,
  setStaff(view, day) { staffPreview = view; staffCode = view.code; staffDay = day; },
  get staffError() { return staffError; },
  async ready() { await restoreAuthSession(); }
};`;
const compiled = await build({
  stdin: { contents: source.replace(/  restoreAuthSession\(\);\s*\}\)\(\);\s*$/, hooks + "\n})();"), resolveDir: new URL("src", root).pathname },
  bundle: true, write: false, format: "iife", platform: "browser", target: "safari16",
  plugins: [{ name: "mock-native-transport", setup(builder) {
    builder.onResolve({ filter: /^(@capacitor\/(app|core|geolocation)|@aparajita\/capacitor-secure-storage|@pbnetwork\/controller-audio)$/ }, args => ({ path: args.path, namespace: "native-test" }));
    builder.onLoad({ filter: /.*/, namespace: "native-test" }, ({ path }) => ({ contents: {
      "@capacitor/core": 'export const Capacitor={getPlatform:()=>"ios"}; export const CapacitorHttp={request:options=>window.__qa.request(options)};',
      "@capacitor/app": 'export const App={addListener:async()=>({remove(){}}),getLaunchUrl:async()=>null};',
      "@capacitor/geolocation": 'export const Geolocation={getCurrentPosition:options=>window.__qa.location(options)};',
      "@aparajita/capacitor-secure-storage": 'export const SecureStorage={getItem:async()=>JSON.stringify(window.__qa.session),setItem:async(k,v)=>{window.__qa.session=JSON.parse(v)},removeItem:async()=>{window.__qa.session=null}};',
      "@pbnetwork/controller-audio": 'export const PBNControllerAudio={prepare:async()=>{},play:async()=>{},speak:async()=>{},stop:async()=>{},stopSpeech:async()=>{}};'
    }[path] }));
  }}]
});

export const settle = async () => { for (let index = 0; index < 15; index++) await new Promise(resolve => setImmediate(resolve)); };
export const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
export const response = (data, status = 200) => ({ status, data: JSON.stringify({ data }) });

export async function controllerHarness(handler = () => undefined, {waitForReady=true} = {}) {
  const errors = [];
  const console = new VirtualConsole();
  console.on("jsdomError", error => errors.push(error.message));
  const dom = new JSDOM(html, { url: "https://controller-test.example.invalid/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: console });
  const window = dom.window;
  window.structuredClone = structuredClone;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
  window.fetch = () => { throw Error("Native requests must use CapacitorHttp."); };
  const requests = [], locationRequests = [];
  const session = { token: "local-test-token", expiresAt: "2099-01-01T00:00:00Z", user: { id: "operator-a", screenName: "Operator A", email: "operator@example.invalid" } };
  window.__qa = {
    session,
    location: async options => { locationRequests.push(options); return { coords: { latitude: 38, longitude: -90, accuracy: 5 }, timestamp: Date.now() }; },
    request: async options => {
      const request = { ...options, path: new URL(options.url).pathname, body: options.data ? JSON.parse(options.data) : undefined };
      requests.push(request);
      const answer = await handler(request);
      if (answer) return answer;
      if(request.path.endsWith("/nda"))return response({receipt:{id:"synthetic-test-signature"}});
      if (request.path === "/api/mobile-auth/me") return response({ user: window.__qa.session.user });
      if (request.path.endsWith("/controller-setups")) return response({items:[]});
      if (request.path.endsWith("/controller-events")) return response([]);
      if (request.path.endsWith("/staff/mine")) return response({ active: null });
      throw Error("Unexpected native request: " + request.path);
    }
  };
  window.eval(compiled.outputFiles[0].text);
  const api = window.__controller;
  const ready=api.ready(); if(waitForReady)await ready; await settle();
  const local = (id = "local-scrimmage-test") => {
    const state = api.state;
    state.activeEventId = id;
    state.event = { id, source: "local", name: "Alpha vs Bravo", venue: "Test Field", fieldId: "test-field", eventType: "Paintball scrimmage", startDate: "2026-11-22", endDate: "2026-11-22", startTime: "09:00", format: "Race-to", pointLimit: 3, deckStyle: "SINGLE", status: "Local" };
    state.teams = ["Alpha", "Bravo"];
    state.fields = [{ id: "f1", name: "Field 1", pitLeft: "Pit 1", pitRight: "Pit 2" }];
    state.divisions = []; state.staff = []; state.standings = [];
    state.schedule = [{ id: "match-1", eventId: id, left: "Alpha", right: "Bravo", field: "Field 1", time: "09:00", status: "On deck" }];
    state.controller = api.emptyControllerForEvent(id);
    state.controller.activeMatch = api.scrimmageMatch("match-1", "Alpha", "Bravo", id);
    state.session = { active: true, type: "scrimmage", eventId: id, format: "Race-to", pointLimit: 3, deckStyle: "single", label: state.event.name };
    state.scheduleDraft = { eventId: id, generated: true };
    state.sync = { pending: 0, localVersion: 0, revision: 1 };
    api.save();
    return state;
  };
  return { api, window, ready, requests, locationRequests, errors, local, close: () => dom.window.close() };
}
