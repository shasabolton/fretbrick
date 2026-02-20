/**
 * Brick - Renders a 5x3 grid of circular cells. Circle centers at (c,r) * cellWidth.
 */
function Brick() {
  this.cellWidth = 80;
  this.cellData = [
    ["7", "b7", "6", "b6", "5"],
    ["3", "b3", "2", "b2", "1"],
    ["6", "b6", "5", "b5", "4"]
  ];
}

/**
 * Returns brick width in cellWidth units (cols).
 */
Brick.prototype.getWidthCw = function () {
  return this.cellData[0] ? this.cellData[0].length : 0;
};

/**
 * Returns brick height in cellWidth units (rows).
 */
Brick.prototype.getHeightCw = function () {
  return this.cellData.length;
};

/**
 * Returns a copy of this brick with same cellData.
 */
Brick.prototype.clone = function () {
  var b = new Brick();
  b.cellData = [];
  for (var r = 0; r < this.cellData.length; r++) {
    b.cellData[r] = this.cellData[r].slice();
  }
  return b;
};

/**
 * Sets cell width in pixels. Used when scaling to fit viewport.
 */
Brick.prototype.setCellWidth = function (w) {
  this.cellWidth = w;
};

/**
 * Renders the brick to canvas. (x,y) is brick origin in pixels.
 * xStepPx and yStepPx control draw direction/spacing (default +cellWidth).
 */
Brick.prototype.render = function (ctx, x, y, xStepPx, yStepPx) {
  var cols = this.cellData[0] ? this.cellData[0].length : 0;
  var rows = this.cellData.length;
  var midCol = Math.floor(cols / 2);
  var isBlackCol = function (c) { return c === 0 || c === midCol || c === cols - 1; };
  var stepX = (typeof xStepPx === "number") ? xStepPx : this.cellWidth;
  var stepY = (typeof yStepPx === "number") ? yStepPx : this.cellWidth;
  var radius = this.cellWidth * 0.4;
  var strokeW = this.cellWidth * 0.0125;
  var borderStrokeW = this.cellWidth * 0.025;
  var fontSize = this.cellWidth * 0.35;

  if (cols > 0 && rows > 0) {
    var borderOffset = this.cellWidth * 0.5;
    var firstCx = x;
    var lastCx = x + (cols - 1) * stepX;
    var firstCy = y;
    var lastCy = y + (rows - 1) * stepY;
    var left = Math.min(firstCx, lastCx) - borderOffset;
    var top = Math.min(firstCy, lastCy) - borderOffset;
    var width = Math.abs(lastCx - firstCx) + borderOffset * 2;
    var height = Math.abs(lastCy - firstCy) + borderOffset * 2;
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.strokeStyle = "#333";
    ctx.lineWidth = borderStrokeW;
    ctx.stroke();
  }

  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < this.cellData[r].length; c++) {
      var cx = x + c * stepX;
      var cy = y + r * stepY;
      var val = this.cellData[r][c];
      var fillColor = val === "1" ? "#c00" : (isBlackCol(c) ? "#000" : "#f5f5f5");
      var textColor = (val === "1" || isBlackCol(c)) ? "#fff" : "#333";

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = "#333";
      ctx.lineWidth = strokeW;
      ctx.stroke();

      ctx.fillStyle = textColor;
      ctx.font = "bold " + fontSize + "px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(val, cx, cy);
    }
  }
};
