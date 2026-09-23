let pond;
let pondUnhealthy;
let pondDead;
let treeHealthyParts = [];
let treeUnhealthyParts = [];
let treeDeadParts = [];
let lilyPadVegetationArtwork = [];
let individualLilyPadArtwork = [];
let mossStateArtwork = [];
let fishStateArtwork = [];
let grassArtwork = [];
let foregroundGrassArtwork = [];
let dialogueFont;
let view;
let pondHealthyCache;
let pondUnhealthyCache;
let pondDeadCache;
let pondDiffusionCache;
let pondRevealMask;
let pondRevealMaskBlurred;
let pondRevealPixels;
let pondRevealThresholds;
let pondRevealStage = -1;
let pondRevealProgress = 0;
let inkLayer;
let inkScratch;
let inkActive = false;
let inkLastDepositAt = -Infinity;
// Small decaying displacement field, same resolution as inkLayer/
// pondRevealMask — dragging over open water injects a directional impulse
// here; updatePondRevealMask() then reads its threshold/ink sources from an
// offset ("upstream") cell instead of the pixel's own, smearing the reveal
// boundary along the drag instead of only opening a hole at the pointer.
let waterFlowField = null;
let waterFlowActive = false;
let waterFlowLastInjectedAt = -Infinity;
let treeTransition = 0;
let treeTransitionVelocity = 0;
let ecosystemHealth = 100;
let lastEcosystemInputAt = 0;
let activeInputType = "none";
let treePointerDown = false;
let treeDragging = false;
let treePressX = 0;
let treePressY = 0;
let treePointerX = 0;
let treePointerY = 0;
let touchInputActive = false;
let mouseHoverEnabled = true;
// Set only from real mouseMoved() events (input-events.js) — distinct from
// treePointerX/Y, which track wherever the cursor currently sits even when
// it hasn't moved in a while. Gates continuous hover damage in
// updateEcosystemHealth so a cursor merely resting over the pond (not being
// actively swept around) stops draining health and blocking recovery
// shortly after motion stops.
let lastPointerMoveAt = -Infinity;
// The target getPollutableTargetAt(mouseX, mouseY) returned the last time
// mouseMoved() actually ran — reused by updateEcosystemHealth's continuous
// hover-damage check instead of that check running its own fresh copy of
// the same tree/moss/lily/fish/water hit test every single render frame.
// Only ever trusted alongside lastPointerMoveAt's own recency gate, so it's
// never more than hoverActiveWindowMs stale.
let cachedHoverTarget = { object: "none", part: -1 };
let suppressMouseUntil = 0;
let clickTransitionBoostUntil = 0;
let activeTreePart = -1;
let activePollutableObject = "none";
let treePartVibration = [];
let treeDragRelease = { part: -1, x: 0, y: 0, startedAt: 0 };
let lilyPadDragRelease = { x: 0, y: 0, startedAt: -Infinity };
let lilyPadHoverDrift = {
  lastActivatedAt: -Infinity,
  clusters: {
    padsBack: { x: 0, y: 0, targetX: 0, targetY: 0 },
    main: { x: 0, y: 0, targetX: 0, targetY: 0 },
    small: { x: 0, y: 0, targetX: 0, targetY: 0 },
    padsFront: { x: 0, y: 0, targetX: 0, targetY: 0 }
  }
};
let mossGlide = { parts: [] };
let pollutionSources = [];
let fishCurrentPosition = null;
let fishPopulation = [];
let fishHitAreas = [];
let fishSeedCounter = 0;
let hasFishBeenKilled = false;
let nextGradualRespawnAt = Infinity;
let nextFishExpiryAt = Infinity;
let fishMaxAspectRatio = 1;
let fishPress = { id: null, x: 0, y: 0, dragging: false };
let dialogue = {
  active: false,
  text: "",
  voice: "healthyDialogue",
  startedAt: -Infinity,
  endsAt: -Infinity
};
let dialogueHistory = {};
let dialogueWasHiddenAt = -Infinity;
let dialogueHoverTarget = null;
let dialogueRecovery = {
  active: false,
  inputAt: null,
  fired: {}
};
let placementMode = false;
let placementSelectedId = null;
let placementLastPointer = { x: 0, y: 0 };
let placementDefaults = null;
let authoredPlacementLayout = null;
let placementHasUnsavedChanges = false;
let placementNotice = "";
let placementNoticeUntil = 0;
let placementNeedsCacheRebuild = false;
let placementLastCacheRebuildAt = -Infinity;
let treePartPlacement = [];
let mossPartPlacement = [];
let lilyPartPlacement = {};
let lilyPadScatterExtras = [];
// Parallel-indexed to lilyPadScatterExtras (see applyLilyPadScatter in
// vegetation.js, which keeps the two in sync) — per-pad push-away/spring-
// back state, same shape as lilyPadHoverDrift.clusters but per scattered
// pad instead of per main-cluster region. Kept separate from
// lilyPadScatterExtras itself since that array is persisted to
// localStorage (see LILYPAD_SCATTER.storageKey) and this is purely
// runtime/ephemeral.
let lilyPadScatterDrift = [];
let interactiveWaterRipples = [];
let waterSurfaceBuffer = null;
let waterSurfaceBuffer2 = null;
let waterSurfaceBlueMask = null;
let waterSurfaceInitPoints = [];
let waterSurfaceLastUpdateAt = -Infinity;
let waterSurfaceLayer2LastUpdateAt = -Infinity;
let lastPointerRippleAt = -Infinity;
let lastPointerRippleX = -Infinity;
let lastPointerRippleY = -Infinity;

