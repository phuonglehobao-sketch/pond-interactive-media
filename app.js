// p5 lifecycle and frame orchestration. Loaded after all feature modules.

let pondExperienceStarted = false;
let pondInteractionEnabled = false;
let pondCoverRemovalAt = Infinity;

// The density setup() would otherwise apply on a high/medium tier — computed
// once here (not inline in setup()) so the tier listener below can restore
// this exact value on an upgrade instead of guessing at it.
const NORMAL_PIXEL_DENSITY = Math.min(window.devicePixelRatio || 1, 2);

// Adaptive-performance hook: the lowest tier also drops canvas pixel density
// and target frame rate — the two levers with the widest compounding effect,
// since every other hotspot's cost scales with both. Every reachable
// animation in this sketch is deltaTime/millis-driven, not frame-count-driven,
// so the frameRate drop changes smoothness, not motion speed.
//
// pixelDensity is set to 0.75, not 1, on low — p5's density is an absolute
// backing-store multiplier, not a "cap retina scaling" toggle, so 1 only
// helps visitors on a >1 devicePixelRatio screen; on any ordinary
// (non-retina) display it was already 1 and did nothing. Going below 1
// shrinks the canvas's actual pixel buffer below its CSS size on every
// device, cutting fill-rate cost for every full-surface draw (the
// pond/moss/tree layers, the fish blur passes, ripples) by roughly half the
// pixel count, and the browser upscales the result with its own smoothing —
// no `image-rendering: pixelated` is set anywhere, so the softened look
// reads as part of the pond's watercolor style rather than as degraded
// rendering.
//
// Runs both ways (not just "entering low") because perf tier can now climb
// back up (see performance.js's PERF_RECOVERY) once frame time recovers —
// leaving the density/frame rate at low's settings after an upgrade would
// silently cap the visible benefit of the better tier's other levers.
onPerfTierChange((tier) => {
  if (tier === "low") {
    pixelDensity(0.75);
    frameRate(30);
  } else {
    pixelDensity(NORMAL_PIXEL_DENSITY);
    frameRate(60);
  }
  placementNeedsCacheRebuild = true;
});

// preload() blocks p5's setup() until every load below resolves, but that
// guarantee alone was invisible to the visitor — the cover's Start button
// was already present (just not yet listening) from the very first frame,
// so clicking it too early did nothing, and the very first real paint could
// still look soft while large SVGs finished rasterizing. Every load is
// wrapped with a success callback that ticks a shared counter, driving a
// visible progress bar; the Start button itself stays hidden until
// revealPondStart() runs at the very end of setup() (see below), by which
// point every asset is not just loaded but has already been drawn once into
// the warm-up caches in rebuildCaches().
let assetsLoadedCount = 0;
let assetsTotalCount = 0;

function onPreloadAssetLoaded() {
  assetsLoadedCount++;
  const fraction = assetsTotalCount > 0
    ? assetsLoadedCount / assetsTotalCount
    : 0;
  const percent = Math.round(fraction * 100);
  const fill = document.getElementById("pond-progress-fill");
  if (fill) fill.style.width = `${percent}%`;
  const bar = document.getElementById("pond-progress");
  if (bar) bar.setAttribute("aria-valuenow", String(percent));
}

function trackedImage(path) {
  assetsTotalCount++;
  return loadImage(path, onPreloadAssetLoaded);
}

function trackedFont(path) {
  assetsTotalCount++;
  return loadFont(path, onPreloadAssetLoaded);
}

function trackedJSON(path) {
  assetsTotalCount++;
  return loadJSON(path, onPreloadAssetLoaded);
}

