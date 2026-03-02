/**
 * DrumEngine - Generates drum sounds from beat pattern letters with Web Audio.
 * Plays one beat at a time when called by app transport.
 */
function DrumEngine() {
  this._audioCtx = null;
  this._audioCtxUnavailable = false;
  this._noiseBuffer = null;
  this._drumKey = {};
  this._patterns = [];
  this._patternById = {};
  this._selectedPatternId = "";
}

/**
 * Sets drumbeat dataset in shape: { key: {...}, patterns: [{ id, name, beats: [..4] }] }.
 */
DrumEngine.prototype.setDrumbeats = function (drumbeats) {
  var keyMap = drumbeats && drumbeats.key ? drumbeats.key : {};
  var patterns = drumbeats && drumbeats.patterns ? drumbeats.patterns : [];
  this._drumKey = {};
  for (var k in keyMap) {
    if (!keyMap.hasOwnProperty(k)) continue;
    this._drumKey[k] = String(keyMap[k] || "").trim().toLowerCase();
  }
  this._patterns = [];
  this._patternById = {};
  for (var i = 0; i < patterns.length; i++) {
    var p = patterns[i];
    if (!p || typeof p.id !== "string" || typeof p.name !== "string" || !p.beats || p.beats.length !== 4) continue;
    var normalized = {
      id: p.id,
      name: p.name,
      beats: [String(p.beats[0] || ""), String(p.beats[1] || ""), String(p.beats[2] || ""), String(p.beats[3] || "")]
    };
    this._patterns.push(normalized);
    this._patternById[normalized.id] = normalized;
  }
  if (!this._selectedPatternId || !this._patternById[this._selectedPatternId]) {
    this._selectedPatternId = this._patterns.length ? this._patterns[0].id : "";
  }
};

/**
 * Returns available patterns (id/name only) for UI dropdown.
 */
DrumEngine.prototype.getPatterns = function () {
  var list = [];
  for (var i = 0; i < this._patterns.length; i++) {
    list.push({ id: this._patterns[i].id, name: this._patterns[i].name });
  }
  return list;
};

/**
 * Selects active drum pattern by id. Empty id disables drum playback.
 */
DrumEngine.prototype.setSelectedPattern = function (patternId) {
  if (!patternId || !this._patternById[patternId]) {
    this._selectedPatternId = "";
    return;
  }
  this._selectedPatternId = patternId;
};

/**
 * Returns true when a valid drum pattern is currently selected.
 */
DrumEngine.prototype.hasSelectedPattern = function () {
  return !!(this._selectedPatternId && this._patternById[this._selectedPatternId]);
};

/**
 * Resets transport-sensitive state between play sessions.
 */
DrumEngine.prototype.reset = function () {
  /* Currently stateless across beats; method kept for transport API symmetry. */
};

/**
 * Stops active drum tails if needed.
 */
DrumEngine.prototype.stop = function () {
  /* One-shot voices decay naturally; no persistent nodes to stop. */
};

/**
 * Plays one beat from selected pattern for the given beat index.
 */
DrumEngine.prototype.playBeat = function (beatIndex) {
  if (!this.hasSelectedPattern()) return;
  var pattern = this._patternById[this._selectedPatternId];
  var idx = ((beatIndex % 4) + 4) % 4;
  var beatString = pattern.beats[idx];
  var tokens = this._parseBeatTokens(beatString);
  if (!tokens.length) return;
  var ctx = this._getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended" && ctx.resume) {
    ctx.resume();
  }
  var now = ctx.currentTime;
  for (var i = 0; i < tokens.length; i++) {
    var letter = tokens[i];
    var drumName = this._drumKey.hasOwnProperty(letter) ? this._drumKey[letter] : letter;
    this._triggerDrumByName(drumName, now);
  }
};

/**
 * Splits one beat string into letter tokens (comma-separated with whitespace tolerance).
 */
