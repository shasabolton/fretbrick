/**
 * App - Bootstraps Fretscape with one brick centered, renders to #app.
 */
(function () {
  var canvasWrap = document.getElementById("canvas-wrap");
  var fretscape = new Fretscape(canvasWrap);
  var brick = new Brick();
  fretscape.addBrick(brick, 10, 6);
  fretscape.render();
})();
