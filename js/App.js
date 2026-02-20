/**
 * App - Bootstraps Fretscape with one brick centered, renders to #app.
 */
(function () {
  var canvasWrap = document.getElementById("canvas-wrap");
  var keySelect = document.getElementById("key-select");
  var handednessToggle = document.getElementById("handedness-toggle");
  var verticalMirrorToggle = document.getElementById("vertical-mirror-toggle");
  var dragConstraintToggle = document.getElementById("drag-constraint-5x1");
  var fretscape = new Fretscape(canvasWrap);
  var isHorizontallyMirrored = false;
  var isVerticallyMirrored = false;
  if (keySelect) {
    fretscape.setKey(keySelect.value || "A");
    keySelect.addEventListener("change", function () {
      fretscape.setKey(keySelect.value || "A");
    });
  } else {
    fretscape.setKey("A");
  }
  if (handednessToggle) {
    var syncHandednessButton = function () {
      handednessToggle.textContent = isHorizontallyMirrored ? "Right hand" : "Left hand";
      handednessToggle.setAttribute("aria-pressed", isHorizontallyMirrored ? "true" : "false");
    };
    syncHandednessButton();
    handednessToggle.addEventListener("click", function () {
      isHorizontallyMirrored = !isHorizontallyMirrored;
      fretscape.setLeftHanded(isHorizontallyMirrored);
      syncHandednessButton();
    });
  }
  if (verticalMirrorToggle) {
    fretscape.setVerticalMirrored(!!verticalMirrorToggle.checked);
    verticalMirrorToggle.addEventListener("change", function () {
      isVerticallyMirrored = !!verticalMirrorToggle.checked;
      fretscape.setVerticalMirrored(isVerticallyMirrored);
    });
  } else {
    fretscape.setVerticalMirrored(false);
  }
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
