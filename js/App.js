/**
 * App - Bootstraps Fretscape with one brick centered, renders to #app.
 */
(function () {
  var canvasWrap = document.getElementById("canvas-wrap");
  var keySelect = document.getElementById("key-select");
  var progressionSelect = document.getElementById("progression-select");
  var playbackModeSelect = document.getElementById("playback-mode-select");
  var strumPatternSelect = document.getElementById("strum-pattern-select");
  var drumPatternSelect = document.getElementById("drum-pattern-select");
  var riffSelect = document.getElementById("riff-select");
  var bpmSlider = document.getElementById("bpm-slider");
  var bpmReadout = document.getElementById("bpm-readout");
  var progressionPlayToggle = document.getElementById("progression-play-toggle");
  var handednessToggle = document.getElementById("handedness-toggle");
  var verticalMirrorToggle = document.getElementById("vertical-mirror-toggle");
  var dragConstraintToggle = document.getElementById("drag-constraint-5x1");
  var fretscape = new Fretscape(canvasWrap);
  var drumEngine = new DrumEngine();
  var chordProgressions = [];
  var strumPatterns = [];
  var riffs = [];
  var isHorizontallyMirrored = false;
  var isVerticallyMirrored = false;
  fretscape.setDrumEngine(drumEngine);
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
   * Returns a strum pattern object by id from loaded strum data.
   */
  var getStrumPatternById = function (id) {
    for (var i = 0; i < strumPatterns.length; i++) {
      if (strumPatterns[i].id === id) return strumPatterns[i];
    }
    return null;
  };
  /**
   * Returns a riff object by id from loaded riff data.
   */
  var getRiffById = function (id) {
    for (var i = 0; i < riffs.length; i++) {
      if (riffs[i].id === id) return riffs[i];
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
   * Updates strum dropdown with loaded strum pattern data.
   */
  var populateStrumPatternSelect = function (patterns) {
    if (!strumPatternSelect) return;
    while (strumPatternSelect.firstChild) {
      strumPatternSelect.removeChild(strumPatternSelect.firstChild);
    }
    var noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "No strum";
    strumPatternSelect.appendChild(noneOption);
    for (var i = 0; i < patterns.length; i++) {
      var pattern = patterns[i];
      if (!pattern || typeof pattern.id !== "string" || typeof pattern.name !== "string") continue;
      var option = document.createElement("option");
      option.value = pattern.id;
      option.textContent = pattern.name;
      strumPatternSelect.appendChild(option);
    }
  };
  /**
   * Applies selected strum pattern to progression playback engine.
   */
  var applySelectedStrumPattern = function () {
    if (!strumPatternSelect) {
      fretscape.setStrumPattern(null);
      return;
    }
    fretscape.setStrumPattern(getStrumPatternById(strumPatternSelect.value));
  };
  /**
   * Updates riffs dropdown with loaded data.
   */
  var populateRiffSelect = function (riffList) {
    if (!riffSelect) return;
    while (riffSelect.firstChild) {
      riffSelect.removeChild(riffSelect.firstChild);
    }
    var noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "No riff";
    riffSelect.appendChild(noneOption);
    for (var i = 0; i < riffList.length; i++) {
      var riff = riffList[i];
      if (!riff || typeof riff.id !== "string" || typeof riff.name !== "string") continue;
      var option = document.createElement("option");
      option.value = riff.id;
      option.textContent = riff.name;
      riffSelect.appendChild(option);
    }
  };
  /**
   * Applies currently selected riff to fretspace playback.
   */
  var applySelectedRiff = function () {
    if (!riffSelect) {
      fretscape.setRiffPattern(null);
      return;
    }
    fretscape.setRiffPattern(getRiffById(riffSelect.value));
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
   * Applies BPM slider value to Fretscape and updates the text readout.
   */
  var applyBpmFromSlider = function () {
    var bpm = bpmSlider ? parseInt(bpmSlider.value, 10) : 100;
    if (!bpm || bpm < 60) bpm = 60;
    if (bpm > 200) bpm = 200;
    fretscape.setProgressionBpm(bpm);
    if (bpmReadout) {
      bpmReadout.textContent = bpm + " BPM";
    }
  };
  /**
   * Updates drum dropdown with patterns loaded from drumbeats JSON.
   */
  var populateDrumPatternSelect = function () {
    if (!drumPatternSelect) return;
    var patterns = drumEngine.getPatterns();
    while (drumPatternSelect.firstChild) {
      drumPatternSelect.removeChild(drumPatternSelect.firstChild);
    }
    var noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "No drums";
    drumPatternSelect.appendChild(noneOption);
    for (var i = 0; i < patterns.length; i++) {
      var option = document.createElement("option");
      option.value = patterns[i].id;
      option.textContent = patterns[i].name;
      drumPatternSelect.appendChild(option);
    }
  };
  /**
   * Applies selected drum pattern to DrumEngine.
   */
  var applySelectedDrumPattern = function () {
    if (!drumPatternSelect) {
      drumEngine.setSelectedPattern("");
      return;
    }
    drumEngine.setSelectedPattern(drumPatternSelect.value || "");
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
  /**
   * Loads drumbeat dataset from data folder.
   */
  var loadDrumbeats = function () {
    if (typeof fetch !== "function") return Promise.resolve({ key: {}, patterns: [] });
    return fetch(encodeURI("data/drumbeats.JSON"))
      .then(function (response) {
        if (!response.ok) throw new Error("Failed to load drumbeat data");
        return response.json();
      })
      .then(function (payload) {
        if (!payload || !payload.drumbeats) return { key: {}, patterns: [] };
        return payload.drumbeats;
      })
      .catch(function (error) {
        console.warn("Drumbeat data unavailable.", error);
        return { key: {}, patterns: [] };
      });
  };
  /**
   * Loads strum pattern dataset from data folder.
   */
  var loadStrums = function () {
    if (typeof fetch !== "function") return Promise.resolve([]);
    return fetch(encodeURI("data/strums.JSON"))
      .then(function (response) {
        if (!response.ok) throw new Error("Failed to load strum data");
        return response.json();
      })
      .then(function (payload) {
        if (!payload || !payload.strums || !payload.strums.patterns || !payload.strums.patterns.length) return [];
        return payload.strums.patterns;
      })
      .catch(function (error) {
        console.warn("Strum data unavailable.", error);
        return [];
      });
  };
  /**
   * Loads riff dataset from data folder.
   */
  var loadRiffs = function () {
    if (typeof fetch !== "function") return Promise.resolve([]);
    return fetch(encodeURI("data/riffs.JSON"))
      .then(function (response) {
        if (!response.ok) throw new Error("Failed to load riff data");
        return response.json();
      })
      .then(function (payload) {
        if (!payload || !payload.riffs || !payload.riffs.length) return [];
        return payload.riffs;
      })
      .catch(function (error) {
        console.warn("Riff data unavailable.", error);
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
  if (playbackModeSelect) {
    fretscape.setProgressionPlaybackMode(playbackModeSelect.value || "root");
    playbackModeSelect.addEventListener("change", function () {
      fretscape.setProgressionPlaybackMode(playbackModeSelect.value || "root");
      syncProgressionPlayButton();
    });
  } else {
    fretscape.setProgressionPlaybackMode("root");
  }
  if (strumPatternSelect) {
    strumPatternSelect.addEventListener("change", function () {
      applySelectedStrumPattern();
      syncProgressionPlayButton();
    });
    loadStrums().then(function (patterns) {
      strumPatterns = patterns;
      populateStrumPatternSelect(strumPatterns);
      strumPatternSelect.value = "";
      applySelectedStrumPattern();
    });
  } else {
    fretscape.setStrumPattern(null);
  }
  if (bpmSlider) {
    bpmSlider.addEventListener("input", applyBpmFromSlider);
    applyBpmFromSlider();
  } else {
    fretscape.setProgressionBpm(100);
    if (bpmReadout) {
      bpmReadout.textContent = "100 BPM";
    }
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
  if (drumPatternSelect) {
    drumPatternSelect.addEventListener("change", applySelectedDrumPattern);
    loadDrumbeats().then(function (drumbeats) {
      drumEngine.setDrumbeats(drumbeats);
      populateDrumPatternSelect();
      var patterns = drumEngine.getPatterns();
      drumPatternSelect.value = patterns.length ? patterns[0].id : "";
      applySelectedDrumPattern();
    });
  }
  if (riffSelect) {
    riffSelect.addEventListener("change", applySelectedRiff);
    loadRiffs().then(function (riffList) {
      riffs = riffList;
      populateRiffSelect(riffs);
      riffSelect.value = "";
      applySelectedRiff();
    });
  } else {
    fretscape.setRiffPattern(null);
  }
  syncProgressionPlayButton();
})();