// Debug-only vector editor for the pond reveal mask's distance-field origins
// (see pond-mask-editor.js). pondMaskOrigins persists across rebuildCaches()/
// resize since its coordinates are normalized fractions of the mask buffer,
// same space createPondRevealThresholds() already worked in.
let pondMaskEditorMode = false;
let pondMaskOrigins = [];
let pondMaskSelectedIndex = -1;
let pondMaskDragPart = null; // "point" | "handle" | null
let pondMaskNotice = "";
let pondMaskNoticeUntil = 0;
let pondMaskHasUnsavedChanges = false;
let pondMaskThresholdsDirty = false;
let pondMaskLastRebuildAt = -Infinity;

// Debug-only playtesting HUD (see tree-interaction.js: drawDebugHealthStat).
let debugHealthStatVisible = false;

const PLACEMENT_STORAGE_KEY = "pond-placement-layout-v2";
const LEGACY_PLACEMENT_STORAGE_KEY = "pond-placement-layout-v1";
const POND_MASK_STORAGE_KEY = "pond-mask-origins-v1";
const LILYPAD_EDITABLE_PARTS = [
  "padsBack",
  "mainStem",
  "mainFlower",
  "smallStem",
  "smallFlower",
  "padsFront"
];

// Approximate water-contact points inside the two multi-pad SVG sheets. These
// use the lily assembly's 831-unit coordinate system and inherit all placement
// transforms applied to their parent SVG.
// Applied once, at the shared drawOrganicRipple() chokepoint in
// pond-rendering.js, so it uniformly shrinks every ripple — ambient
// lily/moss loops and interactive click/drag rings alike — without touching
// each call site's own size formula. 0.5 (first pass) * 0.7 (further 30% cut)
// = 0.35 of the original size.
const WATER_RIPPLE_SIZE_SCALE = 0.35;

const LILYPAD_RIPPLE_POINTS = [
  { part: "padsBack", x: 70, y: 365, size: 58, seed: 11 },
  { part: "padsBack", x: 225, y: 305, size: 72, seed: 17 },
  { part: "padsBack", x: 410, y: 285, size: 92, seed: 23 },
  { part: "padsBack", x: 605, y: 255, size: 82, seed: 31 },
  { part: "padsBack", x: 760, y: 365, size: 62, seed: 41 },
  { part: "padsFront", x: 250, y: 470, size: 70, seed: 47 },
  { part: "padsFront", x: 420, y: 485, size: 105, seed: 59 },
  { part: "padsFront", x: 600, y: 505, size: 74, seed: 67 }
];

// Crop measured from the black rectangle in the supplied full-artboard view.
// Values are relative to the browser window, so this composition stays in
// place when the window is resized.
const POOL_CAMERA = { zoom: 1.6, panX: -0.2, panY: -0.17 };

// Low-resolution nearest-point wave field ("leaf-vein" Voronoi structure),
// masked to the pond's own blue water pixels (see pond-rendering.js:
// buildWaterBlueMask) so it covers the entire pool instead of just the
// fish-swim ellipse, without bleeding onto the green/mossy shallows or the
// architecture. The small buffer preserves the supplied algorithm's look
// without its multi-minute full-resolution frame precomputation.
const WATER_SURFACE = {
  // Raised from 15 for finer detail — averagePointSpacing in
  // updateWaterSurface() is sqrt(bufferArea / pointCount), so more points
  // directly shrinks each vein cell without needing a separate "size" knob.
  pointCount: 26,
  // Resolution is now a fraction of the FULL canvas (previously just the
  // small FISH_WATER ellipse) — lowered so the buffer's actual pixel count,
  // and therefore the per-update cost, stays roughly where it was.
  resolution: { high: 0.065, medium: 0.05, low: 0.035 },
  updateIntervalMs: { high: 33, medium: 50, low: 70 },
  // Doubled from 120 to halve the vein motion's speed — motionAngle is
  // elapsed-time-driven (see updateWaterSurface), so a longer cycle length
  // is a slower cycle, independent of updateIntervalMs/frame rate.
  frameLength: 240,
  referenceFrameRate: 60,
  pointMotion: 50 / 600,
  veinDistanceScale: 0.9,
  waveExponent: 3.5,
  opacity: 54,
  // Classifies a pondHealthyCache pixel as "water" for the vein mask (sampled
  // once from its own colors — see buildWaterBlueMask). The pool's actual
  // water fill ("pool-healthy-v2.svg"'s radial-gradient/-2 and
  // linear-gradient-2) is teal-green where green exceeds blue (#4bb08e,
  // #40b091) — an earlier "blue exceeds green" rule matched none of it, which
  // is why the vein texture never rendered anywhere. Blue channel alone
  // separates water cleanly from this file's non-water fills (background
  // #90933D and architecture #8e6f4f both sit under 80; every water gradient
  // stop sits at 140+); the red-vs-green check excludes the pool's pink/mauve
  // accent colors (#d8a7c9, #b774a6), which are also blue-heavy but clearly
  // red-dominant, unlike the water itself.
  waterBlueFloor: 100,
  waterRedMargin: 10,
  // A second copy of the same vein pattern, sampled from a rotated
  // coordinate space (see paintWaterSurfaceLayer in pond-rendering.js) so
  // the wave shapes themselves sit at a different angle from layer 1's,
  // composited on top at reduced opacity for a layered, cross-hatched water
  // look instead of one flat repeating pattern. A full second full-buffer
  // pass measurably doubled this system's per-frame cost, so it's kept to
  // the high tier only (not just excluded from low), updates at half the
  // frequency of layer 1 (layer2UpdateIntervalMultiplier), and searches
  // against half the moving points (layer2PointStride) — a rotated 65%-
  // opacity accent layer doesn't need the same fidelity as the primary one.
  layer2RotationDegrees: 45,
  layer2Opacity: 0.65,
  layer2UpdateIntervalMultiplier: 2,
  layer2PointStride: 2
};

