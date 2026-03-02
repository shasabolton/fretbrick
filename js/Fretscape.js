/**
 * Fretscape - Owns a canvas and draws bricks to it. All coordinates in cellWidth units.
 * Canvas = 25 cells wide, 15 cells tall. Bricks get cellWidth from Fretscape.
 * Click-drag inside brick creates new brick; drag on brick moves it.
 * Supports wheel/pinch zoom, panning, and optional axis mirroring.
 */
function Fretscape(containerEl) {
  this.container = containerEl;
  this.bricks = [];
  this._musicalKey = "C";
  this._isLeftHanded = false;
  this._isVerticallyMirrored = false;
  this.cellWidth = 80;
  this.widthCw = 25;
  this.heightCw = 15;
  this.brickWidthCw = 5;
  this.brickHeightCw = 3;
  this._defaultOneCellCenterCw = { x: 14, y: 7 };
  this.canvas = document.createElement("canvas");
  this.ctx = this.canvas.getContext("2d");
  this.container.appendChild(this.canvas);
  this._dragItem = null;
  this._isCreating = false;
  this._offsetCw = { x: 0, y: 0 };
  this._dragStartOrigin = null; /* lattice point (x,y) cw where active drag line is anchored */
  this._dragConstraintVector = { x: 2, y: -2 }; /* default 2x2 slope constraint */
  this._viewScale = 1;
  this._viewPanPx = { x: 0, y: 0 };
  this._minViewScale = 0.5;
  this._maxViewScale = 4;
  this._isMousePanning = false;
  this._panLastClient = null;
  this._touchGesture = null;
  this._pendingDragCopy = null;
  this._audioCtx = null;
  this._audioCtxUnavailable = false;
  this._guitarWave = null;
  this._slapNoiseBuffer = null;
  this._activeProgressionDegrees = null;
  this._progressionPlaybackMode = "root";
  this._isProgressionPlaying = false;
  this._progressionBeatTimer = null;
  this._progressionAnimationFrame = null;
  this._progressionBeatIndex = 0;
  this._progressionPulseStartMs = 0;
  this._progressionPulseFromCell = null;
  this._progressionPulseToCell = null;
  this._progressionPulseFromCells = [];
  this._progressionPulseToCells = [];
  this._progressionPulseProgress = 0;
  this._progressionGuidePairFrom = null;
  this._progressionGuidePairTo = null;
  this._activeRiff = null;
  this._activeRiffBeats = null;
  this._activeStrumPattern = null;
  this._activeStrumBeats = null;
  this._activeStrumTimeline = null;
  this._strumStrokeGapBeats = 0.05;
  this._progressionBpm = 100;
  this._progressionBeatsPerChord = 4;
  this._drumEngine = null;
  this.onProgressionPlaybackStateChange = null;
  var self = this;
  window.addEventListener("resize", function () { self.render(); });
  this._bindInput();
}

/**
 * Adds a brick at (xCw, yCw). Coordinates in cellWidth units.
 */
Fretscape.prototype.addBrick = function (brick, xCw, yCw) {
  this.bricks.push({ brick: brick, xCw: xCw, yCw: yCw });
  return brick;
};

/**
 * Clears all bricks from the fretscape.
 */
Fretscape.prototype.clearBricks = function () {
  this.bricks = [];
};

/**
 * Sets drag constraint slope. false => 2x2 slope (2,-2), true => 5x1 slope (5,1).
 */
Fretscape.prototype.setDragConstraintSlope = function (useFiveByOneSlope) {
  this._dragConstraintVector = useFiveByOneSlope ? { x: 5, y: 1 } : { x: 2, y: -2 };
};

/**
 * Sets the active musical key for this fretscape.
 */
Fretscape.prototype.setKey = function (key) {
  if (typeof key !== "string") return;
  var normalized = key.trim();
  if (!normalized) return;
  this._musicalKey = normalized;
};

/**
 * Sets external drum engine used by progression transport.
 */
Fretscape.prototype.setDrumEngine = function (drumEngine) {
  this._drumEngine = drumEngine || null;
};

/**
 * Plays one drum beat when a drum pattern is selected.
 */
Fretscape.prototype._playDrumBeat = function (beatIndex) {
  if (!this._drumEngine || typeof this._drumEngine.playBeat !== "function") return;
  this._drumEngine.playBeat(beatIndex);
};

/**
 * Converts a semitone distance into compact fretspace offsets where semitones = x + 5*y.
 */
Fretscape.prototype._semitoneToFretspaceOffset = function (semitone) {
  var best = { x: semitone, y: 0 };
  var bestScore = Number.POSITIVE_INFINITY;
  for (var y = -3; y <= 3; y++) {
    var x = semitone - 5 * y;
    var score = Math.abs(x) + Math.abs(y) * 2;
    if (score < bestScore) {
      bestScore = score;
      best = { x: x, y: y };
    }
  }
  return best;
};

/**
 * Converts fretspace deltas (x,y) from a root cell into world coordinates.
 * +x and +y both move up in tone in fretspace.
 */
Fretscape.prototype._fretspaceDeltaToWorldFromRoot = function (rootCell, xDelta, yDelta) {
  if (!rootCell) return null;
  var rootX = (typeof rootCell.xCw === "number") ? rootCell.xCw : rootCell.x;
  var rootY = (typeof rootCell.yCw === "number") ? rootCell.yCw : rootCell.y;
  if (typeof rootX !== "number" || typeof rootY !== "number") return null;
  var rootDisplayX = this._worldXToDisplayX(rootX);
  var rootDisplayY = this._worldYToDisplayY(rootY);
  var displayDeltaX = this._isLeftHanded ? xDelta : -xDelta;
  var displayDeltaY = this._isVerticallyMirrored ? -yDelta : yDelta;
  var noteDisplayX = rootDisplayX + displayDeltaX;
  var noteDisplayY = rootDisplayY + displayDeltaY;
  return {
    xCw: this._displayXToWorldX(noteDisplayX),
    yCw: this._displayYToWorldY(noteDisplayY)
  };
};

/**
 * Parses riff note string like "(0,0002),(-1,0200)" into 4-beat fretspace offsets.
 */
Fretscape.prototype._parseRiffNotes = function (notesString) {
  var beats = [[], [], [], []];
  if (typeof notesString !== "string") return beats;
  var re = /\(\s*(-?\d+)\s*,\s*([^)]+)\)/g;
  var match;
  while ((match = re.exec(notesString))) {
    var y = parseInt(match[1], 10);
    if (isNaN(y)) continue;
    var sequenceRaw = String(match[2] || "").trim();
    if (!sequenceRaw) continue;
    var compact = sequenceRaw.replace(/\s+/g, "");
    var tokens = compact.indexOf(",") >= 0 ? compact.split(",") : compact.split("");
    for (var i = 0; i < 4; i++) {
      var token = i < tokens.length ? String(tokens[i] || "").trim() : "-";
      if (!token || token === "-") continue;
      var x = parseInt(token, 10);
      if (isNaN(x)) continue;
      beats[i].push({ x: x, y: y });
    }
  }
  return beats;
};

/**
 * Applies selected riff object. notes/tab string maps fretspace coordinates per beat.
 */
Fretscape.prototype.setRiffPattern = function (riff) {
  if (!riff || typeof riff !== "object") {
    this._activeRiff = null;
    this._activeRiffBeats = null;
    this._clearProgressionPulse();
    this.render();
    return;
  }
  var riffString = "";
  if (typeof riff.notes === "string") riffString = riff.notes;
  else if (typeof riff.tab === "string") riffString = riff.tab;
  this._activeRiff = riff;
  this._activeRiffBeats = this._parseRiffNotes(riffString);
  if (!this._isProgressionPlaying) {
    this._clearProgressionPulse();
  }
  this.render();
};

/**
 * Normalizes a strum beat token so it only contains d/u/s/- symbols.
 */
Fretscape.prototype._normalizeStrumBeatToken = function (token) {
  var raw = String(token || "").toLowerCase().replace(/\s+/g, "");
  if (!raw) return "-";
  var normalized = "";
  for (var i = 0; i < raw.length; i++) {
    var symbol = raw.charAt(i);
    if (symbol === "d" || symbol === "u" || symbol === "s" || symbol === "-") {
      normalized += symbol;
    }
  }
  return normalized || "-";
};

/**
 * Parses a strum pattern payload into 4 normalized beat tokens.
 */
Fretscape.prototype._parseStrumPatternBeats = function (beatsValue) {
  var tokens = [];
  if (Array.isArray(beatsValue)) {
    tokens = beatsValue.slice();
  } else if (typeof beatsValue === "string") {
    tokens = beatsValue.split(",");
  }
  var beats = [];
  for (var i = 0; i < this._progressionBeatsPerChord; i++) {
    var token = i < tokens.length ? tokens[i] : "-";
    beats.push(this._normalizeStrumBeatToken(token));
  }
  return beats;
};

/**
 * Builds a strum timeline with beat offsets for d/u/s actions inside one 4-beat bar.
 */
Fretscape.prototype._buildStrumTimeline = function (strumBeats) {
  var timeline = [];
  if (!strumBeats || !strumBeats.length) return timeline;
  for (var beat = 0; beat < this._progressionBeatsPerChord; beat++) {
    var token = this._normalizeStrumBeatToken(strumBeats[beat] || "-");
    var steps = token ? token.split("") : ["-"];
    var stepSize = 1 / Math.max(1, steps.length);
    for (var step = 0; step < steps.length; step++) {
      var symbol = steps[step];
      if (symbol !== "d" && symbol !== "u" && symbol !== "s") continue;
      timeline.push({ symbol: symbol, time: beat + step * stepSize });
    }
  }
  return timeline;
};

