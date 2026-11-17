import assert from "node:assert/strict";
import test from "node:test";
import { createControllerAudio, VOICE_ASSETS } from "../src/controller-audio.js";

const settle = () => new Promise(resolve => setImmediate(resolve));
const error = (code) => Object.assign(new Error(code), { code });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function nativeHarness() {
  const calls = [];
  const pending = new Map();
  function cancel(channel) {
    const job = pending.get(channel);
    pending.delete(channel);
    job?.reject(error("CANCELLED"));
  }
  function begin(method, options, channel) {
    cancel(channel);
    const job = { ...deferred(), method, options };
    pending.set(channel, job);
    calls.push(job);
    return job.promise;
  }
  const native = {
    prepare: async () => { calls.push({ method: "prepare" }); },
    speak: options => begin("speak", options, "speech"),
    play: options => begin("play", options, options.channel),
    stopSpeech: async () => { calls.push({ method: "stopSpeech" }); cancel("speech"); cancel("voice"); },
    stop: async () => { calls.push({ method: "stop" }); for (const channel of ["speech", "voice", "cue"]) cancel(channel); }
  };
  function finish(channel, failure) {
    const job = pending.get(channel);
    assert.ok(job, `Expected a pending ${channel} operation`);
    pending.delete(channel);
    if (failure) job.reject(failure); else job.resolve();
  }
  return { native, calls, pending, finish };
}
function webHarness({ delayedPlay = false } = {}) {
  const players = [];
  const timers = new Map();
  const spoken = [];
  let nextTimer = 0;
  let currentUtterance = null;
  const speech = {
    paused: false, cancellations: 0,
    speak(utterance) { spoken.push(utterance); currentUtterance = utterance; },
    cancel() { this.cancellations += 1; currentUtterance = null; },
    resume() { this.paused = false; }
  };
  const options = {
    createAudio: () => {
      const attributes = {};
      const player = {
        volume: 1, currentTime: 0, pauses: 0, plays: [],
        setAttribute(name, value) { attributes[name] = value; },
        getAttribute(name) { return attributes[name] ?? null; },
        set src(value) { attributes.src = value; },
        get src() { return attributes.src; },
        load() {},
        pause() { this.pauses += 1; },
        play() {
          const job = { ...deferred(), src: this.src, volume: this.volume };
          this.plays.push(job);
          if (!delayedPlay) job.resolve();
          return job.promise;
        },
        end() { this.onended?.({ type: "ended" }); },
        fail() { this.onerror?.({ type: "error" }); }
      };
      players.push(player);
      return player;
    },
    speech,
    Utterance: class { constructor(text) { this.text = text; } },
    setTimer(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimer(id) { timers.delete(id); }
  };
  function endSpeech(failure) {
    const current = currentUtterance;
    assert.ok(current, "Expected a pending web utterance");
    currentUtterance = null;
    if (failure) current.onerror?.({ error: failure }); else current.onend?.();
  }
  function fireTimer() {
    const [id, timer] = timers.entries().next().value;
    timers.delete(id);
    timer.fn();
  }
  return { options, players, timers, spoken, speech, endSpeech, fireTimer };
}

test("six native announcements use four original recordings and two TTS fallbacks, waiting for each completion", async () => {
  const h = nativeHarness();
  const audio = createControllerAudio({ native: h.native, createAudio: () => { throw new Error("Native playback must not use HTML audio"); } });
  await audio.prepare();
  const announcements = [
    ["Base", "audio/voice-base.mp3"],
    ["Point approved", "audio/voice-point-approved.mp3"],
    ["Point reversed", "audio/voice-point-reversed.mp3"],
    ["No points", null],
    ["Game started", null],
    ["Game stopped", "audio/voice-game-stopped.mp3"]
  ];
  const results = announcements.map(([text], index) => audio.say(text, { interrupt: index === 0 }));
  await settle();
  assert.equal(h.calls.filter(call => call.method === "play" || call.method === "speak").length, 1);
  for (const [index, [text, asset]] of announcements.entries()) {
    const channel = asset ? "voice" : "speech";
    const job = h.pending.get(channel);
    assert.ok(job, `${text} has not started`);
    assert.deepEqual(job.options, asset ? { asset, channel: "voice", volume: 1 } : { text, rate: .86, volume: 1 });
    let finished = false;
    void results[index].then(() => { finished = true; });
    await settle();
    assert.equal(finished, false, "Starting playback is not completion");
    h.finish(channel);
    assert.equal(await results[index], true);
    await settle();
  }
  assert.equal(h.calls.filter(call => call.method === "play").length, 4);
  assert.equal(h.calls.filter(call => call.method === "speak").length, 2);
  assert.equal(h.pending.size, 0);
});

test("interrupting an announcement discards stale queued work without synthesizing the cancelled recording", async () => {
  const h = nativeHarness();
  const failures = [];
  const audio = createControllerAudio({ native: h.native, onError: failure => failures.push(failure) });
  const first = audio.say("Base");
  const stale = audio.say("Point approved", { interrupt: false });
  await settle();
  const replacement = audio.say("Point reversed");
  assert.deepEqual(await Promise.all([first, stale]), [false, false]);
  await settle();
  assert.equal(h.pending.get("voice").options.asset, VOICE_ASSETS["point reversed"]);
  assert.equal(h.calls.filter(call => call.method === "speak").length, 0);
  h.finish("voice");
  assert.equal(await replacement, true);
  assert.deepEqual(failures, []);
});

test("cue playback stays independent of voices and is cancelled only by a full stop", async () => {
  const h = nativeHarness();
  const audio = createControllerAudio({ native: h.native });
  const decision = audio.say("Point approved");
  await settle();
  const horn = audio.playCue("game-start-horn");
  const cancelledHorn = assert.rejects(horn, { code: "CANCELLED" });
  assert.equal(h.pending.get("cue").options.asset, "audio/game-start-horn.mp3");
  assert.ok(h.pending.has("voice"), "The horn must not cut off the point result");
  await audio.stopSpeech();
  assert.equal(await decision, false);
  assert.ok(h.pending.has("cue"), "Flushing obsolete voice must leave the horn playing");
  await audio.stop();
  await cancelledHorn;
  assert.equal(h.pending.size, 0);
});

test("a native recording failure falls back once, while system interruption never replays the announcement", async () => {
  const h = nativeHarness();
  const failures = [];
  const audio = createControllerAudio({ native: h.native, onError: failure => failures.push(failure) });
  const approved = audio.say("Point approved");
  await settle();
  h.finish("voice", error("ASSET_NOT_FOUND"));
  await settle();
  assert.equal(h.pending.get("speech").options.text, "Point approved");
  h.finish("speech");
  assert.equal(await approved, true);
  const stopped = audio.say("Game stopped");
  await settle();
  h.finish("voice", error("INTERRUPTED"));
  assert.equal(await stopped, false);
  assert.equal(h.calls.filter(call => call.method === "speak").length, 1);
  assert.deepEqual(failures, []);
});

test("a browser media error after successful play triggers TTS fallback and preserves the announcement queue", async () => {
  const h = webHarness();
  const audio = createControllerAudio(h.options);
  const first = audio.say("Point approved");
  const second = audio.say("No points", { interrupt: false });
  await settle();
  assert.equal(h.players[0].src, "./audio/voice-point-approved.mp3");
  h.players[0].fail();
  await settle();
  assert.deepEqual(h.spoken.map(utterance => utterance.text), ["Point approved"]);
  h.endSpeech();
  assert.equal(await first, true);
  await settle();
  assert.deepEqual(h.spoken.map(utterance => utterance.text), ["Point approved", "No points"]);
  h.endSpeech();
  assert.equal(await second, true);
  assert.equal(h.timers.size, 0);
});

test("web speech errors report failure and allow the following announcement to finish", async () => {
  const h = webHarness();
  const failures = [];
  const audio = createControllerAudio({ ...h.options, onError: failure => failures.push(failure) });
  const first = audio.say("No points");
  const second = audio.say("Game started", { interrupt: false });
  h.endSpeech("not-allowed");
  assert.equal(await first, false);
  await settle();
  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, "not-allowed");
  assert.equal(h.spoken[1].text, "Game started");
  h.endSpeech();
  assert.equal(await second, true);
});

