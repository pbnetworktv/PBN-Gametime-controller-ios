export const VOICE_ASSETS = Object.freeze({
  base: "audio/voice-base.mp3",
  "point approved": "audio/voice-point-approved.mp3",
  "point reversed": "audio/voice-point-reversed.mp3",
  "game stopped": "audio/voice-game-stopped.mp3"
});

export const isAudioCancellation = (error) => ["CANCELLED", "INTERRUPTED", "canceled", "interrupted"].includes(error?.code || error?.error);
const failure = (message, code = "PLAYBACK_ERROR") => Object.assign(new Error(message), { code });
const voiceKey = (text) => String(text).trim().replace(/[.!]+$/, "").toLowerCase();

// Retain one media element per channel. Unlocking or changing a countdown sound
// must never pause a newer voice or prevent a horn's completion from settling.
function createMediaChannel({ createAudio, setTimer, clearTimer }) {
  let player;
  let active;
  let revision = 0;
  let unlocked = false;
  function getPlayer(asset) {
    if (!player) {
      player = createAudio();
      player.preload = "auto";
      player.setAttribute("playsinline", "");
    }
    const path = `./${asset}`;
    if (player.getAttribute("src") !== path) {
      player.src = path;
      player.load();
    }
    return player;
  }
  function stop() {
    revision += 1;
    const previous = active;
    active = null;
    if (previous) {
      clearTimer(previous.timer);
      previous.reject(failure("Audio cancelled", "CANCELLED"));
    }
    if (player) {
      player.onended = null;
      player.onerror = null;
      player.pause();
    }
  }
  function unlock(asset) {
    if (unlocked || active) return Promise.resolve();
    const token = revision;
    try {
      const audio = getPlayer(asset);
      audio.volume = 0;
      return Promise.resolve(audio.play()).then(() => {
        unlocked = true;
        if (token !== revision) return;
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 1;
      }, () => { if (token === revision) audio.volume = 1; });
    } catch { return Promise.resolve(); }
  }
  function play(asset, timeoutMs) {
    stop();
    return new Promise((resolve, reject) => {
      let audio;
      const job = { resolve, reject, timer: null };
      active = job;
      const finish = (error) => {
        if (active !== job) return;
        active = null;
        clearTimer(job.timer);
        audio.onended = null;
        audio.onerror = null;
        if (error) audio.pause();
        if (error) reject(error); else resolve();
      };
      try {
        audio = getPlayer(asset);
        audio.currentTime = 0;
        audio.volume = 1;
        audio.onended = () => finish();
        audio.onerror = () => finish(failure(`Could not load ${asset}`));
        job.timer = setTimer(() => finish(failure(`Playback timed out: ${asset}`, "PLAYBACK_TIMEOUT")), timeoutMs);
        Promise.resolve(audio.play()).then(() => { unlocked = true; }, finish);
      } catch (error) {
        active = null;
        clearTimer(job.timer);
        reject(error);
      }
    });
  }
  return { play, stop, unlock };
}

export function createControllerAudio({
  native = null,
  createAudio = () => new Audio(),
  speech = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
  onError = () => {}
} = {}) {
  const voice = native ? null : createMediaChannel({ createAudio, setTimer, clearTimer });
  const cue = native ? null : createMediaChannel({ createAudio, setTimer, clearTimer });
  let utteranceJob = null;
  let queue = [];
  let active = null;
  let stopCount = 0;

  function report(error) {
    if (!isAudioCancellation(error)) onError(error);
  }
  function stopWebSpeech() {
    const previous = utteranceJob;
    utteranceJob = null;
    if (previous) {
      clearTimer(previous.timer);
      previous.utterance.onend = null;
      previous.utterance.onerror = null;
      previous.reject(failure("Speech cancelled", "CANCELLED"));
    }
    speech?.cancel();
  }
  function webSpeak(text) {
    return new Promise((resolve, reject) => {
      if (!speech || !Utterance) return reject(failure("Speech is not supported on this device", "UNAVAILABLE"));
      // Retain the utterance until completion; mobile speech engines may otherwise
      // release it while speaking. Asynchronous errors are surfaced to the app.
      const utterance = new Utterance(text);
      const job = { utterance, reject, timer: null };
      utteranceJob = job;
      const finish = (error) => {
        if (utteranceJob !== job) return;
        utteranceJob = null;
        clearTimer(job.timer);
        utterance.onend = null;
        utterance.onerror = null;
        if (error?.code === "PLAYBACK_TIMEOUT") speech.cancel();
        if (error) reject(error); else resolve();
      };
      utterance.lang = "en-US";
      utterance.rate = .86;
      utterance.volume = 1;
      utterance.onend = () => finish();
      utterance.onerror = (event) => finish(failure("Voice announcement failed", event.error || "SPEECH_ERROR"));
      job.timer = setTimer(() => finish(failure("Voice announcement timed out", "PLAYBACK_TIMEOUT")), Math.max(8000, text.length * 150));
      try {
        if (speech.paused) speech.resume();
        speech.speak(utterance);
      } catch (error) { finish(error); }
    });
  }
  function synthesize(text) {
    return native ? native.speak({ text, rate: .86, volume: 1 }) : webSpeak(text);
  }
  function announce(text) {
    const asset = VOICE_ASSETS[voiceKey(text)];
    if (!asset) return synthesize(text);
    const playback = native ? native.play({ asset, channel: "voice", volume: 1 }) : voice.play(asset, 8000);
    return Promise.resolve(playback).catch(error => {
      if (isAudioCancellation(error)) throw error;
      return synthesize(text);
    });
  }
  function pump() {
    if (active || stopCount || !queue.length) return;
    const job = queue.shift();
    active = job;
    const finish = (error) => {
      if (active !== job) return;
      active = null;
      job.resolve(!error);
      if (error) report(error);
      pump();
    };
    try { Promise.resolve(announce(job.text)).then(() => finish(), finish); }
    catch (error) { finish(error); }
  }
  function clearAnnouncements(allChannels = false) {
    const previous = active;
    active = null;
    previous?.resolve(false);
    queue.splice(0).forEach(job => job.resolve(false));
    stopCount += 1;
    const done = () => { stopCount -= 1; pump(); };
    try {
      const stopping = native
        ? (allChannels ? native.stop() : native.stopSpeech())
        : (() => { voice.stop(); stopWebSpeech(); if (allChannels) cue.stop(); })();
      // Web calls remain synchronous inside the user's tap, preserving activation.
      if (stopping?.then) return stopping.then(done, error => { report(error); done(); });
      done();
    } catch (error) { report(error); done(); }
    return Promise.resolve();
  }
  function say(text, { interrupt = true } = {}) {
    const message = String(text || "").trim();
    if (!message) return Promise.resolve(false);
    return new Promise(resolve => {
      if (interrupt) clearAnnouncements();
      queue.push({ text: message, resolve });
      pump();
    });
  }
  return {
    say,
    stop: () => clearAnnouncements(true),
    stopSpeech: () => clearAnnouncements(),
    prepare: (countdownName = "field-reference-beep") => {
      if (native) return native.prepare().catch(report);
      return Promise.all([voice.unlock(VOICE_ASSETS.base), cue.unlock(`audio/${countdownName}.mp3`)]);
    },
    playCue: (name) => native
      ? native.play({ asset: `audio/${name}.mp3`, channel: "cue", volume: 1 })
      : cue.play(`audio/${name}.mp3`, name === "game-start-horn" ? 4500 : 1800)
  };
}