function preload() {
  // The tree is separate from the pool so it can be positioned independently.
  pond = trackedImage("SVG/pool-healthy-v2.svg");
  pondUnhealthy = trackedImage("SVG/pool-unhealthy-v3.svg");
  pondDead = trackedImage("SVG/pool-dead-v2.svg");
  treeHealthyParts = TREE_PARTS.map((part) => trackedImage(part.healthyFile));
  treeUnhealthyParts = TREE_PARTS.map((part) => trackedImage(part.unhealthyFile));
  treeDeadParts = TREE_PARTS.map((part) => part.deadFile
    ? trackedImage(part.deadFile)
    : null);
  lilyPadVegetationArtwork = LILYPAD_VEGETATION_STATES.map((state) => {
    const artwork = {};
    for (const [name, part] of Object.entries(state)) {
      artwork[name] = part ? trackedImage(part.file) : null;
    }
    return artwork;
  });
  mossStateArtwork = MOSS_PARTS.map((part) => part.files.map((file) => (
    file ? trackedImage(file) : null
  )));
  fishStateArtwork = FISH_STATE_FILES.map((file) => trackedImage(file));
  individualLilyPadArtwork = LILYPAD_SCATTER_FILES.map((stateFiles) => (
    stateFiles.map((file) => file ? trackedImage(file) : null)
  ));
  grassArtwork = GRASS_PATCHES.map((patch) => patch.files.map((file) => (
    file ? trackedImage(file) : null
  )));
  foregroundGrassArtwork = FOREGROUND_GRASS_PARTS.map((part) => (
    part.files.map((file) => file ? trackedImage(file) : null)
  ));
  dialogueFont = trackedFont(
    "assets/Lilypad-healthy/Syne_Tactile/SyneTactile-Regular.ttf"
  );
  authoredPlacementLayout = trackedJSON("pond-layout.json");
}

function setup() {
  pixelDensity(NORMAL_PIXEL_DENSITY);
  createCanvas(windowWidth, windowHeight);
  drawingContext.imageSmoothingEnabled = true;
  drawingContext.imageSmoothingQuality = "high";
  frameRate(60);
  restoreSavedEcosystemHealth();
  // Registered here (not inside startPondExperience) so the true ecosystem
  // health is captured even if the visitor reloads while still on the
  // cover screen, before ever pressing Start — otherwise that reload's
  // health never gets saved, and the next visit falls back to whatever
  // older value was last recorded.
  window.addEventListener("pagehide", handleDialoguePageHide);
  requestAnimationFrame(() => {
    document.body.classList.add("pond-canvas-ready");
  });
  treePartVibration = TREE_PARTS.map(() => ({
    startedAt: -Infinity,
    strength: 0
  }));
  mossGlide.parts = MOSS_PARTS.map((part) => ({
    scale: 1, influence: 0, activatedAt: -Infinity,
    responseStrength: 1 + (mossVariation(part.seed, 1) * 2 - 1)
      * MOSS_INTERACTION.responseVariation,
    responseDelay: mossVariation(part.seed, 2)
      * MOSS_INTERACTION.timingVariation,
    shrinkRate: MOSS_INTERACTION.shrinkSpeed
      * (1 + (mossVariation(part.seed, 3) * 2 - 1)
        * MOSS_INTERACTION.speedVariation),
    regrowthRate: MOSS_INTERACTION.regrowthSpeed
      * (1 + (mossVariation(part.seed, 4) * 2 - 1)
        * MOSS_INTERACTION.speedVariation)
  }));
  fishMaxAspectRatio = Math.max(
    ...fishStateArtwork.map((artwork) => artwork.height / artwork.width)
  );
  initializeFishPopulation();
  initializePondCursor();
  initializePondAudio();
  initializePondCover();
  initializeDebugControls();
  initializeIndividualPlacementTransforms();
  applyPlacementLayout(authoredPlacementLayout, false);
  // Keep an immutable copy of the authored layout, then restore any layout
  // previously saved from placement mode before building position-sensitive
  // caches.
  placementDefaults = getPlacementLayoutData();
  loadPlacementLayout(false);
  // Applies the starting tier ("low", always — see performance.js's
  // applyInitialPerfTier) now that every script's top-level code (including
  // every onPerfTierChange registration) has already run — before
  // rebuildCaches(), so the very first cache build already uses low's
  // smaller/cheaper buffers instead of building at full quality first and
  // only shrinking once the runtime monitor notices actual frame drops.
  applyInitialPerfTier();
  // Needs to happen before rebuildCaches() so the very first
  // createPondRevealThresholds() call already reflects any mask shape saved
  // from a previous session in the debug pond mask editor (see
  // pond-mask-editor.js).
  loadPondMaskOrigins(false);
  rebuildCaches();
  placementNeedsCacheRebuild = false;
  // Needs view/width/height from rebuildCaches() above, so it can't run any
  // earlier — see vegetation.js: initializeLilyPadScatter().
  initializeLilyPadScatter();
  // Only now — after every asset is not just loaded but has already been
  // drawn once into the caches above — is the Start button actually ready
  // to mean "ready."
  revealPondStart();
  noLoop();
}