DrumEngine.prototype._parseBeatTokens = function (beatString) {
  if (typeof beatString !== "string") return [];
  var normalized = beatString.replace(/\s+/g, "");
  if (!normalized) return [];
  var parts = normalized.split(",");
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    if (parts[i]) out.push(parts[i]);
  }
  return out;
};

/**
 * Returns lazily-initialized shared Web Audio context.
 */
DrumEngine.prototype._getAudioContext = function () {
  if (this._audioCtxUnavailable) return null;
  if (this._audioCtx) return this._audioCtx;
  if (typeof window === "undefined") return null;
  var AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    this._audioCtxUnavailable = true;
    return null;
  }
  this._audioCtx = new AudioCtx();
  return this._audioCtx;
};

/**
 * Returns cached white-noise buffer for snare/hat/click synthesis.
 */
DrumEngine.prototype._getNoiseBuffer = function (ctx) {
  if (!ctx) return null;
  if (this._noiseBuffer && this._noiseBuffer.sampleRate === ctx.sampleRate) return this._noiseBuffer;
  var length = Math.floor(ctx.sampleRate * 0.5);
  var buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  var channel = buffer.getChannelData(0);
  for (var i = 0; i < length; i++) {
    channel[i] = Math.random() * 2 - 1;
  }
  this._noiseBuffer = buffer;
  return buffer;
};

/**
 * Triggers one drum voice by semantic name.
 */
DrumEngine.prototype._triggerDrumByName = function (name, when) {
  if (name === "kick") { this._triggerKick(when); return; }
  if (name === "snare") { this._triggerSnare(when); return; }
  if (name === "hat") { this._triggerHat(when); return; }
  if (name === "ding") { this._triggerDing(when); return; }
  if (name === "click") { this._triggerClick(when); return; }
};

/**
 * Synthesizes a kick drum using frequency-swept sine.
 */
DrumEngine.prototype._triggerKick = function (when) {
  var ctx = this._getAudioContext();
  if (!ctx) return;
  var osc = ctx.createOscillator();
  var gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(150, when);
  osc.frequency.exponentialRampToValueAtTime(48, when + 0.14);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(0.95, when + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.18);
};

/**
 * Synthesizes a snare drum using filtered white noise.
 */
DrumEngine.prototype._triggerSnare = function (when) {
  var ctx = this._getAudioContext();
  if (!ctx) return;
  var noise = ctx.createBufferSource();
  noise.buffer = this._getNoiseBuffer(ctx);
  var highpass = ctx.createBiquadFilter();
  var gain = ctx.createGain();
  highpass.type = "highpass";
  highpass.frequency.value = 1500;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(0.5, when + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.13);
  noise.connect(highpass);
  highpass.connect(gain);
  gain.connect(ctx.destination);
  noise.start(when);
  noise.stop(when + 0.15);
};

/**
 * Synthesizes a hi-hat using high-passed noise burst.
 */
DrumEngine.prototype._triggerHat = function (when) {
  var ctx = this._getAudioContext();
  if (!ctx) return;
  var noise = ctx.createBufferSource();
  noise.buffer = this._getNoiseBuffer(ctx);
  var highpass = ctx.createBiquadFilter();
  var gain = ctx.createGain();
  highpass.type = "highpass";
  highpass.frequency.value = 6500;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(0.18, when + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  noise.connect(highpass);
  highpass.connect(gain);
  gain.connect(ctx.destination);
  noise.start(when);
  noise.stop(when + 0.06);
};

/**
 * Synthesizes a short pitched ding.
 */
DrumEngine.prototype._triggerDing = function (when) {
  var ctx = this._getAudioContext();
  if (!ctx) return;
  var osc = ctx.createOscillator();
  var gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(1320, when);
  osc.frequency.exponentialRampToValueAtTime(960, when + 0.25);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(0.22, when + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.24);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.26);
};

/**
 * Synthesizes a crisp metronome click.
 */
DrumEngine.prototype._triggerClick = function (when) {
  var ctx = this._getAudioContext();
  if (!ctx) return;
  var osc = ctx.createOscillator();
  var gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.setValueAtTime(2400, when);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(0.12, when + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + 0.04);
};