/**
 * Applies selected strum pattern. Null clears strumming and uses bass mode only.
 */
Fretscape.prototype.setStrumPattern = function (pattern) {
  if (!pattern || typeof pattern !== "object") {
    this._activeStrumPattern = null;
    this._activeStrumBeats = null;
    this._activeStrumTimeline = null;
    this.render();
    return;
  }
  var beats = this._parseStrumPatternBeats(pattern.beats);
  this._activeStrumPattern = pattern;
  this._activeStrumBeats = beats;
  this._activeStrumTimeline = this._buildStrumTimeline(beats);
  this.render();
};

/**
 * Clears transient playback dots between transport states.
 */
Fretscape.prototype._clearProgressionPulse = function () {
  this._progressionPulseFromCell = null;
  this._progressionPulseToCell = null;
  this._progressionPulseFromCells = [];
  this._progressionPulseToCells = [];
  this._progressionPulseProgress = 0;
};

/**
 * Parses a roman-numeral degree token and returns degree index + accidental.
 */
Fretscape.prototype._parseDegreeToken = function (degreeToken) {
  if (typeof degreeToken !== "string") return null;
  var token = degreeToken.trim();
  if (!token) return null;
  var accidental = 0;
  while (token.charAt(0) === "#" || token.charAt(0) === "b") {
    accidental += token.charAt(0) === "#" ? 1 : -1;
    token = token.slice(1);
  }
  if (!token) return null;
  var degree = token.toUpperCase();
  var degreeOrder = ["I", "II", "III", "IV", "V", "VI", "VII"];
  var degreeIndex = degreeOrder.indexOf(degree);
  if (degreeIndex < 0) return null;
  return { degreeIndex: degreeIndex, accidental: accidental };
};

/**
 * Converts a scale-degree token (for example "vi" or "bVII") into semitone offset from I.
 */
Fretscape.prototype._degreeToSemitoneOffset = function (degreeToken) {
  var parsed = this._parseDegreeToken(degreeToken);
  if (!parsed) return null;
  var scaleSemitones = [0, 2, 4, 5, 7, 9, 11];
  var semitone = scaleSemitones[parsed.degreeIndex] + parsed.accidental;
  return ((semitone % 12) + 12) % 12;
};

/**
 * Returns the diatonic scale-index (0..6) for a degree token, or null if invalid.
 */
Fretscape.prototype._degreeToScaleIndex = function (degreeToken) {
  var parsed = this._parseDegreeToken(degreeToken);
  return parsed ? parsed.degreeIndex : null;
};

/**
 * Returns the semitone for the scale-tone between a chord root and its fifth (the chord third).
 */
Fretscape.prototype._getThirdSemitoneOffsetForDegree = function (degreeToken) {
  var rootSemitone = this._degreeToSemitoneOffset(degreeToken);
  var rootScaleIndex = this._degreeToScaleIndex(degreeToken);
  if (rootSemitone === null || rootScaleIndex === null) return null;
  var thirdIntervalsByScaleIndex = [4, 3, 3, 4, 4, 3, 3];
  var interval = thirdIntervalsByScaleIndex[rootScaleIndex];
  return ((rootSemitone + interval) % 12 + 12) % 12;
};

/**
 * Converts a Brick cell label (for example "4" or "b6") into semitone offset from "1".
 */
Fretscape.prototype._cellLabelToSemitoneOffset = function (labelToken) {
  if (typeof labelToken !== "string") return null;
  var token = labelToken.trim();
  if (!token) return null;
  var accidental = 0;
  while (token.charAt(0) === "#" || token.charAt(0) === "b") {
    accidental += token.charAt(0) === "#" ? 1 : -1;
    token = token.slice(1);
  }
  var degreeNum = parseInt(token, 10);
  if (!degreeNum || degreeNum < 1 || degreeNum > 7) return null;
  var degreeSemitones = [0, 2, 4, 5, 7, 9, 11];
  var semitone = degreeSemitones[degreeNum - 1] + accidental;
  return ((semitone % 12) + 12) % 12;
};

/**
 * Returns top-left coords for a default single brick centered at configured origin.
 */
Fretscape.prototype._getDefaultBrickTopLeft = function () {
  var brick = new Brick();
  var originOffset = this._getBrickOriginOffset(brick);
  return {
    x: this._defaultOneCellCenterCw.x - originOffset.col,
    y: this._defaultOneCellCenterCw.y - originOffset.row
  };
};

/**
 * Finds the root-cell position for a degree in the first brick, using only the bottom two rows.
 */
Fretscape.prototype._findRootCellInFirstBrick = function (degreeToken) {
  if (!this.bricks.length) return null;
  var targetSemitone = this._degreeToSemitoneOffset(degreeToken);
  if (targetSemitone === null) return null;
  var firstBrick = this.bricks[0];
  if (!firstBrick || !firstBrick.brick || !firstBrick.brick.cellData) return null;
  var data = firstBrick.brick.cellData;
  var startRow = Math.max(0, data.length - 2);
  for (var r = startRow; r < data.length; r++) {
    for (var c = 0; c < data[r].length; c++) {
      var cellSemitone = this._cellLabelToSemitoneOffset(data[r][c]);
      if (cellSemitone === targetSemitone) {
        return { xCw: firstBrick.xCw + c, yCw: firstBrick.yCw + r };
      }
    }
  }
  return null;
};

/**
 * Finds the root-cell on the same two strings used by the green progression guide.
 */
Fretscape.prototype._findRootCellOnTopStringsInFirstBrick = function (degreeToken) {
  if (!this.bricks.length) return null;
  var targetSemitone = this._degreeToSemitoneOffset(degreeToken);
  if (targetSemitone === null) return null;
  var firstBrick = this.bricks[0];
  if (!firstBrick || !firstBrick.brick || !firstBrick.brick.cellData) return null;
  var data = firstBrick.brick.cellData;
  var startRow = Math.max(0, data.length - 2);
  for (var r = startRow; r < data.length; r++) {
    for (var c = 0; c < data[r].length; c++) {
      var cellSemitone = this._cellLabelToSemitoneOffset(data[r][c]);
      if (cellSemitone === targetSemitone) {
        return { xCw: firstBrick.xCw + c, yCw: firstBrick.yCw + r };
      }
    }
  }
  return null;
};

/**
 * Finds nearest cell in the first brick with matching semitone.
 */