// The unhealthy and dead v2 pools were exported on larger, offset artboards.
// These crops map each composition onto the healthy v2 pool's artboard so
// state reveals do not make the environment jump or change size.
const POOL_UNHEALTHY_SOURCE = {
  x: 227.84,
  y: 259.53,
  width: 2726,
  height: 2162.98
};

const POOL_DEAD_SOURCE = {
  x: 228.27,
  y: 316.31,
  width: 2726,
  height: 2162.98
};

// Persistent low-resolution pigment mask. Interactions deposit dye that
// diffuses, curls and grows tendrils while revealing the next pond state.
const INK_POLLUTION = {
  resolution: 0.4,
  sourceSpacing: 54,
  maxSources: 24,
  depositInterval: 55,
  splatsPerDeposit: 7,
  coreRadius: 0.060,
  tendrilLife: 5.5,
  diffusionPerSecond: 0.032,
  idleFadeSeconds: 70,
  recoveryFadeSeconds: 13,
  blurPixels: 0.55,
  // Multiplies both the visual ink-deposit strength and the flow-field
  // strength (see registerPollutionSource in tree-interaction.js) by
  // 1 + edgeProximity * this, so hovering/dragging right across the pond's
  // own reveal boundary leaves noticeably stronger marks than dragging
  // through a uniformly-revealed or uniformly-unrevealed patch.
  edgeBoostStrength: 2.5
};

// Dragging over open water pushes a directional impulse into waterFlowField
// (see the global's own comment); values are starting guesses tuned by eye
// against a browser, not derived — speedScale/maxDisplacement are the two to
// retune first if the smear reads too subtle or too strong.
const WATER_FLOW = {
  radiusFactor: INK_POLLUTION.coreRadius * 1.5, // vs min(fieldW, fieldH)
  // pondRevealThresholds varies gently across the whole mask buffer (it's a
  // smooth distance field spanning hundreds of buffer px), while the reveal
  // edge is already ~0.14 wide in threshold-space — an 8px sample-position
  // shift moved the read threshold by roughly 10x less than that edge width,
  // so the warp was real but far too small to ever show up against the
  // edge's own softness. Raised well past the old value for the drag smear.
  maxDisplacement: 40,  // field-buffer px: both injection cap and accumulated clamp
  speedScale: 10,       // field-px of displacement per (screen px/ms) of drag speed
  decaySeconds: 0.35    // exponential relax time once motion stops
};

// Independent tree placement, matched to the supplied crop reference.
// Original 1x artwork size, placed at the top-right like the reference.
// Drag input affects ecosystem health but does not reposition the tree.
const TREE = { scale: 1.35, x: 0.55, y: -0.40, rotation: 0 };

// Health-band boundaries are the visual endpoints of each gradual change:
// 100→70 transitions healthy→unhealthy; 70→20 transitions unhealthy→dead
// (see getTreeStateTarget in tree-interaction.js — slowUnhealthyStart moved
// this anchor down from TREE_HEALTH_BANDS.deadBelow(40), so the tree/pond
// visually start recovering as soon as health climbs past 20%, not 40%; the
// 20-40% stretch of that just runs at slowUnhealthySpeedMultiplier instead
// of full speed — see updateTreeTransition).
const TREE_TRANSITION = {
  hoverDuration: 0.45,
  // Click damage is instant on ecosystemHealth, but the mask (treeTransition)
  // still eases toward it — 1.2x left the mask visibly lagging behind a
  // click's damage. Bumped so a click's own catch-up reads as near-instant,
  // without touching hoverDuration itself (still the speed for drag/hover
  // drain and idle recovery).
  clickSpeedMultiplier: 4,
  slowUnhealthyStart: 20,
  slowUnhealthySpeedMultiplier: 0.3
};

const TREE_HEALTH_BANDS = { healthyAbove: 70, deadBelow: 40 };

// Interaction motion is measured in the tree's 1577 x 1571 artwork space.
// Increase hoverShake/clickShake for a stronger vibration, or maxStretch for
// a more elastic drag.
const TREE_INTERACTION = {
  hoverShake: 12,
  clickShake: 22,
  vibrationDuration: 1,
  vibrationSpeed: 22,
  maxStretch: 0.38,
  stretchDistance: 180,
  dragFollow: 0.24,
  releaseDuration: 0.38
};