function draw() {
  if (millis() >= pondCoverRemovalAt) finishPondCoverTransition();
  if (placementNeedsCacheRebuild
    && millis() - placementLastCacheRebuildAt > 90) {
    rebuildCaches();
    placementNeedsCacheRebuild = false;
    placementLastCacheRebuildAt = millis();
  }
  if (pondExperienceStarted) {
    updatePerformanceMonitor();
    if (touchInputActive && touches.length > 0) {
      treePointerX = touches[0].x;
      treePointerY = touches[0].y;
    } else if (mouseHoverEnabled) {
      treePointerX = mouseX;
      treePointerY = mouseY;
    }
    updateEcosystemHealth();
    updateDialogueNarrative();
    updateTreeTransition();
    updatePondAudio();
    updateFishBehavior();
    updateLilyPadHoverDrift();
    updateLilyPadScatterDrift();
    updateMossGlide();
    // isDialoguePlaying() is polled (see dialogue.js), not event-driven —
    // nothing calls out the exact moment a line starts or its hold timer
    // runs out. Without this, the knife cursor's own dialogue check
    // (input-events.js: updatePondCursor) would only re-evaluate on the
    // next pointermove, so a visitor resting the pointer motionlessly over
    // a fish right as a line started or ended would see the wrong cursor
    // until they nudged the mouse. refreshPondCursor() already no-ops
    // cheaply (skips entirely with no pointer on the canvas, and only
    // touches the DOM when the resolved cursor actually changed), so
    // re-running it every frame here is negligible cost for closing that
    // gap.
    refreshPondCursor();
  }

  // All expensive static drawing and filters run only when caches are built.
  drawPondLayer();
  drawWaterSurface();
  // Fish are the one thing drawn below the ripple layer (so ripples read as
  // passing over the water's surface in front of them) — everything else
  // (moss, lily pads, tree, grass) still draws after the ripple layer, same
  // as before. This is purely a paint-order change: fish hit-testing
  // (getFishAt / getPollutableTargetAt) is plain coordinate math with no
  // dependency on draw order, so clickability is unaffected either way.
  drawFish();
  drawWaterRippleLayer();
  drawMossAssembly();
  // Scattered extras draw first, so the main group (with its flower and
  // front pad) always renders on top of them instead of an extra covering
  // part of it.
  drawLilyPadScatterExtras();
  drawImportedLilyPads();
  // Tree and grass are both foreground material (closer to the camera than
  // the lily pads floating on the water or the moss bed behind them), so
  // they draw here, on top of everything static.
  drawTreeLayer();
  drawGrassPatches();
  drawForegroundGrass();
  if (placementMode) drawPlacementUI();
  if (pondMaskEditorMode) drawPondMaskEditorUI();
  if (debugHealthStatVisible) drawDebugHealthStat();
  drawDialogue();
  if (debugHealthStatVisible) drawFpsCounter();
}

// Gated behind the same H toggle as drawDebugHealthStat, so demoing the
// pond doesn't need this playtesting instrument on screen — press H when it
// is actually needed. frameRate() with no argument returns p5's own
// already-smoothed current measurement, not the target passed to
// frameRate(60)/frameRate(30) elsewhere in this file.
// Also shows the current perf tier: every quality lever in this codebase
// (fish blur, canvas pixel density, state-reveal mask scale/blend, ...) is
// gated on getPerfTier(), and the runtime monitor that drives it needs a
// full window of sustained bad frames (plus a 4s cooldown between steps,
// twice over to go high -> medium -> low) before it downgrades — so on a
// genuinely struggling device, the number here can keep reading low for a
// stretch of real time while still sitting on "high" settings underneath.
// Without this, that gap was invisible from the outside.
function drawFpsCounter() {
  const tier = getPerfTier();
  push();
  noStroke();
  fill(0, 170);
  rectMode(CORNER);
  rect(8, 8, 98, 42, 4);
  fill(255);
  textAlign(LEFT, TOP);
  textSize(14);
  text(`${frameRate().toFixed(1)} fps`, 16, 13);
  textSize(11);
  text(`tier: ${tier}`, 16, 31);
  pop();
}