Fretscape.prototype._findNearestCellInFirstBrickBySemitone = function (targetSemitone, referenceCell) {
  if (!this.bricks.length) return null;
  var firstBrick = this.bricks[0];
  if (!firstBrick || !firstBrick.brick || !firstBrick.brick.cellData) return null;
  var data = firstBrick.brick.cellData;
  var best = null;
  var bestDist = Number.POSITIVE_INFINITY;
  for (var r = 0; r < data.length; r++) {
    for (var c = 0; c < data[r].length; c++) {
      var cellSemitone = this._cellLabelToSemitoneOffset(data[r][c]);
      if (cellSemitone !== targetSemitone) continue;
      var candidate = { xCw: firstBrick.xCw + c, yCw: firstBrick.yCw + r };
      var dx = referenceCell ? candidate.xCw - referenceCell.xCw : 0;
      var dy = referenceCell ? candidate.yCw - referenceCell.yCw : 0;
      var dist = referenceCell ? (dx * dx + dy * dy) : 0;
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
  }
  return best;
};

/**
 * Builds root entries for the active progression on the first brick.
 */
Fretscape.prototype._getActiveProgressionRootEntries = function () {
  var entries = [];
  if (!this._activeProgressionDegrees || !this._activeProgressionDegrees.length) return entries;
  var firstBrick = this.bricks.length ? this.bricks[0] : null;
  var canReadBrickLabels = !!(firstBrick && firstBrick.brick && firstBrick.brick.cellData);
  for (var i = 0; i < this._activeProgressionDegrees.length; i++) {
    var token = this._activeProgressionDegrees[i];
    if (canReadBrickLabels) {
      var rootCell = this._findRootCellInFirstBrick(token);
      if (rootCell) {
        entries.push({ degreeToken: token, rootCell: rootCell });
        continue;
      }
    }
    var semitone = this._degreeToSemitoneOffset(token);
    if (semitone === null) continue;
    var offset = this._semitoneToFretspaceOffset(semitone);
    var fallbackRoot = this._fretspaceDeltaToWorldFromRoot(this._getOneCellCenter(), offset.x, offset.y);
    if (!fallbackRoot) continue;
    entries.push({ degreeToken: token, rootCell: fallbackRoot });
  }
  return entries;
};

/**
 * Builds root-cell list for the active progression on the first brick.
 */
Fretscape.prototype._getActiveProgressionRootCells = function () {
  var cells = [];
  var entries = this._getActiveProgressionRootEntries();
  for (var i = 0; i < entries.length; i++) {
    cells.push(entries[i].rootCell);
  }
  return cells;
};

/**
 * Returns the cell one row above in the first brick, or null when out of bounds.
 */
Fretscape.prototype._getCellAboveInFirstBrick = function (cell) {
  if (!cell || !this.bricks.length) return null;
  var firstBrick = this.bricks[0];
  if (!firstBrick) return null;
  var minY = firstBrick.yCw;
  var maxY = firstBrick.yCw + this.brickHeightCw - 1;
  var targetY = cell.yCw - 1;
  if (targetY < minY || targetY > maxY) return null;
  return { xCw: cell.xCw, yCw: targetY };
};

/**
 * Returns root/third/fifth cells for a chord index in the active progression.
 */
Fretscape.prototype._getChordShapeForRootIndex = function (rootEntries, rootIndex) {
  if (!rootEntries || !rootEntries.length) return null;
  var normalized = ((rootIndex % rootEntries.length) + rootEntries.length) % rootEntries.length;
  var entry = rootEntries[normalized];
  if (!entry || !entry.rootCell) return null;
  var root = entry.rootCell;
  var fifth = this._getCellAboveInFirstBrick(root);
  var thirdSemitone = this._getThirdSemitoneOffsetForDegree(entry.degreeToken);
  var third = thirdSemitone === null ? null : this._findNearestCellInFirstBrickBySemitone(thirdSemitone, root);
  return { root: root, third: third || root, fifth: fifth || root };
};

/**
 * Builds E-shape 5-1-3 geometry from root on top two strings of center brick.
 */
Fretscape.prototype._getEshape513ForDegreeToken = function (degreeToken, fallbackShape) {
  if (!fallbackShape) return null;
  var root = this._findRootCellOnTopStringsInFirstBrick(degreeToken) || fallbackShape.root;
  if (!root) return fallbackShape;
  var rootSemitone = this._degreeToSemitoneOffset(degreeToken);
  var thirdSemitone = this._getThirdSemitoneOffsetForDegree(degreeToken);
  var thirdInterval = (rootSemitone === null || thirdSemitone === null) ? 3 : ((thirdSemitone - rootSemitone + 12) % 12);
  var thirdXDelta = thirdInterval === 4 ? -1 : -2; /* Major => -1, minor/diminished => -2. */
  var third = this._fretspaceDeltaToWorldFromRoot(root, thirdXDelta, 1);
  var fifth = this._fretspaceDeltaToWorldFromRoot(root, 0, -1);
  return {
    root: root,
    third: third || fallbackShape.third || root,
    fifth: fifth || fallbackShape.fifth || root
  };
};

/**
 * Builds C-shape 1-3-5-1 geometry with same root/third as E-shape.
 * Fifth is placed at fixed C-shape fretspace offset (x-3, y+2) from root.
 */
Fretscape.prototype._getCshape1351ForDegreeToken = function (degreeToken, fallbackShape) {
  var eshape = this._getEshape513ForDegreeToken(degreeToken, fallbackShape);
  if (!eshape || !eshape.root) return fallbackShape;
  var cshapeFifth = this._fretspaceDeltaToWorldFromRoot(eshape.root, -3, 2);
  return {
    root: eshape.root,
    third: eshape.third || eshape.root,
    fifth: cshapeFifth || eshape.fifth || eshape.root
  };
};

/**
 * Returns normalized bass-run spec for active mode.
 */
Fretscape.prototype._getBassRunSpec = function () {
  var specs = {
    "root": {
      sequence: ["root", "root", "root", "root"],
      shapeStrategy: "default",
      guideSequence: []
    },
    "root5th": {
      sequence: ["root", "fifth", "root", "fifth"],
      shapeStrategy: "default",
      guideSequence: ["root", "fifth"]
    },
    "arpeggio135": {
      sequence: ["root", "third", "fifth", "root"],
      shapeStrategy: "default",
      guideSequence: ["root", "third", "fifth"]
    },
    "eshape513": {
      sequence: ["root", "third", "fifth", "root"],
      shapeStrategy: "eshape513",
      guideSequence: ["root", "third", "fifth"]
    },
    "cshape1351": {
      sequence: ["root", "third", "fifth", "root"],
      shapeStrategy: "cshape1351",
      guideSequence: ["root", "third", "fifth", "root"]
    }
  };
  var mode = this._progressionPlaybackMode || "root";
  return specs.hasOwnProperty(mode) ? specs[mode] : specs.root;
};

/**
 * Returns chord shape for bass-run playback using current mode strategy.
 */
Fretscape.prototype._getBassRunShapeForChordIndex = function (rootEntries, chordIndex, spec) {
  if (!rootEntries || !rootEntries.length) return null;
  var normalized = ((chordIndex % rootEntries.length) + rootEntries.length) % rootEntries.length;
  var chordEntry = rootEntries[normalized];
  var shape = this._getChordShapeForRootIndex(rootEntries, normalized);
  if (!shape) return null;
  if (spec && spec.shapeStrategy === "eshape513") {
    shape = this._getEshape513ForDegreeToken(chordEntry && chordEntry.degreeToken, shape);
  } else if (spec && spec.shapeStrategy === "cshape1351") {
    shape = this._getCshape1351ForDegreeToken(chordEntry && chordEntry.degreeToken, shape);
  }
  return shape;
};

/**
 * Resolves a bass-run token ("root","third","fifth","hold","rest") to a shape cell.
 */
Fretscape.prototype._resolveBassRunTokenCell = function (shape, token) {
  if (!shape || token === "rest") return null;
  if (token === "hold") return shape.root || null;
  if (token === "third") return shape.third || shape.root || null;
  if (token === "fifth") return shape.fifth || shape.root || null;
  return shape.root || null;
};

/**
 * Converts a bass-run token into timed note events for one beat.
 */
Fretscape.prototype._buildBassRunNoteEvents = function (shape, token, beatInChord, spec) {
  var events = [];
  if (!shape) return events;
  if (token === "rest" || token === "hold") return events;
  var cell = this._resolveBassRunTokenCell(shape, token);
  if (cell) {
    events.push({ cell: cell, delayBeats: 0, durationBeats: 1 });
  }
  return events;
};

/**
 * Builds timed strum note events for one beat from active d/u/s timeline.
 */
Fretscape.prototype._buildStrumNoteEventsForBeat = function (shape, beatInChord) {
  var events = [];
  if (!shape || !this._activeStrumTimeline || !this._activeStrumTimeline.length) return events;
  var barBeats = this._progressionBeatsPerChord;
  var beatStart = beatInChord;
  var beatEnd = beatStart + 1;
  var strokeDelay = Math.max(0.01, this._strumStrokeGapBeats || 0.05);
  for (var i = 0; i < this._activeStrumTimeline.length; i++) {
    var action = this._activeStrumTimeline[i];
    if (!action || typeof action.time !== "number") continue;
    if (action.time < beatStart || action.time >= beatEnd) continue;
    if (action.symbol === "s") {
      var slapDelay = action.time - beatStart;
      if (slapDelay >= 0 && slapDelay < 1) {
        events.push({
          kind: "slap",
          cell: shape.root || null,
          delayBeats: slapDelay,
          durationBeats: 0.08
        });
      }
      continue;
    }
    if (action.symbol !== "d" && action.symbol !== "u") continue;
    var nextBoundary = barBeats;
    for (var n = i + 1; n < this._activeStrumTimeline.length; n++) {
      var nextAction = this._activeStrumTimeline[n];
      if (!nextAction || typeof nextAction.time !== "number") continue;
      if (nextAction.time > action.time) {
        nextBoundary = Math.min(barBeats, nextAction.time);
        break;
      }
    }
    var order = action.symbol === "u" ? ["fifth", "third", "root"] : ["root", "third", "fifth"];
    for (var step = 0; step < order.length; step++) {
      var strikeCell = this._resolveBassRunTokenCell(shape, order[step]);
      if (!strikeCell) continue;
      var strikeBeat = action.time + step * strokeDelay;
      if (strikeBeat >= nextBoundary || strikeBeat >= barBeats) continue;
      var delayBeats = strikeBeat - beatStart;
      if (delayBeats < 0 || delayBeats >= 1) continue;
      var durationBeats = nextBoundary - strikeBeat;
      events.push({
        kind: "strum",
        cell: strikeCell,
        delayBeats: delayBeats,
        durationBeats: Math.max(0.05, durationBeats)
      });
    }
  }
  return events;
};

/**
 * Returns playback guide token sequence, with strum taking precedence when selected.
 */
Fretscape.prototype._getProgressionGuideSequence = function () {
  if (this._activeStrumBeats && this._activeStrumBeats.length === this._progressionBeatsPerChord) {
    return ["root", "third", "fifth"];
  }
  var spec = this._getBassRunSpec();
  return spec && spec.guideSequence ? spec.guideSequence : [];
};

/**
 * Returns travel anchor for rest beats so animation can move toward next chord root.
 */
Fretscape.prototype._getBassRunRestAnchor = function (rootEntries, chordIndex, spec) {
  var nextShape = this._getBassRunShapeForChordIndex(rootEntries, chordIndex + 1, spec);
  return nextShape && nextShape.root ? nextShape.root : null;
};

/**
 * Returns playback beat frame (timed notes + travel anchor + chord shape).
 */
Fretscape.prototype._getProgressionBeatPlan = function (beatIndex, rootEntries) {
  if (!rootEntries || !rootEntries.length) return null;
  var spec = this._getBassRunSpec();
  var chordIndex = Math.floor(beatIndex / this._progressionBeatsPerChord);
  var beatInChord = beatIndex % this._progressionBeatsPerChord;
  var hasStrum = !!(this._activeStrumBeats && this._activeStrumBeats.length === this._progressionBeatsPerChord);
  var shapeSpec = hasStrum ? { shapeStrategy: "cshape1351" } : spec;
  var shape = this._getBassRunShapeForChordIndex(rootEntries, chordIndex, shapeSpec);
  if (!shape) return null;
  var token = hasStrum ? "hold" : spec.sequence[beatInChord % spec.sequence.length];
  var tokenCell = this._resolveBassRunTokenCell(shape, token);
  var noteEvents = [];
  var noteCells = [];
  if (this._activeRiffBeats && this._activeRiffBeats.length === 4) {
    var riffBeat = this._activeRiffBeats[beatInChord % 4];
    if (riffBeat && riffBeat.length) {
      for (var r = 0; r < riffBeat.length; r++) {
        var point = this._fretspaceDeltaToWorldFromRoot(shape.root, riffBeat[r].x, riffBeat[r].y);
        if (!point) continue;
        noteCells.push(point);
        noteEvents.push({ cell: point, delayBeats: 0, durationBeats: 1 });
      }
    }
  }
  if (!noteCells.length && hasStrum) {
    noteEvents = this._buildStrumNoteEventsForBeat(shape, beatInChord);
    for (var s = 0; s < noteEvents.length; s++) {
      noteCells.push(noteEvents[s].cell);
    }
    if (!noteCells.length) {
      noteCells.push(shape.root);
    }
  }
  if (!noteCells.length) {
    noteEvents = this._buildBassRunNoteEvents(shape, token, beatInChord, spec);
    for (var e = 0; e < noteEvents.length; e++) {
      noteCells.push(noteEvents[e].cell);
    }
  }
  if (!noteCells.length && tokenCell) {
    noteCells.push(tokenCell); /* keep anchor continuity for hold/rest behavior */
  }
  var anchorCell = noteCells.length ? noteCells[0] : tokenCell;
  if (!anchorCell && token === "rest") {
    anchorCell = this._getBassRunRestAnchor(rootEntries, chordIndex, spec);
  }
  return {
    noteCell: noteCells.length ? noteCells[0] : tokenCell,
    noteCells: noteCells,
    noteEvents: noteEvents,
    anchorCell: anchorCell,
    shape: shape
  };
};

/**
 * Returns interpolated cell coordinate between two cells for normalized t in [0,1].
 */
Fretscape.prototype._interpolateCell = function (startCell, endCell, t) {
  if (!startCell || !endCell) return null;
  var clamped = Math.max(0, Math.min(1, t));
  return {
    xCw: startCell.xCw + (endCell.xCw - startCell.xCw) * clamped,
    yCw: startCell.yCw + (endCell.yCw - startCell.yCw) * clamped
  };
};

/**
 * Sets bass playback mode. Supported: "root", "root5th", "arpeggio135", "eshape513", "cshape1351".
 */
Fretscape.prototype.setProgressionPlaybackMode = function (mode) {
  var normalized = "root";
  if (mode === "root5th") normalized = "root5th";
  if (mode === "arpeggio135") normalized = "arpeggio135";
  if (mode === "eshape513") normalized = "eshape513";
  if (mode === "cshape1351") normalized = "cshape1351";
  if (mode === "strum135") normalized = "cshape1351";
  if (this._progressionPlaybackMode === normalized) return;
  this._progressionPlaybackMode = normalized;
  if (this._isProgressionPlaying) {
    this.stopProgressionPlayback();
    return;
  }
  this.render();
};

/**
 * Returns true when a selected progression maps to at least one root point.
 */
Fretscape.prototype.hasProgressionPath = function () {
  return this._getActiveProgressionRootCells().length > 0;
};

/**
 * Returns true when progression playback transport is active.
 */
Fretscape.prototype.isProgressionPlaybackActive = function () {
  return !!this._isProgressionPlaying;
};

/**
 * Returns one quarter-note duration in milliseconds for progression playback.
 */
Fretscape.prototype._getProgressionBeatMs = function () {
  return 60000 / this._progressionBpm;
};

/**
 * Sets progression playback tempo in BPM (clamped to 60..200).
 */
Fretscape.prototype.setProgressionBpm = function (bpm) {
  var next = parseInt(bpm, 10);
  if (!next || next < 60) next = 60;
  if (next > 200) next = 200;
  this._progressionBpm = next;
  if (this._isProgressionPlaying) {
    this._restartProgressionBeatTimer();
  }
};

/**
 * Restarts beat interval using current BPM while preserving beat index.
 */
Fretscape.prototype._restartProgressionBeatTimer = function () {
  if (this._progressionBeatTimer !== null) {
    window.clearInterval(this._progressionBeatTimer);
    this._progressionBeatTimer = null;
  }
  if (!this._isProgressionPlaying) return;
  var self = this;
  this._progressionBeatTimer = window.setInterval(function () {
    self._playProgressionBeat();
  }, this._getProgressionBeatMs());
};

/**
 * Notifies app-level playback subscribers after transport state changes.
 */
Fretscape.prototype._notifyProgressionPlaybackStateChange = function () {
  if (typeof this.onProgressionPlaybackStateChange === "function") {
    this.onProgressionPlaybackStateChange();
  }
};

/**
 * Draws a thin green guide line under root notes for the active progression on brick #1.
 */
Fretscape.prototype._drawProgressionRootGuide = function () {
  var cells = this._getActiveProgressionRootCells();
  if (cells.length < 2) return;
  var underlineOffsetPx = this.cellWidth * 0.22;
  this.ctx.save();
  this.ctx.beginPath();
  this.ctx.strokeStyle = "#2ea043";
  this.ctx.lineWidth = Math.max(1, this.cellWidth * 0.015);
  this.ctx.lineCap = "round";
  this.ctx.lineJoin = "round";
  this.ctx.moveTo(this._xCwToPx(cells[0].xCw), this._yCwToPx(cells[0].yCw) + underlineOffsetPx);
  for (var i = 1; i < cells.length; i++) {
    this.ctx.lineTo(this._xCwToPx(cells[i].xCw), this._yCwToPx(cells[i].yCw) + underlineOffsetPx);
  }
  this.ctx.stroke();
  this.ctx.restore();
};

/**
 * Draws yellow playback guide for current bass-run mode sequence.
 */
Fretscape.prototype._drawProgressionRootToFifthGuide = function () {
  var guide = this._getProgressionGuideSequence();
  if (guide.length < 2) return;
  if (!this._progressionGuidePairFrom || !this._progressionGuidePairTo) return;
  var t = Math.max(0, Math.min(1, this._progressionPulseProgress || 0));
  var resolveGuidePoint = function (token) {
    var fromCell = this._progressionGuidePairFrom[token];
    var toCell = this._progressionGuidePairTo[token];
    return this._interpolateCell(fromCell, toCell, t);
  }.bind(this);
  var startPoint = resolveGuidePoint(guide[0]);
  if (!startPoint) return;
  this.ctx.save();
  this.ctx.beginPath();
  this.ctx.moveTo(this._xCwToPx(startPoint.xCw), this._yCwToPx(startPoint.yCw));
  for (var i = 1; i < guide.length; i++) {
    var point = resolveGuidePoint(guide[i]);
    if (!point) continue;
    this.ctx.lineTo(this._xCwToPx(point.xCw), this._yCwToPx(point.yCw));
  }
  this.ctx.strokeStyle = "#f1c40f";
  this.ctx.lineWidth = Math.max(1, this.cellWidth * 0.015);
  this.ctx.lineCap = "round";
  this.ctx.lineJoin = "round";
  this.ctx.stroke();
  this.ctx.restore();
};

/**
 * Draws the moving green playback dot with pulsing radius.
 */
Fretscape.prototype._drawProgressionPulseIndicator = function () {
  if (!this._progressionPulseFromCells || !this._progressionPulseFromCells.length) return;
  if (!this._progressionPulseToCells || !this._progressionPulseToCells.length) return;
  var moveT = Math.max(0, Math.min(1, this._progressionPulseProgress || 0));
  var dotCount = Math.max(this._progressionPulseFromCells.length, this._progressionPulseToCells.length);
  if (!dotCount) return;
  var noteRadius = this.cellWidth * 0.4;
  /* Peak on the beat, smallest halfway between beats. */
  var minScale = 0.01;
  var beatOscillation = 0.5 + 0.5 * Math.cos(moveT * Math.PI * 2);
  var pulseScale = minScale + (1 - minScale) * beatOscillation;
  var pulseRadius = noteRadius * pulseScale;
  for (var i = 0; i < dotCount; i++) {
    var fromCell = this._progressionPulseFromCells[Math.min(i, this._progressionPulseFromCells.length - 1)];
    var toCell = this._progressionPulseToCells[Math.min(i, this._progressionPulseToCells.length - 1)];
    var pulseCell = this._interpolateCell(fromCell, toCell, moveT);
    if (!pulseCell) continue;
    var centerX = this._xCwToPx(pulseCell.xCw);
    var centerY = this._yCwToPx(pulseCell.yCw);
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.arc(centerX, centerY, pulseRadius, 0, Math.PI * 2);
    this.ctx.fillStyle = "#2ea043";
    this.ctx.fill();
    this.ctx.strokeStyle = "#1f7a34";
    this.ctx.lineWidth = Math.max(1, this.cellWidth * 0.01);
    this.ctx.stroke();
    this.ctx.restore();
  }
};

/**
 * Starts pulse animation frames for beat-synced motion and pulsing.
 */
Fretscape.prototype._startProgressionPulseLoop = function () {
  if (this._progressionAnimationFrame !== null) return;
  var self = this;
  var tick = function () {
    if (!self._isProgressionPlaying ||
        !self._progressionPulseFromCells || !self._progressionPulseFromCells.length ||
        !self._progressionPulseToCells || !self._progressionPulseToCells.length) {
      self._progressionAnimationFrame = null;
      self.render();
      return;
    }
    var now = (window.performance && window.performance.now) ? window.performance.now() : Date.now();
    var beatMs = self._getProgressionBeatMs();
    self._progressionPulseProgress = Math.max(0, Math.min(1, (now - self._progressionPulseStartMs) / beatMs));
    self.render();
    self._progressionAnimationFrame = window.requestAnimationFrame(tick);
  };
  this._progressionAnimationFrame = window.requestAnimationFrame(tick);
};

/**
 * Stops the pulse animation frame loop when playback transport is off.
 */
Fretscape.prototype._stopProgressionPulseLoop = function () {
  if (this._progressionAnimationFrame === null) return;
  window.cancelAnimationFrame(this._progressionAnimationFrame);
  this._progressionAnimationFrame = null;
};

/**
 * Plays one beat of the active progression root path and resets pulse animation.
 */
Fretscape.prototype._playProgressionBeat = function () {
  var rootEntries = this._getActiveProgressionRootEntries();
  if (!rootEntries.length) {
    this.stopProgressionPlayback();
    return;
  }
  var currentPlan = this._getProgressionBeatPlan(this._progressionBeatIndex, rootEntries);
  var nextPlan = this._getProgressionBeatPlan(this._progressionBeatIndex + 1, rootEntries);
  if (!currentPlan || !currentPlan.shape) {
    this.stopProgressionPlayback();
    return;
  }
  var currentNotes = currentPlan.noteCells && currentPlan.noteCells.length ? currentPlan.noteCells.slice() : [];
  var currentEvents = currentPlan.noteEvents && currentPlan.noteEvents.length ? currentPlan.noteEvents.slice() : [];
  var nextNotes = (nextPlan && nextPlan.noteCells && nextPlan.noteCells.length) ? nextPlan.noteCells.slice() : [];
  var currentAnchor = currentPlan.anchorCell || (currentNotes.length ? currentNotes[0] : null);
  var nextAnchor = (nextPlan && nextPlan.anchorCell) || (nextNotes.length ? nextNotes[0] : currentAnchor);
  var nextShape = nextPlan && nextPlan.shape ? nextPlan.shape : currentPlan.shape;
  this._playDrumBeat(this._progressionBeatIndex % 4);
  var beatSeconds = this._getProgressionBeatMs() / 1000;
  for (var n = 0; n < currentEvents.length; n++) {
    var event = currentEvents[n];
    if (!event) continue;
    var delaySec = (typeof event.delayBeats === "number") ? Math.max(0, event.delayBeats * beatSeconds) : 0;
    if (event.kind === "slap") {
      this._playSlapTone({ delaySec: delaySec });
      continue;
    }
    if (!event.cell) continue;
    var durationSec = (typeof event.durationBeats === "number") ? Math.max(0.08, event.durationBeats * beatSeconds) : undefined;
    this._playDotTone(event.cell.xCw, event.cell.yCw, {
      delaySec: delaySec,
      durationSec: durationSec,
      sustainHold: event.kind === "strum"
    });
  }
  if (currentAnchor) {
    this._progressionPulseFromCell = { xCw: currentAnchor.xCw, yCw: currentAnchor.yCw };
    this._progressionPulseToCell = nextAnchor
      ? { xCw: nextAnchor.xCw, yCw: nextAnchor.yCw }
      : { xCw: currentAnchor.xCw, yCw: currentAnchor.yCw };
    this._progressionPulseFromCells = [];
    this._progressionPulseToCells = [];
    if (currentNotes.length) {
      for (var i = 0; i < currentNotes.length; i++) {
        this._progressionPulseFromCells.push({ xCw: currentNotes[i].xCw, yCw: currentNotes[i].yCw });
      }
    } else {
      this._progressionPulseFromCells.push({ xCw: currentAnchor.xCw, yCw: currentAnchor.yCw });
    }
    if (nextNotes.length) {
      for (var j = 0; j < nextNotes.length; j++) {
        this._progressionPulseToCells.push({ xCw: nextNotes[j].xCw, yCw: nextNotes[j].yCw });
      }
    } else if (nextAnchor) {
      this._progressionPulseToCells.push({ xCw: nextAnchor.xCw, yCw: nextAnchor.yCw });
    } else {
      this._progressionPulseToCells.push({ xCw: currentAnchor.xCw, yCw: currentAnchor.yCw });
    }
  } else {
    this._clearProgressionPulse();
  }
  this._progressionGuidePairFrom = {
    root: { xCw: currentPlan.shape.root.xCw, yCw: currentPlan.shape.root.yCw },
    third: { xCw: currentPlan.shape.third.xCw, yCw: currentPlan.shape.third.yCw },
    fifth: { xCw: currentPlan.shape.fifth.xCw, yCw: currentPlan.shape.fifth.yCw }
  };
  this._progressionGuidePairTo = {
    root: { xCw: nextShape.root.xCw, yCw: nextShape.root.yCw },
    third: { xCw: nextShape.third.xCw, yCw: nextShape.third.yCw },
    fifth: { xCw: nextShape.fifth.xCw, yCw: nextShape.fifth.yCw }
  };
  this._progressionPulseProgress = 0;
  this._progressionPulseStartMs = (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  this._progressionBeatIndex++;
  this._startProgressionPulseLoop();
  this.render();
};

/**
 * Starts progression playback at 100 BPM, quarter-note pulses, 4 beats per chord root.
 */
Fretscape.prototype.startProgressionPlayback = function () {
  if (this._isProgressionPlaying) return true;
  if (!this.hasProgressionPath()) return false;
  this._isProgressionPlaying = true;
  this._progressionBeatIndex = 0;
  if (this._drumEngine && typeof this._drumEngine.reset === "function") {
    this._drumEngine.reset();
  }
  this._playProgressionBeat();
  this._restartProgressionBeatTimer();
  this._notifyProgressionPlaybackStateChange();
  return true;
};

/**
 * Stops progression playback and clears active beat pulse.
 */
Fretscape.prototype.stopProgressionPlayback = function () {
  var wasPlaying = this._isProgressionPlaying;
  if (this._progressionBeatTimer !== null) {
    window.clearInterval(this._progressionBeatTimer);
    this._progressionBeatTimer = null;
  }
  if (this._drumEngine && typeof this._drumEngine.stop === "function") {
    this._drumEngine.stop();
  }
  this._isProgressionPlaying = false;
  this._progressionBeatIndex = 0;
  this._clearProgressionPulse();
  this._progressionGuidePairFrom = null;
  this._progressionGuidePairTo = null;
  this._stopProgressionPulseLoop();
  if (wasPlaying) {
    this._notifyProgressionPlaybackStateChange();
  }
  this.render();
};

/**
 * Updates active progression state without adding extra bricks to the map.
 */
Fretscape.prototype.applyChordProgression = function (progression) {
  this._activeProgressionDegrees = (progression && progression.degrees && progression.degrees.length)
    ? progression.degrees.slice()
    : null;
  if (this._isProgressionPlaying && !this.hasProgressionPath()) {
    this.stopProgressionPlayback();
    return;
  }
  if (!this.bricks.length) {
    var topLeft = this._getDefaultBrickTopLeft();
    this.addBrick(new Brick(), topLeft.x, topLeft.y);
  }
  if (!this._isProgressionPlaying) {
    this._clearProgressionPulse();
    this._progressionGuidePairFrom = null;
    this._progressionGuidePairTo = null;
  }
  this.render();
};

/**
 * Flips coordinate system horizontally when true (left-hand mode).
 */
Fretscape.prototype.setLeftHanded = function (isLeftHanded) {
  this._isLeftHanded = !!isLeftHanded;
  this.render();
};

/**
 * Flips coordinate system vertically when true.
 */
Fretscape.prototype.setVerticalMirrored = function (isVerticalMirrored) {
  this._isVerticallyMirrored = !!isVerticalMirrored;
  this.render();
};

/**
 * Converts logical coords (cw units) to pixels. All positioning scales by cellWidth.
 */
Fretscape.prototype._cwToPx = function (cw) {
  return cw * this.cellWidth;
};

/**
 * Converts world x (cw) to display x (cw), respecting handedness.
 */
Fretscape.prototype._worldXToDisplayX = function (xCw) {
  return this._isLeftHanded ? (this.widthCw - xCw) : xCw;
};

/**
 * Converts display x (cw) back to world x (cw), respecting handedness.
 */
Fretscape.prototype._displayXToWorldX = function (xCw) {
  return this._isLeftHanded ? (this.widthCw - xCw) : xCw;
};

/**
 * Converts world x coordinate in cw units to pixels.
 */
Fretscape.prototype._xCwToPx = function (xCw) {
  return this._cwToPx(this._worldXToDisplayX(xCw));
};

/**
 * Converts world y (cw) to display y (cw), respecting vertical mirror state.
 */
Fretscape.prototype._worldYToDisplayY = function (yCw) {
  return this._isVerticallyMirrored ? (this.heightCw - yCw) : yCw;
};

/**
 * Converts display y (cw) back to world y (cw), respecting vertical mirror state.
 */
Fretscape.prototype._displayYToWorldY = function (yCw) {
  return this._isVerticallyMirrored ? (this.heightCw - yCw) : yCw;
};

/**
 * Converts world y coordinate in cw units to pixels.
 */
Fretscape.prototype._yCwToPx = function (yCw) {
  return this._cwToPx(this._worldYToDisplayY(yCw));
};

/**
 * Computes cellWidth in pixels so the canvas fits the container.
 * Uses container size; canvas may be letterboxed.
 */
Fretscape.prototype._fitCellWidth = function () {
  var cw = this.container.clientWidth;
  var ch = this.container.clientHeight;
  if (cw <= 0 || ch <= 0) { return 80; }
  return Math.min(cw / this.widthCw, ch / this.heightCw);
};

/**
 * Converts viewport pixels to canvas-local pixels.
 */
Fretscape.prototype._clientToCanvasPx = function (px, py) {
  var rect = this.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x: (px - rect.left) * (this.canvas.width / rect.width),
    y: (py - rect.top) * (this.canvas.height / rect.height)
  };
};

/**
 * Clamps view scale to configured limits.
 */
Fretscape.prototype._clampViewScale = function (scale) {
  return Math.max(this._minViewScale, Math.min(this._maxViewScale, scale));
};

/**
 * Zooms around a viewport point and keeps that world point fixed on screen.
 */
Fretscape.prototype._zoomAtClientPoint = function (factor, clientX, clientY) {
  if (!factor || factor <= 0) return;
  var local = this._clientToCanvasPx(clientX, clientY);
  if (!local) return;
  var oldScale = this._viewScale;
  var nextScale = this._clampViewScale(oldScale * factor);
  if (Math.abs(nextScale - oldScale) < 0.000001) return;
  var worldX = (local.x - this._viewPanPx.x) / oldScale;
  var worldY = (local.y - this._viewPanPx.y) / oldScale;
  this._viewScale = nextScale;
  this._viewPanPx.x = local.x - worldX * nextScale;
  this._viewPanPx.y = local.y - worldY * nextScale;
  this.render();
};

/**
 * Starts a two-touch pan/zoom gesture.
 */
Fretscape.prototype._beginTouchGesture = function (touches) {
  if (!touches || touches.length < 2) return;
  var t0 = touches[0];
  var t1 = touches[1];
  var centerX = (t0.clientX + t1.clientX) / 2;
  var centerY = (t0.clientY + t1.clientY) / 2;
  var center = this._clientToCanvasPx(centerX, centerY);
  if (!center) return;
  var dx = t1.clientX - t0.clientX;
  var dy = t1.clientY - t0.clientY;
  var dist = Math.sqrt(dx * dx + dy * dy);
  this._touchGesture = {
    startDistance: dist > 0.000001 ? dist : 1,
    startScale: this._viewScale,
    anchorWorldX: (center.x - this._viewPanPx.x) / this._viewScale,
    anchorWorldY: (center.y - this._viewPanPx.y) / this._viewScale
  };
};

/**
 * Updates two-touch gesture (pinch zoom + center-point pan).
 */
Fretscape.prototype._updateTouchGesture = function (touches) {
  if (!this._touchGesture || !touches || touches.length < 2) return;
  var t0 = touches[0];
  var t1 = touches[1];
  var centerX = (t0.clientX + t1.clientX) / 2;
  var centerY = (t0.clientY + t1.clientY) / 2;
  var center = this._clientToCanvasPx(centerX, centerY);
  if (!center) return;
  var dx = t1.clientX - t0.clientX;
  var dy = t1.clientY - t0.clientY;
  var dist = Math.sqrt(dx * dx + dy * dy);
  var scaleFactor = (dist > 0.000001 ? dist : 1) / this._touchGesture.startDistance;
  var nextScale = this._clampViewScale(this._touchGesture.startScale * scaleFactor);
  this._viewScale = nextScale;
  this._viewPanPx.x = center.x - this._touchGesture.anchorWorldX * nextScale;
  this._viewPanPx.y = center.y - this._touchGesture.anchorWorldY * nextScale;
  this.render();
};

/**
 * Converts pixel coords to logical coords (cw units).
 */
Fretscape.prototype._pxToCw = function (px, py) {
  var local = this._clientToCanvasPx(px, py);
  if (!local) return { x: 0, y: 0 };
  var viewScale = this._viewScale || 1;
  var displayPxX = (local.x - this._viewPanPx.x) / viewScale;
  var displayPxY = (local.y - this._viewPanPx.y) / viewScale;
  var displayCwX = displayPxX / this.cellWidth;
  var displayCwY = displayPxY / this.cellWidth;
  return { x: this._displayXToWorldX(displayCwX), y: this._displayYToWorldY(displayCwY) };
};

/**
 * Returns brick index at (xCw, yCw), or -1 if none. Checks back-to-front.
 */
Fretscape.prototype._hitTest = function (xCw, yCw) {
  for (var i = this.bricks.length - 1; i >= 0; i--) {
    var item = this.bricks[i];
    if (xCw >= item.xCw && xCw < item.xCw + this.brickWidthCw &&
        yCw >= item.yCw && yCw < item.yCw + this.brickHeightCw) {
      return i;
    }
  }
  return -1;
};

/**
 * Returns dot hit info at (xCw, yCw), or null if not on a dot.
 */
Fretscape.prototype._hitDot = function (xCw, yCw) {
  var dotRadiusCw = 0.4; /* Keep in sync with Brick.render radius ratio. */
  var hitRadiusSq = dotRadiusCw * dotRadiusCw;
  for (var i = this.bricks.length - 1; i >= 0; i--) {
    var item = this.bricks[i];
    var data = item.brick && item.brick.cellData ? item.brick.cellData : [];
    for (var r = 0; r < data.length; r++) {
      for (var c = 0; c < data[r].length; c++) {
        var cx = item.xCw + c;
        var cy = item.yCw + r;
        var dx = xCw - cx;
        var dy = yCw - cy;
        if (dx * dx + dy * dy <= hitRadiusSq) {
          return { xCw: cx, yCw: cy, brickIndex: i, row: r, col: c };
        }
      }
    }
  }
  return null;
};

/**
 * Converts a dot world position into semitone-lattice coordinates from first brick "1".
 * Musical origin is first brick "1" at (0,0).
 * +x means one semitone to the left, +y means five semitones downward.
 * Right-handed mode flips x and vertical mirror flips y for note-frequency mapping.
 */
Fretscape.prototype._dotToDisplayCoord = function (dotX, dotY) {
  var origin = this._getOneCellCenter();
  /* Start from displayed axes so the first brick "1" is always the visible (0,0). */
  var originDisplayX = this._worldXToDisplayX(origin.x);
  var originDisplayY = this._worldYToDisplayY(origin.y);
  var dotDisplayX = this._worldXToDisplayX(dotX);
  var dotDisplayY = this._worldYToDisplayY(dotY);
  var x = originDisplayX - dotDisplayX; /* screen-left is positive before handedness flip */
  var y = dotDisplayY - originDisplayY; /* screen-down is positive before vertical flip */
  /* Historical naming: _isLeftHanded true is the mirrored/right-handed orientation. */
  if (this._isLeftHanded) {
    x = -x;
  }
  if (this._isVerticallyMirrored) {
    y = -y;
  }
  var snap = function (v) {
    var iv = Math.round(v);
    return Math.abs(v - iv) < 0.000001 ? iv : parseFloat(v.toFixed(3));
  };
  return { x: snap(x), y: snap(y) };
};

/**
 * Returns semitone index of selected key relative to low E (E2).
 */
Fretscape.prototype._getKeySemitoneFromLowE = function () {
  var key = this._musicalKey || "C";
  var map = {
    "E": 0,
    "F": 1,
    "F#": 2,
    "G": 3,
    "G#": 4,
    "A": 5,
    "A#": 6,
    "B": 7,
    "C": 8,
    "C#": 9,
    "D": 10,
    "D#": 11
  };
  return map.hasOwnProperty(key) ? map[key] : map.C;
};

/**
 * Returns a cached harmonic waveform with a guitar-like timbre.
 */
Fretscape.prototype._getGuitarPeriodicWave = function (ctx) {
  if (!ctx) return null;
  if (this._guitarWave) return this._guitarWave;
  var real = new Float32Array([0, 1, 0.65, 0.38, 0.25, 0.16, 0.1, 0.06, 0.03]);
  var imag = new Float32Array(real.length);
  this._guitarWave = ctx.createPeriodicWave(real, imag);
  return this._guitarWave;
};

/**
 * Lazily initializes and returns the Web Audio context.
 */
Fretscape.prototype._getAudioContext = function () {
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
 * Returns cached white-noise buffer for slap/percussive strum sounds.
 */
Fretscape.prototype._getSlapNoiseBuffer = function (ctx) {
  if (!ctx) return null;
  if (this._slapNoiseBuffer) return this._slapNoiseBuffer;
  var length = Math.max(1, Math.floor(ctx.sampleRate * 0.2));
  var buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  var channel = buffer.getChannelData(0);
  for (var i = 0; i < length; i++) {
    channel[i] = Math.random() * 2 - 1;
  }
  this._slapNoiseBuffer = buffer;
  return this._slapNoiseBuffer;
};

/**
 * Plays a short percussive slap used by strum symbol "s".
 */
Fretscape.prototype._playSlapTone = function (options) {
  var opts = options || {};
  var ctx = this._getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended" && ctx.resume) {
    ctx.resume();
  }
  var buffer = this._getSlapNoiseBuffer(ctx);
  if (!buffer) return;
  var delaySec = (typeof opts.delaySec === "number") ? Math.max(0, opts.delaySec) : 0;
  var now = ctx.currentTime + delaySec;
  var src = ctx.createBufferSource();
  var highpass = ctx.createBiquadFilter();
  var lowpass = ctx.createBiquadFilter();
  var gain = ctx.createGain();
  src.buffer = buffer;
  highpass.type = "highpass";
  highpass.frequency.setValueAtTime(700, now);
  lowpass.type = "lowpass";
  lowpass.frequency.setValueAtTime(4200, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.3, now + 0.0015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  src.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(gain);
  gain.connect(ctx.destination);
  src.start(now);
  src.stop(now + 0.1);
};

/**
 * Plays a plucked tone from semitone offset where left=+1 and down=+5 from (0,0).
 */
Fretscape.prototype._playDotTone = function (dotX, dotY, options) {
  var opts = options || {};
  var coord = this._dotToDisplayCoord(dotX, dotY);
  var semitoneOffset = coord.x + 5 * coord.y;
  var rootFromLowE = this._getKeySemitoneFromLowE();
  var semitoneFromLowE = rootFromLowE + semitoneOffset;
  var lowEFrequencyHz = 82.4068892282175; /* E2, standard guitar low E. */
  var frequency = lowEFrequencyHz * Math.pow(2, semitoneFromLowE / 12);
  frequency = Math.max(20, Math.min(20000, frequency));
  var ctx = this._getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended" && ctx.resume) {
    ctx.resume();
  }
  var delaySec = (typeof opts.delaySec === "number") ? Math.max(0, opts.delaySec) : 0;
  var durationSec = (typeof opts.durationSec === "number") ? Math.max(0.12, opts.durationSec) : 0.7;
  var useSustainHold = !!opts.sustainHold;
  var now = ctx.currentTime + delaySec;
  var osc = ctx.createOscillator();
  var wave = this._getGuitarPeriodicWave(ctx);
  var toneFilter = ctx.createBiquadFilter();
  var bodyFilter = ctx.createBiquadFilter();
  var gain = ctx.createGain();
  if (wave && osc.setPeriodicWave) {
    osc.setPeriodicWave(wave);
  } else {
    osc.type = "triangle";
  }
  osc.frequency.setValueAtTime(frequency * 1.006, now);
  osc.frequency.exponentialRampToValueAtTime(frequency, now + 0.03);
  toneFilter.type = "lowpass";
  toneFilter.frequency.setValueAtTime(2600, now);
  toneFilter.frequency.exponentialRampToValueAtTime(1200, now + Math.min(0.3, durationSec));
  toneFilter.Q.value = 1.2;
  bodyFilter.type = "peaking";
  bodyFilter.frequency.value = 190;
  bodyFilter.Q.value = 0.9;
  bodyFilter.gain.value = 4;
  var sustainGain = useSustainHold ? 0.11 : 0.075;
  var decayEnd = now + Math.min(0.08, durationSec * 0.35);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(sustainGain, decayEnd);
  if (useSustainHold && durationSec > 0.14) {
    /* Hold strum energy until near release so notes ring to the next strum boundary. */
    var releaseStart = now + Math.max(0.08, durationSec - 0.06);
    if (releaseStart < decayEnd) releaseStart = decayEnd;
    gain.gain.setValueAtTime(sustainGain, releaseStart);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
  } else {
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
  }
  osc.connect(toneFilter);
  toneFilter.connect(bodyFilter);
  bodyFilter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationSec + 0.06);
};

