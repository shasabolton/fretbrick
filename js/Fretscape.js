/**
 * Fretscape - Owns a canvas and draws bricks to it. All coordinates in cellWidth units.
 * Canvas = 25 cells wide, 15 cells tall. Bricks get cellWidth from Fretscape.
 * Click-drag inside brick creates new brick; drag on brick moves it.
 * Supports wheel/pinch zoom, panning, and optional axis mirroring.
 */
function Fretscape(containerEl) {
  this.container = containerEl;
  this.bricks = [];
  this._musicalKey = "A";
  this._isLeftHanded = false;
  this._isVerticallyMirrored = false;
  this.cellWidth = 80;
  this.widthCw = 25;
  this.heightCw = 15;
  this.brickWidthCw = 5;
  this.brickHeightCw = 3;
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
 * Converts a dot world position into displayed coordinate tuple relative to first brick "1" origin.
 * Origin is (0,0). In left-hand/no-vertical-flip mode, right/up trend negative.
 */
Fretscape.prototype._dotToDisplayCoord = function (dotX, dotY) {
  var origin = this._getOneCellCenter();
  var x = origin.x - dotX;
  var y = dotY - origin.y;
  var snap = function (v) {
    var iv = Math.round(v);
    return Math.abs(v - iv) < 0.000001 ? iv : parseFloat(v.toFixed(3));
  };
  return { x: snap(x), y: snap(y) };
};

/**
 * Returns semitone index of selected key relative to A.
 */
Fretscape.prototype._getKeySemitoneFromA = function () {
  var key = this._musicalKey || "A";
  var map = {
    "A": 0,
    "A#": 1,
    "B": 2,
    "C": 3,
    "C#": 4,
    "D": 5,
    "D#": 6,
    "E": 7,
    "F": 8,
    "F#": 9,
    "G": 10,
    "G#": 11
  };
  return map.hasOwnProperty(key) ? map[key] : 0;
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
 * Plays a 200ms tone using semitone offset (x + 5*y) from selected key root.
 */
Fretscape.prototype._playDotTone = function (dotX, dotY) {
  var coord = this._dotToDisplayCoord(dotX, dotY);
  var semitoneOffset = coord.x + 5 * coord.y;
  var rootFromA = this._getKeySemitoneFromA();
  var semitoneFromA4 = rootFromA + semitoneOffset;
  var frequency = 440 * Math.pow(2, semitoneFromA4 / 12);
  frequency = Math.max(20, Math.min(20000, frequency));
  var ctx = this._getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended" && ctx.resume) {
    ctx.resume();
  }
  var now = ctx.currentTime;
  var osc = ctx.createOscillator();
  var gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.205);
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
    var idx = self._hitTest(cw.x, cw.y);
    if (idx < 0) {
      cancelPendingDragCopy();
      return;
    }
    var dotHit = self._hitDot(cw.x, cw.y);
    if (dotHit) {
      self._playDotTone(dotHit.xCw, dotHit.yCw);
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
  if (!this.bricks.length) return { x: this.widthCw / 2, y: this.heightCw / 2 };
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
  this.ctx.setTransform(1, 0, 0, 1, 0, 0);
};