function createBuffer(w, h, density = pixelDensity()) {
  const g = createGraphics(max(1, ceil(w)), max(1, ceil(h)));
  g.pixelDensity(density);
  return g;
}

// Debug only — the button itself stays hidden until placement mode (P) is
// on; see placement-editor.js: togglePlacementMode().
function initializeDebugControls() {
  const rerollButton = document.getElementById("pond-reroll-lilypads");
  if (!rerollButton) return;
  rerollButton.addEventListener("click", () => {
    regenerateLilyPadScatter();
    setPlacementNotice("Lily pad scatter rerolled");
  });
}

// Debug only — Shift+Backspace or Shift+Delete (see input-events.js:
// keyPressed()). Clears
// every localStorage key this project writes (dialogue history, which also
// carries the last saved ecosystem health; placement layout, current and
// legacy; lily pad scatter; pond mask editor origins) and reloads, so a
// playtester starts the next run from a genuinely fresh, first-ever-visit
// state instead of having to manually clear site data or guess which key is
// stale. A reload — rather than resetting every in-memory global by hand —
// is what guarantees nothing (fish population, ink pollution, tree
// transition, perf tier, ...) is left over from the previous run.
function hardResetPondState() {
  // Unregistered before clearing anything — handleDialoguePageHide (see
  // setup()) saves the CURRENT (still old, still unhealthy) ecosystemHealth
  // back into DIALOGUE.storageKey on every "pagehide", including the one
  // this function's own reload() is about to fire. Left registered, that
  // handler resurrected the exact key this function had just deleted, with
  // the stale value, a split second before the new page loaded and
  // restoreSavedEcosystemHealth() dutifully restored it — the reset was
  // silently undoing itself.
  window.removeEventListener("pagehide", handleDialoguePageHide);
  const keys = [
    DIALOGUE.storageKey,
    PLACEMENT_STORAGE_KEY,
    LEGACY_PLACEMENT_STORAGE_KEY,
    LILYPAD_SCATTER.storageKey,
    POND_MASK_STORAGE_KEY
  ];
  try {
    for (const key of keys) localStorage.removeItem(key);
    console.log("Hard reset: cleared saved pond state", keys);
  } catch (error) {
    console.warn("Could not clear saved pond state", error);
  }
  window.location.reload();
}

function initializePondCover() {
  const cover = document.getElementById("pond-cover");
  const startButton = document.getElementById("pond-start");
  if (!cover || !startButton) {
    startPondExperience();
    return;
  }
  if ((loadDialogueHistory().visitCount || 0) >= 1) {
    startButton.textContent = "Starting again?";
  }
  startButton.addEventListener("click", startPondExperience, { once: true });
}

// Called once, at the very end of setup() — see the comment above preload().
function revealPondStart() {
  document.getElementById("pond-progress")?.remove();
  const startButton = document.getElementById("pond-start");
  if (!startButton) return;
  startButton.hidden = false;
  startButton.focus({ preventScroll: true });
}

function startPondExperience() {
  if (pondExperienceStarted) return;
  pondExperienceStarted = true;
  loop();
  lastEcosystemInputAt = millis();
  initializeDialogue();
  document.addEventListener("visibilitychange", handleDialogueVisibility);
  document.body.classList.add("pond-entering");
  pondCoverRemovalAt = millis() + 920;
}

function finishPondCoverTransition() {
  document.getElementById("pond-cover")?.remove();
  document.body.classList.remove("pond-covered", "pond-entering");
  pondInteractionEnabled = true;
  pondCoverRemovalAt = Infinity;
}