const ECOSYSTEM = {
  minHealth: 0,
  maxHealth: 100,
  recoveryDelay: 3,
  fullRecoveryDuration: 35,
  // Continuous while the pointer sits over a pollutable object and has
  // moved recently (see hoverActiveWindowMs) — not gated on movement
  // happening on this exact frame the way the old hoverDamagePerMove it
  // replaced was (see updateEcosystemHealth). 0.8% every 0.5s = 1.6%/s.
  hoverDamagePerSecond: 1.6,
  // How long after the last real mouseMoved() event continuous hover
  // damage keeps applying. Without this, a cursor left resting motionless
  // over the pond — not actively swept around, just sitting there —
  // drained health and reset the recovery-delay timer every single frame
  // forever, since treePointerX/Y stay wherever the cursor last was
  // regardless of whether it's moving. That made recovery structurally
  // impossible any time the cursor happened to rest over an interactive
  // area, which is exactly what merely reading this debug panel does.
  hoverActiveWindowMs: 500,
  // Renamed from this same object's old (confusingly hover-named)
  // hoverDamagePerSecond field, which only ever drove the drag branch below
  // — freed up once hover got its own genuine per-second rate above.
  dragDamagePerSecond: 100 / 30,
  clickDamage: 4,
  dragThreshold: 7,
  inputMultiplier: {
    drag: 1.8
  }
};

// Component pairs share one 1577 x 1571 master coordinate system. Healthy
// rectangles reproduce the original assembled SVG; unhealthy rectangles keep
// each replacement centred while introducing shrink, settling and droop.
const TREE_PARTS = [
  {
    name: "trunk",
    healthyFile: "assets/Tree-healthy/trunk-state1.svg",
    unhealthyFile: "assets/Tree-unhealthy/trunk-state1_1.svg",
    deadFile: "assets/Tree-dead/trunk-dead.svg",
    healthy: { x: 826.74, y: 874.92, w: 414.41, h: 446.07 },
    unhealthy: { x: 826.74, y: 879.92, w: 414.41, h: 446.07 },
    dead: { x: 826.74, y: 879.92, w: 414.41, h: 446.07 },
    delay: 0.24, droop: 0.018, arc: 0.012, pulse: 0.015, seed: 701
  },
  {
    name: "branch-middle",
    healthyFile: "assets/Tree-healthy/branch-middle.svg",
    unhealthyFile: "assets/Tree-unhealthy/branch-middle_1.svg",
    deadFile: "assets/Tree-dead/branch-middle_2.svg",
    healthy: { x: 496.86, y: 638.14, w: 316.49, h: 267.59 },
    unhealthy: { x: 496.70, y: 669.00, w: 346.67, h: 246.04 },
    dead: { x: 496.70, y: 669.00, w: 346.67, h: 246.04 },
    delay: 0.16, droop: 0.060, arc: -0.025, pulse: 0.025, seed: 719
  },
  {
    name: "branch-top",
    healthyFile: "assets/Tree-healthy/branch-top.svg",
    unhealthyFile: "assets/Tree-unhealthy/branch-top_1.svg",
    deadFile: "assets/Tree-dead/branch-top_2.svg",
    healthy: { x: 250.85, y: 304.11, w: 280.72, h: 311.75 },
    unhealthy: { x: 275.85, y: 329.11, w: 280.72, h: 311.75 },
    dead: { x: 275.85, y: 329.11, w: 280.72, h: 311.75 },
    delay: 0.13, droop: 0.080, arc: -0.030, pulse: 0.030, seed: 733
  },
  {
    name: "leaf-back",
    healthyFile: "assets/Tree-healthy/leaf-the-back.svg",
    unhealthyFile: "assets/Tree-unhealthy/leaf-the-back_1.svg",
    deadFile: "assets/Tree-dead/leaf-the-back_2.svg",
    healthy: { x: 281, y: 172, w: 1018, h: 760 },
    unhealthy: { x: 291.5, y: 270, w: 1017, h: 604 },
    // The dead artwork is a narrower crop; retain the unhealthy centre point.
    dead: { x: 502, y: 270, w: 596, h: 604 },
    delay: 0.05, droop: 0.020, arc: 0.025, pulse: 0.045, seed: 751
  },
  {
    name: "leaf-top",
    healthyFile: "assets/Tree-healthy/Leaf-top.svg",
    unhealthyFile: "assets/Tree-unhealthy/Leaf-top_1.svg",
    deadFile: "assets/Tree-dead/Leaf-top_2.svg",
    healthy: { x: 0, y: 0, w: 740, h: 591 },
    unhealthy: { x: 199, y: 138, w: 392, h: 375 },
    dead: { x: 199, y: 138, w: 392, h: 375 },
    delay: 0.00, droop: -0.055, arc: -0.055, pulse: 0.060, seed: 769
  },
  {
    name: "leaf-yellow-dot",
    healthyFile: "assets/Tree-healthy/leaf-yellow-dot.svg",
    unhealthyFile: "assets/Tree-unhealthy/leaf-yellow-dot_1.svg",
    deadFile: null,
    healthy: { x: 130, y: 504, w: 206, h: 206 },
    unhealthy: { x: 175, y: 494, w: 206, h: 206 },
    dead: { x: 175, y: 494, w: 206, h: 206 },
    delay: 0.02, droop: 0.120, arc: 0.085, pulse: 0.070, seed: 787
  },
  {
    name: "leaf-front",
    healthyFile: "assets/Tree-healthy/leaf-center-front.svg",
    unhealthyFile: "assets/Tree-unhealthy/leaf-center-front_1.svg",
    deadFile: "assets/Tree-dead/leaf-center-front_2.svg",
    healthy: { x: 530, y: 500, w: 528, h: 459 },
    unhealthy: { x: 560, y: 630, w: 394, h: 345 },
    dead: { x: 560, y: 630, w: 394, h: 345 },
    delay: 0.08, droop: 0.075, arc: 0.045, pulse: 0.055, seed: 809
  }
];

