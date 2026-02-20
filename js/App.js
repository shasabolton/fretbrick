/**
 * App - Bootstraps Fretscape with one brick centered, renders to #app.
 */
(function () {
  var canvasWrap = document.getElementById("canvas-wrap");
  var dragConstraintToggle = document.getElementById("drag-constraint-5x1");
  var fretscape = new Fretscape(canvasWrap);
  if (dragConstraintToggle) {
    fretscape.setDragConstraintSlope(!!dragConstraintToggle.checked);
    dragConstraintToggle.addEventListener("change", function () {
      fretscape.setDragConstraintSlope(!!dragConstraintToggle.checked);
    });
  }
  var brick = new Brick();
  fretscape.addBrick(brick, 10, 6);
  fretscape.render();
})();
