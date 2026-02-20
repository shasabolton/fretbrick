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
 * Renders the brick to canvas. (x,y) is brick origin in pixels. Circle at (c,r) drawn at (x + c*cw, y + r*cw).
 */
Brick.prototype.render = function (ctx, x, y) {
  var cols = this.cellData[0] ? this.cellData[0].length : 0;
  var rows = this.cellData.length;
  var midCol = Math.floor(cols / 2);
  var isBlackCol = function (c) { return c === 0 || c === midCol || c === cols - 1; };
  var radius = this.cellWidth * 0.4;
  var strokeW = this.cellWidth * 0.0125;
  var fontSize = this.cellWidth * 0.35;

  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < this.cellData[r].length; c++) {
      var cx = x + c * this.cellWidth;
      var cy = y + r * this.cellWidth;
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