// The vegetation exports are tightly cropped, so each state is placed in one
// shared 831-unit assembly. Matching parts reveal with ecosystem health.
const LILYPAD_VEGETATION = {
  // Reposition the complete lily-pad section with x/y. Both are viewport
  // proportions: +x moves right, +y moves down. Change width to resize it.
  x: 0.370,
  y: 0.200,
  width: 0.400,
  rotation: 0,
  masterWidth: 831,
  stateScale: [1.15, 1, 0.85],
  radialCenter: { x: 388, y: 300 },
  seed: 211,
  range: 14,
  bob: 5,
  tilt: 0.013,
  speed: 0.085,
  hoverDriftDistance: 0.065,
  hoverDriftHold: 0.18,
  hoverReturnDuration: 1.8,
  hoverClusters: {
    padsBack: { x: 415, y: 302, radiusX: 430, radiusY: 215, bias: -0.22, distance: 0.78 },
    main: { x: 330, y: 145, radiusX: 155, radiusY: 330, bias: 0.34, distance: 1.08 },
    small: { x: 350, y: 275, radiusX: 120, radiusY: 185, bias: -0.42, distance: 0.92 },
    padsFront: { x: 415, y: 463, radiusX: 250, radiusY: 145, bias: 0.20, distance: 1.16 }
  },
  plants: {
    main: {
      base: { x: 250, y: 430 },
      tipOffset: { x: 95, y: -382 },
      stemBase: [{ x: 55, y: 400 }, { x: 56, y: 400 }, null],
      flowerAnchor: [{ x: 129, y: 215 }, { x: 95, y: 205 }, null],
      droop: 0.20
    },
    small: {
      base: { x: 285, y: 430 },
      tipOffset: { x: 89, y: -203 },
      stemBase: [{ x: 62, y: 218 }, { x: 62, y: 214 }, null],
      flowerAnchor: [{ x: 65, y: 103 }, { x: 65, y: 103 }, null],
      droop: 0.26
    }
  }
};

const LILYPAD_VEGETATION_STATES = [
  {
    padsBack: { file: "assets/Lilypad-healthy/pads-back.svg", x: 0, y: 100 },
    padsFront: { file: "assets/Lilypad-healthy/pads-front.svg", x: 184, y: 330 },
    mainStem: { file: "assets/Lilypad-healthy/main-stem.svg" },
    mainFlower: { file: "assets/Lilypad-healthy/main-flower.svg" },
    smallStem: { file: "assets/Lilypad-healthy/small-stem.svg" },
    smallFlower: { file: "assets/Lilypad-healthy/small-flower.svg" }
  },
  {
    padsBack: { file: "Lilypad-unhealthy/pads-back_1.svg", x: 69, y: 113 },
    padsFront: { file: "Lilypad-unhealthy/pads, front.svg", x: 184, y: 330 },
    mainStem: { file: "Lilypad-unhealthy/main-stem_1.svg" },
    mainFlower: { file: "Lilypad-unhealthy/main-flower_1.svg" },
    smallStem: { file: "Lilypad-unhealthy/small-stem_1.svg" },
    smallFlower: { file: "Lilypad-unhealthy/small-flower_1.svg" }
  },
  {
    padsBack: { file: "Lilypad-dead/pads-back_2.svg", x: 78, y: 90 },
    padsFront: { file: "Lilypad-dead/pads-front_1.svg", x: 184, y: 326 },
    mainStem: null,
    mainFlower: null,
    smallStem: null,
    smallFlower: null
  }
];

// Three-state artwork for the individual-pad scatter below (as opposed to
// the main group's padsBack/padsFront multi-pad sheets). Yellow transforms
// healthy -> unhealthy, then dissolves entering dead. Red and both small
// variants have no unhealthy/dead artwork, so they dissolve entering
// unhealthy. "biggest" is deliberately excluded from the scatter pool.
const LILYPAD_SCATTER_FILES = [
  ["Lilypad-yellowMedium.svg", "SVG/Lilypad-yellowMedium-unhealthy.svg", null],
  ["Lilypad-RedMedium.svg", null, null],
  ["Lilypad-Small1.svg", null, null],
  ["Lilypad-Small2.svg", null, null]
];

// Exact composition to spawn every time — not a randomized count. Indices
// into LILYPAD_SCATTER_FILES above.
const LILYPAD_SCATTER_COMPOSITION = [
  { fileIndex: 0, count: 1 }, // yellow
  { fileIndex: 1, count: 1 }, // red
  { fileIndex: 2, count: 2 }, // small1
  { fileIndex: 3, count: 2 }  // small2
];

