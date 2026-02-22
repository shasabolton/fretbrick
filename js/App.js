/**
 * App - Bootstraps Fretscape with one brick centered, renders to #app.
 */
(function () {
  var canvasWrap = document.getElementById("canvas-wrap");
  var keySelect = document.getElementById("key-select");
  var progressionSelect = document.getElementById("progression-select");
  var progressionPlayToggle = document.getElementById("progression-play-toggle");
  var handednessToggle = document.getElementById("handedness-toggle");
  var verticalMirrorToggle = document.getElementById("vertical-mirror-toggle");
  var dragConstraintToggle = document.getElementById("drag-constraint-5x1");
  var fretscape = new Fretscape(canvasWrap);
  var chordProgressions = [];
  var isHorizontallyMirrored = false;
  var isVerticallyMirrored = false;
  /**
   * Updates the progression dropdown with loaded data.
   */
  var populateProgressionSelect = function (progressions) {
    if (!progressionSelect) return;
    while (progressionSelect.firstChild) {
      progressionSelect.removeChild(progressionSelect.firstChild);
    }
    var defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Single brick location map";
    progressionSelect.appendChild(defaultOption);
    for (var i = 0; i < progressions.length; i++) {
      var progression = progressions[i];
      if (!progression || typeof progression.id !== "string" || typeof progression.name !== "string") continue;
      var option = document.createElement("option");
      option.value = progression.id;
      option.textContent = progression.name;
      progressionSelect.appendChild(option);
    }
  };
  /**
   * Returns a progression object by id from loaded progression data.
   */
  var getProgressionById = function (id) {
    for (var i = 0; i < chordProgressions.length; i++) {
      if (chordProgressions[i].id === id) return chordProgressions[i];
    }
    return null;
  };
  /**
   * Applies currently selected progression; empty selection resets to single brick.
   */
  var applySelectedProgression = function () {
    fretscape.stopProgressionPlayback();
    if (!progressionSelect) {
      fretscape.applyChordProgression(null);
      syncProgressionPlayButton();
      return;
    }
    fretscape.applyChordProgression(getProgressionById(progressionSelect.value));
    syncProgressionPlayButton();
  };
  /**
   * Keeps the progression play button label/state in sync with playback and selection.
   */
  var syncProgressionPlayButton = function () {
    if (!progressionPlayToggle) return;
    var isPlaying = fretscape.isProgressionPlaybackActive();
    var hasPath = fretscape.hasProgressionPath();
    progressionPlayToggle.textContent = isPlaying ? "Stop" : "Play";
    progressionPlayToggle.setAttribute("aria-pressed", isPlaying ? "true" : "false");
    progressionPlayToggle.disabled = !hasPath;
  };
  /**
   * Loads chord progression JSON from static data folder.
   */
  var loadChordProgressions = function () {
    if (typeof fetch !== "function") return Promise.resolve([]);
    return fetch(encodeURI("data/chord progressions.JSON"))
      .then(function (response) {
        if (!response.ok) throw new Error("Failed to load progression data");
        return response.json();
      })
      .then(function (payload) {
        if (!payload || !payload.progressions || !payload.progressions.length) return [];
        return payload.progressions;
      })
      .catch(function (error) {
        console.warn("Chord progression data unavailable.", error);
        return [];
      });
  };
  if (keySelect) {
    fretscape.setKey(keySelect.value || "C");
    keySelect.addEventListener("change", function () {
      fretscape.setKey(keySelect.value || "C");
    });
  } else {
    fretscape.setKey("C");
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
  fretscape.applyChordProgression(null);
  fretscape.onProgressionPlaybackStateChange = syncProgressionPlayButton;
  if (progressionPlayToggle) {
    progressionPlayToggle.addEventListener("click", function () {
      if (fretscape.isProgressionPlaybackActive()) {
        fretscape.stopProgressionPlayback();
      } else {
        fretscape.startProgressionPlayback();
      }
      syncProgressionPlayButton();
    });
  }
  if (progressionSelect) {
    progressionSelect.addEventListener("change", applySelectedProgression);
    loadChordProgressions().then(function (progressions) {
      chordProgressions = progressions;
      populateProgressionSelect(chordProgressions);
      if (chordProgressions.length) {
        progressionSelect.value = chordProgressions[0].id;
      }
      applySelectedProgression();
    });
  }
  syncProgressionPlayButton();
})();