/**
 * Gets event coords in viewport pixels. Works for mouse and touch.
 */
Fretscape.prototype._getEventCoords = function (e) {
  if (e.touches && e.touches.length) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  if (e.changedTouches && e.changedTouches.length) {
    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
};

/** Hold duration required before drag-copy starts. */
var DRAG_HOLD_DELAY_MS = 1000;
/** Max pointer drift while holding before drag-copy is cancelled (in cw units). */
var DRAG_HOLD_MOVE_TOLERANCE_CW = 0.35;

/**
 * Binds mouse and touch handlers for drag.
 */
Fretscape.prototype._bindInput = function () {
  var self = this;
  var cancelPendingDragCopy = function () {
    if (!self._pendingDragCopy) return;
    if (self._pendingDragCopy.timerId !== null && self._pendingDragCopy.timerId !== undefined) {
      window.clearTimeout(self._pendingDragCopy.timerId);
    }
    self._pendingDragCopy = null;
  };
  var startDragCopyFromIndex = function (idx, pointerCw, pointerClient) {
    if (idx < 0 || idx >= self.bricks.length) return;
    var item = self.bricks[idx];
    if (!item || !item.brick) return;
    var off = self._getBrickOriginOffset(item.brick);
    var originX = item.xCw + off.col;
    var originY = item.yCw + off.row;
    self._dragItem = {
      brick: item.brick.clone(),
      xCw: item.xCw,
      yCw: item.yCw,
      originCol: off.col,
      originRow: off.row
    };
    self._isCreating = true;
    self.bricks.push(self._dragItem);
    self._offsetCw = { x: pointerCw.x - originX, y: pointerCw.y - originY };
    var snappedOrigin = self._snapToLattice(originX, originY, off);
    self._dragItem.xCw = snappedOrigin.x - off.col;
    self._dragItem.yCw = snappedOrigin.y - off.row;
    self._dragStartOrigin = { x: snappedOrigin.x, y: snappedOrigin.y };
    self._doMove(pointerClient.x, pointerClient.y);
  };
  var queueDragCopyHold = function (idx, cw, client) {
    cancelPendingDragCopy();
    var pending = {
      idx: idx,
      startCwX: cw.x,
      startCwY: cw.y,
      lastCwX: cw.x,
      lastCwY: cw.y,
      lastClientX: client.x,
      lastClientY: client.y,
      timerId: null
    };
    pending.timerId = window.setTimeout(function () {
      if (self._pendingDragCopy !== pending) return;
      pending.timerId = null;
      self._pendingDragCopy = null;
      startDragCopyFromIndex(
        pending.idx,
        { x: pending.lastCwX, y: pending.lastCwY },
        { x: pending.lastClientX, y: pending.lastClientY }
      );
    }, DRAG_HOLD_DELAY_MS);
    self._pendingDragCopy = pending;
  };
  var finishDrag = function () {
    if (!self._dragItem) return false;
    var off = { col: self._dragItem.originCol, row: self._dragItem.originRow };
    var originX = self._dragItem.xCw + off.col;
    var originY = self._dragItem.yCw + off.row;
    var snappedOrigin = self._snapToLattice(originX, originY, off);
    self._dragItem.xCw = snappedOrigin.x - off.col;
    self._dragItem.yCw = snappedOrigin.y - off.row;
    self._dragItem = null;
    self._isCreating = false;
    self._dragStartOrigin = null;
    self.render();
    return true;
  };
  var start = function (e) {
    var isTouch = e.type.indexOf("touch") === 0;
    if (!self.cellWidth) return;
    if (!isTouch && e.button === 1) {
      cancelPendingDragCopy();
      self._isMousePanning = true;
      self._panLastClient = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      return;
    }
    if (isTouch && e.touches && e.touches.length >= 2) {
      cancelPendingDragCopy();
      if (self._dragItem) {
        finishDrag();
      }
      self._beginTouchGesture(e.touches);
      e.preventDefault();
      return;
    }
    if (!isTouch && e.button !== 0) return;
    if (isTouch && e.touches && e.touches.length !== 1) return;
    var coords = self._getEventCoords(e);
    var cw = self._pxToCw(coords.x, coords.y);
    var dotHit = self._hitDot(cw.x, cw.y);
    if (dotHit) {
      self._playDotTone(dotHit.xCw, dotHit.yCw);
      queueDragCopyHold(dotHit.brickIndex, cw, coords);
      e.preventDefault();
      return;
    }
    var idx = self._hitTest(cw.x, cw.y);
    if (idx < 0) {
      cancelPendingDragCopy();
      return;
    }
    queueDragCopyHold(idx, cw, coords);
    e.preventDefault();
  };
  var move = function (e) {
    var isTouch = e.type.indexOf("touch") === 0;
    if (!isTouch && self._isMousePanning && self._panLastClient) {
      var localNow = self._clientToCanvasPx(e.clientX, e.clientY);
      var localLast = self._clientToCanvasPx(self._panLastClient.x, self._panLastClient.y);
      if (localNow && localLast) {
        self._viewPanPx.x += localNow.x - localLast.x;
        self._viewPanPx.y += localNow.y - localLast.y;
        self._panLastClient = { x: e.clientX, y: e.clientY };
        self.render();
      }
      e.preventDefault();
      return;
    }
    if (isTouch && self._touchGesture) {
      if (e.touches && e.touches.length >= 2) {
        self._updateTouchGesture(e.touches);
        e.preventDefault();
        return;
      }
      self._touchGesture = null;
    }
    if (self._pendingDragCopy) {
      if (!isTouch && e.buttons === 0) {
        cancelPendingDragCopy();
        return;
      }
      var holdCoords = self._getEventCoords(e);
      var holdCw = self._pxToCw(holdCoords.x, holdCoords.y);
      self._pendingDragCopy.lastClientX = holdCoords.x;
      self._pendingDragCopy.lastClientY = holdCoords.y;
      self._pendingDragCopy.lastCwX = holdCw.x;
      self._pendingDragCopy.lastCwY = holdCw.y;
      var dx = holdCw.x - self._pendingDragCopy.startCwX;
      var dy = holdCw.y - self._pendingDragCopy.startCwY;
      if (dx * dx + dy * dy > DRAG_HOLD_MOVE_TOLERANCE_CW * DRAG_HOLD_MOVE_TOLERANCE_CW) {
        cancelPendingDragCopy();
      }
      e.preventDefault();
      return;
    }
    if (!self._dragItem) return;
    self._doMove(self._getEventCoords(e).x, self._getEventCoords(e).y);
    e.preventDefault();
  };
  var end = function (e) {
    var isTouch = e.type.indexOf("touch") === 0;
    if (!isTouch && self._isMousePanning) {
      self._isMousePanning = false;
      self._panLastClient = null;
      e.preventDefault();
      return;
    }
    if (isTouch && self._touchGesture) {
      if (!e.touches || e.touches.length < 2) {
        self._touchGesture = null;
      } else {
        self._beginTouchGesture(e.touches);
      }
      e.preventDefault();
      return;
    }
    if (self._pendingDragCopy) {
      cancelPendingDragCopy();
      e.preventDefault();
      return;
    }
    if (finishDrag()) {
      e.preventDefault();
    }
  };
  var wheel = function (e) {
    /* Negative deltaY zooms in; positive zooms out. */
    var factor = Math.exp(-e.deltaY * 0.0015);
    self._zoomAtClientPoint(factor, e.clientX, e.clientY);
    e.preventDefault();
  };
  this.canvas.addEventListener("mousedown", start);
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", end);
  this.canvas.addEventListener("touchstart", start, { passive: false });
  window.addEventListener("touchmove", move, { passive: false });
  window.addEventListener("touchend", end, { passive: false });
  window.addEventListener("touchcancel", end, { passive: false });
  this.canvas.addEventListener("wheel", wheel, { passive: false });
};

/**
 * Converts global (xCw, yCw) to lattice coords (a, b) where point = o + a*(2,-2) + b*(5,1).
 */
Fretscape.prototype._globalToLattice = function (xCw, yCw) {
  var o = this._getOneCellCenter();
  var a = (xCw - o.x - 5 * (yCw - o.y)) / 12;
  var b = (xCw - o.x + (yCw - o.y)) / 6;
  return { a: a, b: b };
};

/**
 * Converts lattice (a, b) to global (xCw, yCw).
 */
Fretscape.prototype._latticeToGlobal = function (a, b) {
  var o = this._getOneCellCenter();
  return {
    x: o.x + 2 * a + 5 * b,
    y: o.y - 2 * a + b
  };
};

/**
 * Snaps (originX, originY) to nearest lattice point. originOffset is brick's "1" cell offset; in-bounds uses brick top-left.
 */
Fretscape.prototype._snapToLattice = function (originX, originY, originOffset) {
  var lab = this._globalToLattice(originX, originY);
  var i0 = Math.round(lab.a);
  var j0 = Math.round(lab.b);
  var maxX = Math.floor(this.widthCw - this.brickWidthCw);
  var maxY = Math.floor(this.heightCw - this.brickHeightCw);
  var inBounds = function (originPos) {
    var tlX = originPos.x - originOffset.col;
    var tlY = originPos.y - originOffset.row;
    return tlX >= 0 && tlX <= maxX && tlY >= 0 && tlY <= maxY;
  };
  var best = this._latticeToGlobal(i0, j0);
  if (inBounds(best)) return best;
  var bestD = 1e9;
  var r = 0;
  var di, dj, pos, d;
  while (r < 20) {
    for (di = -r; di <= r; di++) {
      for (dj = -r; dj <= r; dj++) {
        if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
        pos = this._latticeToGlobal(i0 + di, j0 + dj);
        if (inBounds(pos)) {
          d = (pos.x - originX) * (pos.x - originX) + (pos.y - originY) * (pos.y - originY);
          if (d < bestD) {
            bestD = d;
            best = pos;
          }
        }
      }
    }
    if (bestD < 1e9) return best;
    r++;
  }
  return best;
};

/** Snap to intersection when within this many cw of nearest lattice point on active drag line. */
var DRAG_SNAP_RADIUS_CW = 0.5;

/**
 * Updates drag item position. Constrains to active slope line through drag start origin.
 * Smooth motion along the line; snaps to intersection when within DRAG_SNAP_RADIUS_CW.
 */
Fretscape.prototype._doMove = function (clientX, clientY) {
  if (!this._dragItem || !this._dragStartOrigin) return;
  var cw = this._pxToCw(clientX, clientY);
  var desiredX = cw.x - this._offsetCw.x;
  var desiredY = cw.y - this._offsetCw.y;
  var sx = this._dragStartOrigin.x;
  var sy = this._dragStartOrigin.y;
  var constraint = this._dragConstraintVector || { x: 2, y: -2 };
  var vx = constraint.x;
  var vy = constraint.y;
  var vLenSq = vx * vx + vy * vy;
  if (vLenSq === 0) return;
  /* Project desired onto line: start + t*v, where v is active constraint vector. */
  var t = ((desiredX - sx) * vx + (desiredY - sy) * vy) / vLenSq;
  var ox = sx + t * vx;
  var oy = sy + t * vy;
  /* Snap to nearest intersection when within 1/2 cw. Lattice points on the line are at start + k*v. */
  var stepLen = Math.sqrt(vLenSq);
  var distToNearest = Math.abs(t - Math.round(t)) * stepLen;
  if (distToNearest <= DRAG_SNAP_RADIUS_CW) {
    var k = Math.round(t);
    ox = sx + k * vx;
    oy = sy + k * vy;
  }
  this._dragItem.xCw = ox - this._dragItem.originCol;
  this._dragItem.yCw = oy - this._dragItem.originRow;
  this.render();
};

/**
 * Returns (col, row) of the brick's "1" cell (brick origin).
 */
Fretscape.prototype._getBrickOriginOffset = function (brick) {
  for (var r = 0; r < brick.cellData.length; r++) {
    for (var c = 0; c < brick.cellData[r].length; c++) {
      if (brick.cellData[r][c] === "1") {
        return { col: c, row: r };
      }
    }
  }
  return { col: 2, row: 1 };
};

/**
 * Returns (xCw, yCw) of the first brick's "1" cell center (grid origin).
 */
Fretscape.prototype._getOneCellCenter = function () {
  if (!this.bricks.length) {
    return { x: this._defaultOneCellCenterCw.x, y: this._defaultOneCellCenterCw.y };
  }
  var item = this.bricks[0];
  var brick = item.brick;
  var off = this._getBrickOriginOffset(brick);
  return { x: item.xCw + off.col, y: item.yCw + off.row };
};

/**
 * Draws grid lines so intersections are at global lattice points o + i*(2,-2) + j*(5,1).
 * Family 1 (2x-2, slope -1): through (ox + 5*j, oy + 1*j). Family 2 (5x1, slope 1/5): through (ox + 2*i, oy - 2*i).
 */
Fretscape.prototype._drawGrid = function () {
  var o = this._getOneCellCenter();
  var m1 = -1;
  var m2 = 1 / 5;
  var toPxX = this._xCwToPx.bind(this);
  var toPxY = this._yCwToPx.bind(this);
  var w = this.widthCw;
  var h = this.heightCw;

  this.ctx.strokeStyle = "#ccc";
  this.ctx.lineWidth = 1;

  var drawLine = function (m, c) {
    var pts = [];
    var yL = c;
    var yR = m * w + c;
    if (yL >= 0 && yL <= h) pts.push({ x: 0, y: yL });
    if (yR >= 0 && yR <= h) pts.push({ x: w, y: yR });
    var xB = m !== 0 ? -c / m : -1;
    var xT = m !== 0 ? (h - c) / m : -1;
    if (xB >= 0 && xB <= w) pts.push({ x: xB, y: 0 });
    if (xT >= 0 && xT <= w) pts.push({ x: xT, y: h });
    var p0 = null;
    var p1 = null;
    var bestD = 0;
    for (var i = 0; i < pts.length; i++) {
      for (var j = i + 1; j < pts.length; j++) {
        var d = (pts[j].x - pts[i].x) * (pts[j].x - pts[i].x) + (pts[j].y - pts[i].y) * (pts[j].y - pts[i].y);
        if (d > bestD && d > 0.0001) {
          bestD = d;
          p0 = pts[i];
          p1 = pts[j];
        }
      }
    }
    if (!p0 || !p1) return;
    this.ctx.beginPath();
    this.ctx.moveTo(toPxX(p0.x), toPxY(p0.y));
    this.ctx.lineTo(toPxX(p1.x), toPxY(p1.y));
    this.ctx.stroke();
  }.bind(this);

  var j = -10;
  while (j <= 10) {
    var px = o.x + 5 * j;
    var py = o.y + 1 * j;
    drawLine(m1, py - m1 * px);
    j++;
  }
  var i = -10;
  while (i <= 10) {
    var px = o.x + 2 * i;
    var py = o.y - 2 * i;
    drawLine(m2, py - m2 * px);
    i++;
  }
};

/**
 * Renders grid then bricks. All positioning scales by cellWidth.
 */
Fretscape.prototype.render = function () {
  this.cellWidth = this._fitCellWidth();
  var refBrick = this.bricks[0] ? this.bricks[0].brick : new Brick();
  refBrick.setCellWidth(this.cellWidth);
  for (var i = 0; i < this.bricks.length; i++) {
    this.bricks[i].brick.setCellWidth(this.cellWidth);
  }
  this.canvas.width = this._cwToPx(this.widthCw);
  this.canvas.height = this._cwToPx(this.heightCw);

  this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  this.ctx.setTransform(this._viewScale, 0, 0, this._viewScale, this._viewPanPx.x, this._viewPanPx.y);
  this._drawGrid();
  for (var i = 0; i < this.bricks.length; i++) {
    var item = this.bricks[i];
    var stepX = this._isLeftHanded ? -this.cellWidth : this.cellWidth;
    var stepY = this._isVerticallyMirrored ? -this.cellWidth : this.cellWidth;
    item.brick.render(this.ctx, this._xCwToPx(item.xCw), this._yCwToPx(item.yCw), stepX, stepY);
  }
  this._drawProgressionRootGuide();
  this._drawProgressionRootToFifthGuide();
  this._drawProgressionPulseIndicator();
  this.ctx.setTransform(1, 0, 0, 1, 0, 0);
};