// Hand-placed, tested-safe zones for lily pad placement — replaces sampling
// "anywhere inside FISH_WATER," which kept landing pads on the tree, the
// moss bed, a grass patch, or the pool's architecture border, since
// FISH_WATER (tuned for fish swimming through open water) is far more
// permissive than where a stationary pad actually reads as sitting on open
// water. Viewport-fraction rectangles (x/y/w/h, 0-1). "primary" is the main
// tested-good area (upper-middle to upper-slightly-left); "secondary" is a
// narrow pocket slightly right of center that also tested clear — kept
// available but picked much less often, via weight.
const LILYPAD_SAFE_ZONES = [
  { x: 0.28, y: 0.14, w: 0.33, h: 0.28, weight: 6 }, // primary
  { x: 0.48, y: 0.22, w: 0.12, h: 0.12, weight: 1 }  // secondary, rare
];

// Extra, single individual-pad instances scattered around the pool, separate
// from the main animated LILYPAD_VEGETATION group. Randomized once per
// device (persisted in localStorage) rather than per page load, so a reload
// on the same browser keeps the same layout — position only, never rotation.
// None of these have their own separate unhealthy/dead artwork, so instead
// of crossfading to a different sprite they dissolve away via the same
// mask-fade technique as grass patch 3 (drawGrassPatches) as the pond heads
// toward fully dead.
const LILYPAD_SCATTER = {
  storageKey: "pond-lilypad-scatter-v10",
  // Anti-stacking clearance is size-aware, not a flat distance — a flat
  // minSpacing let pads whose own width was larger than that spacing still
  // overlap heavily. Two separate factors, not one: the main group's own
  // huge exclusion radius (previous single-factor version) was eating most
  // of the zone's budget by itself, leaving barely any room for the 6
  // extras to actually separate from EACH OTHER — which is where the
  // visible stacking actually was. mainSpacingRadiusFactor stays small so
  // extras can sit reasonably close to the main cluster (they visually read
  // as satellites of it, not a hazard); spacingRadiusFactor (extra-to-extra)
  // is close to a true non-overlap radius (0.5) so two pads can no longer
  // land on top of each other.
  mainSpacingRadiusFactor: 0.16,
  spacingRadiusFactor: 0.48,
  spacingPadding: 0.014,
  // Multiplied by LILYPAD_VEGETATION.width at draw time, so an extra pad
  // stays smaller than the main group even if that width is later edited.
  // Shrunk from 0.3-0.55 — smaller pads make the 6-way non-overlap packing
  // easier to satisfy inside the zone above.
  minSizeFraction: 0.2,
  maxSizeFraction: 0.36,
  bob: 4,
  range: 8,
  speed: 0.09,
};

const FISH_WATER = {
  x: 1847,
  y: 1325,
  radiusX: 570,
  radiusY: 330,
  width: 430,
  rotation: 0
};

// Assigned to each spawned fish in round-robin order (see spawnFish() /
// getFishOrbitOffset() in fish.js) rather than left to chance, so a handful
// of fish on screen together are guaranteed a visibly different mix of paths
// instead of all reading as random wobbles on the same basic ellipse.
const FISH_TRAJECTORY_TYPES = ["ellipse", "figure8", "bean"];

const FISH_STATE_FILES = [
  "SVG/Fish-alive-healthy.svg",
  "SVG/Fish-alive-unhealthy.svg",
  "SVG/Fish-dead.svg"
];

const FISH_BEHAVIOR = {
  deadDuration: 4000,
  deathSinkStageDuration: 1000,
  gradualRespawnInterval: 3000,
  spawnFadeDuration: 420,
  maxFish: 3,
  cursorSlowRadius: 250,
  cursorMinimumSpeed: 0.22,
  dragReturnDuration: 650,
  // Short movement history sampled from the visible tail.
  trailMinDistance: 12,
  trailMaxPoints: 7,
  trailFadePerFrame: 0.035,
  trailStrokeWeight: 3.5,
  trailLineCount: 4,
  trailLineSpacing: 5.5
};

const DIALOGUE = {
  storageKey: "pond-dialogue-history-v1",
  charactersPerSecond: 30.42, // 30% faster again, on top of the prior 30% (original 18)
  holdDuration: 2500,
  fontSize: 0.0376,
  minFontSize: 22,
  maxFontSize: 61,
  shadowBlur: 80
};

// Each supplied healthy grass export is drawn independently. x/y/width are
// viewport proportions; source dimensions preserve each SVG's aspect ratio.
const GRASS_PATCHES = [
  {
    files: ["SVG/PatchGrass-healthy.svg", "SVG/PatchGrass-unhealthy.svg"],
    sourceWidth: 297, sourceHeight: 454,
    unhealthyWidth: 213, unhealthyHeight: 397,
    x: 0.070, y: 0.220, width: 0.280,
    flipX: -1, angle: -0.055,
    seed: 313, range: 15, bob: 7, tilt: 0.052, speed: 0.155
  },
  {
    files: ["SVG/PatchGrass2-healthy.svg", "SVG/PatchGrass2-unhealthy.svg"],
    sourceWidth: 340, sourceHeight: 530,
    unhealthyWidth: 340, unhealthyHeight: 530,
    x: 0.685, y: 0.545, width: 0.285,
    flipX: 1, angle: 0.035,
    seed: 347, range: 18, bob: 8, tilt: 0.060, speed: 0.135
  },
  {
    files: ["SVG/PatchGrass3-healthy.svg", null],
    sourceWidth: 319, sourceHeight: 422,
    x: 0.405, y: 0.590, width: 0.250,
    flipX: 1, angle: -0.025,
    seed: 379, range: 15, bob: 7, tilt: 0.055, speed: 0.145
  }
];