test("late muted unlock completion cannot pause a newer web announcement", async () => {
  const h = webHarness({ delayedPlay: true });
  const audio = createControllerAudio(h.options);
  const preparing = audio.prepare();
  const voice = h.players[0];
  const cue = h.players[1];
  const result = audio.say("Base");
  const pausesAfterStart = voice.pauses;
  voice.plays[0].resolve();
  cue.plays[0].resolve();
  await preparing;
  assert.equal(voice.pauses, pausesAfterStart);
  assert.equal(voice.volume, 1);
  voice.plays[1].resolve();
  voice.end();
  assert.equal(await result, true);
});

test("a timed-out web utterance is cancelled before the next message starts", async () => {
  const h = webHarness();
  const failures = [];
  const audio = createControllerAudio({ ...h.options, onError: failure => failures.push(failure) });
  const first = audio.say("No points");
  const stale = h.spoken[0];
  const cancellationsBeforeTimeout = h.speech.cancellations;
  const second = audio.say("Game started", { interrupt: false });
  h.fireTimer();
  assert.equal(await first, false);
  await settle();
  assert.equal(h.speech.cancellations, cancellationsBeforeTimeout + 1);
  assert.equal(stale.onend, null);
  assert.equal(failures[0].code, "PLAYBACK_TIMEOUT");
  h.endSpeech();
  assert.equal(await second, true);
});