// Individually exported foreground leaves. The top group hangs into the
// frame; the bottom group grows up from the lower-left edge. Each part owns
// its own pivot and motion seed so the silhouettes sway independently rather
// than moving as one rigid clump. Missing later-state files intentionally
// fade out support leaves that disappear as the pond deteriorates.
const FOREGROUND_GRASS_PARTS = [
  {
    name: "backLeaf",
    files: [
      "Foreground-grass/SVG/back-leaf-healthy.svg",
      "Foreground-grass/SVG/back-leaf-unhealthy.svg",
      "Foreground-grass/SVG/back-leaf-dead.svg"
    ],
    sizes: [{ w: 572, h: 410 }, { w: 582, h: 411 }, { w: 560, h: 399 }],
    x: 0.115, y: 1.018, height: 0.255,
    anchorX: 0, anchorY: 1,
    rotation: 0,
    seed: 421, speed: 0.105, sway: 0.013
  },
  {
    name: "bigLeaf",
    files: [
      "Foreground-grass/SVG/big-leaf-healthy.svg",
      "Foreground-grass/SVG/big-leaf-unhealthy.svg",
      "Foreground-grass/SVG/big-leaf-dead.svg"
    ],
    sizes: [{ w: 614, h: 783 }, { w: 614, h: 783 }, { w: 614, h: 783 }],
    x: -0.012, y: 1.025, height: 0.600,
    anchorX: 0, anchorY: 1,
    rotation: 0,
    seed: 443, speed: 0.082, sway: 0.010
  },
  {
    name: "supportLeaf2",
    files: ["Foreground-grass/SVG/support-leaf-2-healthy.svg", null, null],
    sizes: [{ w: 290, h: 446 }, null, null],
    x: 0.032, y: 1.022, height: 0.465,
    anchorX: 0, anchorY: 1,
    rotation: 0,
    seed: 467, speed: 0.125, sway: 0.018
  },
  {
    name: "supportLeaf",
    files: [
      "Foreground-grass/SVG/support-leaf-healthy.svg",
      "Foreground-grass/SVG/support-leaf-unhealthy.svg",
      null
    ],
    sizes: [{ w: 222, h: 459 }, { w: 221, h: 459 }, null],
    x: 0.073, y: 1.020, height: 0.445,
    anchorX: 0, anchorY: 1,
    rotation: 0,
    seed: 479, speed: 0.112, sway: 0.015
  },
  {
    name: "topSupport",
    files: ["Foreground-grass/SVG/support-top-healthy.svg", null, null],
    sizes: [{ w: 185, h: 624 }, null, null],
    x: 0.260, y: -0.030, height: 0.300,
    anchorX: 0.5, anchorY: 0,
    rotation: 0,
    seed: 503, speed: 0.092, sway: 0.011
  },
  {
    name: "topLeaf2",
    files: [
      "Foreground-grass/SVG/top-leaf-2-healthy.svg",
      "Foreground-grass/SVG/top-leaf-2-unhealthy.svg",
      null
    ],
    sizes: [{ w: 548, h: 446 }, { w: 504, h: 410 }, null],
    x: 0.190, y: -0.050, height: 0.240,
    anchorX: 0, anchorY: 0,
    rotation: 0,
    seed: 521, speed: 0.118, sway: 0.016
  },
  {
    name: "topLeaf1",
    files: [
      "Foreground-grass/SVG/top-leaf-1-healthy.svg",
      "Foreground-grass/SVG/top-leaf-unhealthy.svg",
      "Foreground-grass/SVG/top-leaf-dead.svg"
    ],
    sizes: [{ w: 424, h: 412 }, { w: 424, h: 413 }, { w: 503, h: 410 }],
    x: 0.220, y: -0.045, height: 0.270,
    anchorX: 0, anchorY: 0,
    rotation: 0,
    seed: 547, speed: 0.098, sway: 0.014
  }
];

// All healthy moss sheets retain coordinates from this shared artboard. Some
// later-state exports are tightly cropped; their offsets below put them back
// into this same coordinate system. x/y move the complete assembly.
const MOSS_ASSEMBLY = {
  x: 0.07,
  y: 0.45,
  width: 0.76,
  height: 0.60,
  rotation: 0,
  masterWidth: 1094,
  masterHeight: 835
};

const MOSS_INTERACTION = {
  clickResponseMultiplier: 1.65,
  minimumScale: 0.42,
  shrinkSpeed: 5.5,
  regrowthSpeed: 2.8,
  responseVariation: 0.14,
  timingVariation: 0.18,
  speedVariation: 0.18
};

// Broad hit regions cover the visible stalk and bed without making the empty
// pond surface interactive. Values are viewport proportions.
const MOSS_HIT_AREAS = [
  { x: 0.18, y: 0.64, radiusX: 0.13, radiusY: 0.22 },
  { x: 0.34, y: 0.61, radiusX: 0.16, radiusY: 0.13 },
  { x: 0.54, y: 0.90, radiusX: 0.28, radiusY: 0.17 }
];

// Lily pads and moss use the long soft cast-shadow technique (see
// drawLongCastShadow in vegetation.js): several progressively farther,
// wider, softer, fainter copies of the same artwork drawn behind it,
// simulating a shadow cast at a low light angle instead of a single
// fixed-offset blur. length/opacity are starting guesses (tinted with each
// object's own previous shadow color) — untested in a browser, so these are
// the values to retune first if the shadow reads too long, too dark, or too
// subtle. Step count and per-step blur are NOT configurable here on purpose
// — see drawLongCastShadow's own comment: an earlier version exposed both,
// and moss's multiple state regions each running their own full multi-step,
// per-step-blurred pass made the whole scene visibly laggy.
// angle is in degrees, not radians — converted at draw time inside
// drawLongCastShadow(), not here. This is a top-level const evaluated the
// instant sketch.js's script tag runs; p5's global functions (radians, cos,
// sin, ...) aren't guaranteed attached yet at that point (every other
// top-level config in this file sticks to plain numbers for the same
// reason) — calling radians() here threw and silently killed the rest of
// this file's top-level declarations, which is why the pond stopped loading
// at all.
const VEGETATION_SHADOWS = {
  lilyPad: {
    tintColor: [13, 31, 24],
    length: 46,
    angle: 105,
    opacity: 40
  },
  moss: {
    tintColor: [20, 30, 15],
    length: 40,
    angle: 105,
    opacity: 40
  },
  // Grass keeps the simpler native-shadow technique — not part of this
  // request, and its own comment history already explains why it stays
  // crisp-edged (the state-reveal mask blur does its softening instead).
  grass: {
    color: "rgba(20, 30, 15, 0.26)",
    blur: 7,
    offsetX: 3,
    offsetY: 5
  }
};

// Each imported sheet is anchored independently because the supplied SVGs
// are tightly cropped. `width` is the healthy sheet's viewport-width ratio.
const MOSS_PARTS = [
  {
    name: "tallStem",
    files: [
      "Moss-healthy/tall-stem.svg",
      "moss-unhealthy/tall-stem_1.svg",
      "moss-dead/tall-stem_2.svg"
    ],
    sizes: [{ w: 1094, h: 835 }, { w: 519, h: 286 }, { w: 520, h: 285 }],
    // The healthy export contains both the left stalk and the large bed. Draw
    // those source regions separately so the bed can match the reference.
    regions: [[
      { source: { x: 0, y: 0, w: 239, h: 521 }, x: 0, y: 0 },
      { source: { x: 575, y: 549, w: 519, h: 286 }, x: 400, y: 549 }
    ], null, null],
    offsets: [{ x: 0, y: 0 }, { x: 400, y: 549 }, { x: 399, y: 550 }],
    pivot: { x: 0, y: 835 },
    seed: 131, range: 15, bob: 7, tilt: 0.024, speed: 0.070
  },
  {
    name: "tallNodes",
    files: [
      "Moss-healthy/tall-nodes.svg",
      "moss-unhealthy/tall-nodes_1.svg",
      "moss-dead/tall-nodes_2.svg"
    ],
    sizes: [{ w: 1009, h: 294 }, { w: 1008, h: 195 }, { w: 1008, h: 196 }],
    offsets: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
    pivot: { x: 0, y: 294 },
    seed: 157, range: 24, bob: 11, tilt: 0.036, speed: 0.058
  },
  {
    name: "bedBase",
    files: [
      "Moss-healthy/bed-base.svg",
      "moss-unhealthy/bed-base_1.svg",
      "moss-dead/bed-base_2.svg"
    ],
    sizes: [{ w: 343, h: 276 }, { w: 134, h: 94 }, { w: 135, h: 106 }],
    offsets: [{ x: 0, y: 0 }, { x: 0, y: 170 }, { x: 0, y: 170 }],
    pivot: { x: 0, y: 276 },
    seed: 173, range: 9, bob: 5, tilt: 0.012, speed: 0.052
  },
  {
    name: "bedSatellites1",
    files: [
      "Moss-healthy/bed-satellites-1.svg",
      "moss-unhealthy/bed-satellites-1_1.svg",
      null
    ],
    sizes: [{ w: 879, h: 268 }, { w: 878, h: 268 }, null],
    offsets: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
    pivot: { x: 0, y: 268 },
    seed: 197, range: 29, bob: 13, tilt: 0.030, speed: 0.048
  },
  {
    name: "bedSatellites2",
    files: [
      "Moss-healthy/bed-satellites-2.svg",
      "moss-unhealthy/bed-satellites-2_1.svg",
      "moss-dead/bed-satellites-2_1.svg"
    ],
    sizes: [{ w: 484, h: 189 }, { w: 116, h: 104 }, { w: 116, h: 104 }],
    offsets: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
    pivot: { x: 0, y: 189 },
    seed: 223, range: 34, bob: 15, tilt: 0.038, speed: 0.044
  }
];
