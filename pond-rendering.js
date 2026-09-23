// Pond state caching, ink-pollution compositing, and water ripple rendering.

// Once nothing has deposited ink for this long, the buffer's own exponential
// fade (recoveryFadeSeconds is the dominant, faster rate) has decayed it to a
// visually negligible level, so there is no point still paying for the blur
// each frame — clearInkPollution() snaps it off instead of chasing zero
// asymptotically forever.
const INK_IDLE_CLEAR_MS = INK_POLLUTION.recoveryFadeSeconds * 6 * 1000;

// Once nothing has injected flow for this many ms, exponential decay has
// already taken it to a visually negligible level — same snap-off pattern as
// INK_IDLE_CLEAR_MS, just on the flow field's much shorter timescale.
const WATER_FLOW_IDLE_CLEAR_MS = WATER_FLOW.decaySeconds * 1000 * 5;

// How much of each 0-1 sub-stage (healthy->unhealthy or unhealthy->dead)
// the pond's transition must clear before updatePondRevealMask() lets
// anything start revealing at all — same concept as TREE_PARTS' own
// per-part delay (sketch.js, 0.16-0.24), just a single value since the pond
// is one unified transition rather than several staggered parts. Safely
// above pondRevealThresholds' lowest values (~0.025) so no pixel can pop in
// while the pond is meant to be resting, not tunable per-object like the
// tree's delay is — see updatePondRevealMask.
const POND_TRANSITION_DELAY = 0.12;

// Adaptive-performance hook: the lowest tier trades some of the pond's own
// reveal-mask sharpness for frame time, same lever used for object reveals.
// Higher tiers also get a shorter deposit interval — denser ink along a
// hover/drag path reads as one continuous streak instead of separate blobs
// with gaps between them; the lowest tier keeps the original wider spacing
// so it isn't paying for the extra deposit draw calls it can't afford.
onPerfTierChange((tier) => {
  // Pixel count scales with resolution squared, so medium's modest cut
  // still roughly halves it versus high, and low cuts it to a quarter —
  // this buffer feeds updatePondRevealMask's per-pixel JS loop (see its own
  // POND_REVEAL_MASK_UPDATE_INTERVAL_MS comment), this piece's single most
  // expensive per-frame operation, previously only throttled by frequency,
  // never by size, on medium/high.
  INK_POLLUTION.resolution = tier === "low" ? 0.2 : tier === "medium" ? 0.32 : 0.4;
  INK_POLLUTION.depositInterval = tier === "low"
    ? 55
    : tier === "medium" ? 40 : 28;
  placementNeedsCacheRebuild = true;
});

// A small blur applied to the low-resolution mask itself, before it gets
// scaled up to screen size — cheap (the mask buffer is only a fraction of
// screen size, at INK_POLLUTION.resolution) but reads as a real soft blur
// once upscaled, instead of the sharper raster pattern a low-res mask shows
// under bilinear upscaling alone. Kept light for the same reason as the
// object masks (state-reveal.js: STATE_REVEAL_MASK_BLUR_PX) — the pond is
// rarely at a clean 0/1/2 transition value during normal play, so this runs
// almost continuously rather than only during a dramatic crossfade. Skipped
// on the lowest performance tier.
let POND_REVEAL_MASK_BLUR_PX = 1.2;
onPerfTierChange((tier) => {
  POND_REVEAL_MASK_BLUR_PX = tier === "low" ? 0 : 1.2;
});

// updatePondRevealMask's own per-pixel scan (see below) is this whole
// piece's single most expensive per-frame JS loop — a full width*height*
// resolution^2 sweep, uncapped, run every single frame any time transition
// is anywhere away from exactly 0. Per the comment above, that's "almost
// continuously," not just during a dramatic crossfade — health recovering
// slowly, or the pointer merely hovering something, both keep the pond's
// own treeTransition pinned at a nonzero value for as long as they last,
// which is most of normal play. The mask itself only evolves as fast as
// ecosystemHealth/ink do — both slow, continuous processes — so recomputing
// it on every render frame buys nothing visually over a capped rate; the
// composite step below (a GPU-accelerated canvas draw, not a JS loop) still
// runs every frame regardless, just reusing whichever mask was last
// computed in between actual recomputes.
// A millis()-based interval, not a frame-count skip: frame-count skipping
// (and a frame-count-plus-max-staleness hybrid) were both tried here and
// both still read as a visible flicker in practice, since either lets the
// mask sit frozen for a stretch of real time while the ink buffer feeding
// it keeps drifting/decaying every frame regardless (updateInkPollution
// runs unthrottled) and ecosystemHealth/treeTransition keep animating too —
// then snaps to a now-different state all at once when it finally updates.
// This plain interval doesn't have that failure mode: it only ever skips a
// recompute when the true elapsed gap is already under the interval, so
// there's never a stretch of frozen-while-everything-else-moves staleness
// to snap out of. Its own known limitation is the mirror image — once a
// single frame already takes longer than the interval (a genuinely
// collapsed framerate), "enough time has passed" is trivially true by the
// next frame regardless of tier, so it recomputes every frame again and
// provides no relief in that specific worst case. That's an accepted
// tradeoff: no flicker at any fps, at the cost of no headroom at the very
// worst fps.
const POND_REVEAL_MASK_UPDATE_INTERVAL_MS = { high: 16, medium: 33, low: 60 };
let pondRevealMaskLastUpdateAt = -Infinity;

// How quickly a healing pixel (see the `rising` flag in
// updatePondRevealMask) eases toward its freshly computed reveal value
// instead of snapping straight to it every frame. Without this, the instant
// healing began the mask was fully recomputed from scratch each frame off
// the live ink buffer, which is itself still drifting/rotating/decaying on
// its own schedule (updateInkPollution) — that raw recompute visibly
// reshaped/flickered as the ink buffer animated, instead of the mask easing
// shut smoothly. A starting guess, untested in a browser against real
// healing speeds — retune first if closing still reads as jittery (lower)
// or sluggish/laggy behind the pond's own treeTransition easing (higher).
const POND_REVEAL_HEAL_EASE_RATE = 7;

// A faint, irregular flicker hinting recovery is starting, well before
// ecosystemHealth's own slow dead-band trickle (see
// getEcosystemRecoveryRateMultiplier) has moved far enough to show through
// the normal crossfade. Only eligible once idle recovery has had a real
// chance to start (25s) and only while still in the dead band. A per-frame
// low-probability roll starts a brief 60-160ms blip of small magnitude,
// rather than a smooth ramp — reads as an irregular flicker, not a glow.
let pondRecoveryFlickerUntil = -Infinity;
let pondRecoveryFlickerStrength = 0;

function updatePondRecoveryFlicker() {
  const idleSeconds = (millis() - lastEcosystemInputAt) / 1000;
  if (ecosystemHealth >= TREE_HEALTH_BANDS.deadBelow || idleSeconds < 25) {
    pondRecoveryFlickerStrength = 0;
    return 0;
  }
  const now = millis();
  if (now > pondRecoveryFlickerUntil) {
    pondRecoveryFlickerStrength = 0;
    if (random() < 0.03) {
      pondRecoveryFlickerUntil = now + random(60, 160);
      pondRecoveryFlickerStrength = random(0.015, 0.045);
    }
  }
  return pondRecoveryFlickerStrength;
}

function drawPondLayer() {
  const completeTransition = constrain(treeTransition, 0, 2);
  const secondStage = completeTransition >= 1;
  const baseState = secondStage ? pondUnhealthyCache : pondHealthyCache;
  const incomingState = secondStage ? pondDeadCache : pondUnhealthyCache;
  let transition = secondStage
    ? completeTransition - 1
    : completeTransition;
  // Only ever nudges the dead layer's own reveal down (toward showing more
  // of the healthier layer beneath), never further toward dead — a brief
  // peek, not an actual state change; ecosystemHealth/treeTransition
  // themselves are untouched.
  if (secondStage) {
    transition = max(0, transition - updatePondRecoveryFlicker());
  }

  // Keep the mask alive while the pond is healthy so old pigment can finish
  // dissipating instead of freezing off-screen.
  updateInkPollution();
  image(baseState, 0, 0);
  // Ink can hold a local patch open well after the global transition itself
  // has eased back near zero (that's the whole point of the ink-advance
  // above) — stopping here the instant transition dips under the gate would
  // hard-snap that still-visible patch straight to fully cleared instead of
  // letting it fade out with the ink's own smooth decay, which read as the
  // reveal "skipping" during recovery. Only truly reset once the ink itself
  // has settled (inkActive false), by which point there's nothing left to
  // discontinuously erase.
  if ((transition <= 0.001 && !inkActive) || !inkLayer) {
    if (pondRevealProgress > 0 && pondRevealMask) {
      pondRevealPixels.data.fill(0);
      pondRevealMask.clear();
    }
    pondRevealStage = -1;
    pondRevealProgress = 0;
    return;
  }
  compositePondStateWithInk(incomingState, transition, secondStage ? 1 : 0);
}

function compositePondStateWithInk(stateImage, transition, stage) {
  const now = millis();
  if (now - pondRevealMaskLastUpdateAt
    >= POND_REVEAL_MASK_UPDATE_INTERVAL_MS[getPerfTier()]) {
    // The real gap since the mask was last actually recomputed, not just
    // deltaTime (time since last render frame) — updatePondRevealMask's
    // healing-ease is time-based, and this can go more than one render
    // frame between real recomputes. -Infinity only on the very first call
    // ever.
    const elapsedSinceLastMaskUpdate = pondRevealMaskLastUpdateAt === -Infinity
      ? 0
      : (now - pondRevealMaskLastUpdateAt) / 1000;
    updatePondRevealMask(transition, stage, elapsedSinceLastMaskUpdate);
    pondRevealMaskLastUpdateAt = now;
  }
  pondDiffusionCache.clear();
  pondDiffusionCache.image(stateImage, 0, 0);
  const context = pondDiffusionCache.drawingContext;
  context.save();
  context.globalCompositeOperation = "destination-in";
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    pondRevealMaskBlurred.canvas,
    0,
    0,
    pondDiffusionCache.width,
    pondDiffusionCache.height
  );
  context.restore();
  image(pondDiffusionCache, 0, 0);
}

function updatePondRevealMask(progress, stage, elapsedSinceLastMaskUpdate) {
  const mask = pondRevealMask.drawingContext;
  const pixels = pondRevealPixels.data;
  const maskWidth = pondRevealMask.width;
  const maskHeight = pondRevealMask.height;
  // The pond has two sub-transitions (healthy->unhealthy, then
  // unhealthy->dead — see drawPondLayer's secondStage split) sharing this
  // one mask buffer, and each stage's reveal value means the opposite
  // thing: stage 0's 255 is "fully unhealthy" (base=healthy fully hidden
  // under incoming=unhealthy); stage 1's 0 is ALSO "fully unhealthy"
  // (base=unhealthy fully shown, incoming=dead not revealed at all yet) —
  // the same real pond state, sitting at opposite ends of the two stages'
  // own conventions. Crossing that boundary — worsening past "fully
  // unhealthy" into dead, or healing back out of it — used to leave every
  // pixel's stored value untouched, so it got reinterpreted under the new
  // stage's flipped convention wholesale: a pixel properly settled at 255
  // under stage 0 read as 0 the instant stage flipped to 1 (still
  // correctly meaning "fully unhealthy" as stage 0 left it, but now read as
  // "no dead revealed" is fine — the bug is the pixels that HADN'T reached
  // 255 yet), right as drawPondLayer's own base image hard-swapped
  // underneath with no easing of its own. Healing never ratchets (see
  // `rising` below), so a wrong reading took a full heal-ease duration to
  // correct — long enough to be visibly patchy, worse on whichever pixels
  // were furthest from settled at the exact moment the global progress
  // crossed, which is exactly the "glitching in places" this fixes.
  // Remapping every pixel through 255-alpha the instant a real stage change
  // is detected (not the very first transition ever — pondRevealStage's -1
  // sentinel means there's no prior stage to reinterpret) keeps the
  // buffer's meaning continuous across the flip, so there's nothing left
  // for the new stage to misread.
  if (stage !== pondRevealStage && pondRevealStage !== -1) {
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255 - pixels[i];
  }
  const ink = inkLayer.drawingContext.getImageData(
    0, 0, maskWidth, maskHeight
  ).data;
  const hasPollution = pollutionSources.length > 0;
  const hasFlow = waterFlowActive && waterFlowField && getPerfTier() !== "low";
  const rising = stage === pondRevealStage
    && progress >= pondRevealProgress;
  const edge = STATE_REVEAL_EDGE;
  // A plain smoothstep on raw progress still isn't 0 for any progress > 0 —
  // just asymptotically small — which wasn't enough: pondRevealThresholds'
  // lowest values sit close to 0.025, and progress resting anywhere above
  // that (which it does whenever health sits anywhere just under 100%, not
  // exactly at it) kept popping a patch in. The tree's own crossfade
  // (getTreePartTransition in tree-interaction.js) never has this problem
  // because it gates on a real delay first — progress is genuinely,
  // exactly 0 until the transition clears that floor, only then does the
  // smoothstep take over. Reapplying that same delay-gate here, scoped to
  // the pond specifically: rising/pondRevealProgress bookkeeping below
  // stays on the raw (ungated) progress — the gate is monotonic, so it
  // doesn't change that comparison's outcome, only the reveal amount.
  const gatedProgress = constrain(
    (progress - POND_TRANSITION_DELAY) / (1 - POND_TRANSITION_DELAY), 0, 1
  );
  const easedProgress = gatedProgress * gatedProgress * (3 - 2 * gatedProgress);
  // Ink-advance is driven purely by the raw ink buffer's own alpha, which
  // only fades on its own slow timeline (13-70s, see updateInkPollution) —
  // completely decoupled from how close ecosystemHealth already is to full.
  // ecosystemHealth >= ECOSYSTEM.maxHealth also isn't a reliable "we're
  // done" signal on its own: the debug HUD's "100.0%" is .toFixed(1)-
  // rounded and can still be a hair under maxHealth, so that check (and the
  // pollutionSources reset that depends on it) can silently never fire.
  // This tapers ink-advance's own effect out directly as health approaches
  // full, so a patch that's already "safe" stops visibly tearing the pond's
  // mask open regardless of how much raw ink is still technically sitting
  // in the buffer. Gated on idle time (not just health) so it only ever
  // suppresses *lingering* ink from earlier activity — idle resets to 0 on
  // every interaction, so a splash landing right now is never touched.
  const inkIdleSeconds = (millis() - lastEcosystemInputAt) / 1000;
  const inkAdvanceSuppression = inkIdleSeconds < 0.4
    ? 1
    : constrain(map(ecosystemHealth, 98, 100, 1, 0), 0, 1);
  // See the `rising` write-back below — eases a healing pixel toward its
  // target instead of snapping to it every frame. Uses the real gap since
  // this function last ran (elapsedSinceLastMaskUpdate, from
  // compositePondStateWithInk's own throttle), not deltaTime — deltaTime is
  // only one render frame's worth of time, which undercounts how long it's
  // actually been whenever this update was throttled/skipped for a few
  // frames first.
  const healEaseAmount = 1 - exp(
    -min(elapsedSinceLastMaskUpdate, 0.15) * POND_REVEAL_HEAL_EASE_RATE
  );
  for (let y = 0; y < maskHeight; y++) {
    for (let x = 0; x < maskWidth; x++) {
      const index = y * maskWidth + x;
      // A dragged-over patch's own reveal state gets pulled from "upstream"
      // in the flow field instead of read at its own position — the same
      // advection trick the reference fluid sim uses to sample its state
      // texture at uv - velocity, adapted to a plain array lookup. This is
      // what makes the boundary visibly smear along a drag instead of only
      // opening a hole at the pointer.
      let sampleIndex = index;
      if (hasFlow) {
        const flowIndex = index * 2;
        const dx = waterFlowField[flowIndex];
        const dy = waterFlowField[flowIndex + 1];
        if (dx !== 0 || dy !== 0) {
          const sampleX = constrain(round(x - dx), 0, maskWidth - 1);
          const sampleY = constrain(round(y - dy), 0, maskHeight - 1);
          sampleIndex = sampleY * maskWidth + sampleX;
        }
      }
      const alphaIndex = sampleIndex * 4 + 3;
      // Lets well-saturated ink noticeably pull a local patch's reveal
      // forward of the rest of the pond, without being strong enough to
      // blow straight past every threshold in the field the instant ink
      // touches down — areas that were already close to revealing open up
      // readily; areas with a high base threshold still need real
      // accumulated disturbance first. Previously 0.65, which is large
      // enough relative to pondRevealThresholds' own ~0.025-0.965 range
      // that a single hover's ink (depositInkSplat layers 7 overlapping
      // splats in one deposit) could push this past 0.5 and force reveal to
      // 255 across a wide area, regardless of how far the real transition
      // actually was — a massive, disproportionate tear from one hover.
      // Gating this by the transition's own eased progress instead (a
      // since-reverted attempt) fixed that but overcorrected: it made ink's
      // effect exactly zero for the entire first 12% of a sub-stage
      // (POND_TRANSITION_DELAY), which one light hover's tiny health hit
      // essentially never clears — so ink stopped visibly doing anything at
      // all. The actual fix is capping the magnitude itself, independent of
      // progress: at 0.1, even fully-saturated ink only ever pulls a
      // pixel's effective threshold down by 0.1, which opens pixels already
      // fairly close to revealing (near a mask origin's own low `start`
      // value) — a small, immediately visible, localized response to one
      // hover, never a pond-wide tear.
      const inkAdvance = hasPollution
        ? ink[alphaIndex] / 255 * 0.1 * inkAdvanceSuppression
        : 0;
      const threshold = pondRevealThresholds[sampleIndex] - inkAdvance;
      // Always the wide, soft edge — STATE_REVEAL_CORE_EDGE exists on objects
      // to stop an old layer's silhouette peeking through a new layer's own
      // transparency gaps, which doesn't apply here (the pond has no second
      // transparent layer underneath). Using the narrow edge for the outgoing
      // (healing) direction instead produced a near-binary per-pixel pattern
      // that no amount of blur could soften, and made ink-driven local reveals
      // snap straight to fully open instead of blending in — the same edge
      // width both ways keeps healing smooth and turns a hover/drag streak
      // into one continuous gradient instead of a chain of abrupt blobs.
      const reveal = constrain(
        (easedProgress - threshold + edge) / (edge * 2), 0, 1
      ) * 255;
      const outputAlphaIndex = index * 4 + 3;
      // rising (actively taking new damage) stays an instant ratchet — that
      // immediate snap is what makes damage read as sudden. Once healing
      // starts (or the pond is merely holding steady, which also fails the
      // rising check) there is no ratchet holding pixels at their
      // highest-ever value, so easing toward the freshly computed target
      // here instead of snapping to it is what keeps the mask from visibly
      // reconfiguring every frame as the live ink buffer keeps animating
      // underneath it (see POND_REVEAL_HEAL_EASE_RATE above).
      pixels[outputAlphaIndex] = rising
        ? max(pixels[outputAlphaIndex], reveal)
        : pixels[outputAlphaIndex]
          + (reveal - pixels[outputAlphaIndex]) * healEaseAmount;
    }
  }
  mask.putImageData(pondRevealPixels, 0, 0);

  pondRevealMaskBlurred.clear();
  const blurContext = pondRevealMaskBlurred.drawingContext;
  blurContext.filter = POND_REVEAL_MASK_BLUR_PX > 0
    ? `blur(${POND_REVEAL_MASK_BLUR_PX}px)`
    : "none";
  blurContext.drawImage(pondRevealMask.canvas, 0, 0);
  blurContext.filter = "none";

  pondRevealStage = stage;
  pondRevealProgress = progress;
}

// How close the pointer currently sits to the pond's own reveal boundary —
// 1 exactly where the mask is 50% revealed (right at the edge between an
// already-revealed patch and a not-yet-revealed one), fading to 0 well
// inside a uniformly revealed or unrevealed area. Used to boost ink/flow
// strength specifically where crossing that edge is visible, rather than
// uniformly everywhere on open water. Reads pondRevealPixels directly
// (already updated once per active frame by updatePondRevealMask above), so
// this stays free when nothing is transitioning: an idle, fully-settled pond
// leaves that buffer cleared to 0 everywhere, which correctly reads as "no
// edge nearby" rather than a false boundary.
function getPondRevealEdgeProximity(pointerX, pointerY) {
  if (!pondRevealPixels || !pondRevealMask) return 0;
  const maskWidth = pondRevealMask.width;
  const maskHeight = pondRevealMask.height;
  const x = constrain(floor((pointerX / width) * maskWidth), 0, maskWidth - 1);
  const y = constrain(floor((pointerY / height) * maskHeight), 0, maskHeight - 1);
  const alpha = pondRevealPixels.data[(y * maskWidth + x) * 4 + 3] / 255;
  return constrain(1 - abs(alpha - 0.5) * 2, 0, 1);
}

// How quickly a threshold rises with distance from its nearest origin —
// higher keeps that origin's influence tight and local, lower lets it spread
// broad and gradual. Was a flat constant shared by every origin; now each
// origin carries its own growthRate (see pondMaskOrigins / pond-mask-editor.js),
// defaulting to this same value so an untouched origin looks identical to the
// old fixed-constant behavior.
const POND_MASK_DEFAULT_GROWTH_RATE = 0.72;

// The pond's origin layout, hand-tuned in the debug mask editor (M) and
// exported from there — this *is* the current default now, not the original
// procedural 9-hand-placed + 7-hashed layout it replaced. pondMaskOrigins
// (see pond-mask-editor.js) is what createPondRevealThresholds() actually
// reads from; this function only supplies its starting values, for a fresh
// browser with nothing saved yet and for the editor's R (restore defaults)
// key.
function buildDefaultPondMaskOrigins() {
  return [
    { x: 0.14, y: 0.2, start: 0.04, growthRate: 0.72, handleAngle: -2.44685437739309 },
    { x: 0.4001396648044693, y: 0.2109375, start: 0.16, growthRate: 1.4111935320080797, handleAngle: 1.373400766945016 },
    { x: 0.76, y: 0.19, start: 0.08, growthRate: 1.3970521724691791, handleAngle: 1.4485103839962423 },
    { x: 0.5782122905027933, y: 0.13932291666666666, start: 0.21, growthRate: 1.386764830062091, handleAngle: 2.3737365502497476 },
    { x: 0.58, y: 0.43, start: 0.02, growthRate: 0.72, handleAngle: -0.7188299996216247 },
    { x: 0.7779329608938548, y: 0.5703125, start: 0.25, growthRate: 0.9430178507028876, handleAngle: 2.7798064245908862 },
    { x: 0.28980446927374304, y: 0.3776041666666667, start: 0.4999999999999999, growthRate: 1.3758259592241036, handleAngle: 0.3366748193867276 },
    { x: 0.47, y: 0.82, start: 0.28, growthRate: 0.72, handleAngle: 1.6642731079534863 },
    { x: 0.79, y: 0.78, start: 0.16000000000000003, growthRate: 0.932740848288154, handleAngle: -2.810215441104482 },
    { x: 0.6212052412287449, y: 0.28805216733526323, start: 0.15682856175117194, growthRate: 1.07857126165076, handleAngle: -0.40924252569548186 },
    { x: 0.4511173184357542, y: 0.4661458333333333, start: 0.08510852190374862, growthRate: 1.0155165736058422, handleAngle: -2.702231766305202 },
    { x: 0.30935754189944137, y: 0.6067708333333334, start: 0.14946216143907803, growthRate: 1.2371241088544072, handleAngle: 0.6405856651585098 },
    { x: 0.4494595463585938, y: 0.5116530263550886, start: 0.268450226672212, growthRate: 0.72, handleAngle: 2.914984587577378 },
    { x: 0.7248603351955307, y: 0.5130208333333334, start: 0.2673903773747952, growthRate: 0.9963002167290315, handleAngle: -0.5028432109278608 },
    { x: 0.43924581005586594, y: 0.17057291666666666, start: 0.08322205860358735, growthRate: 1.140646928833434, handleAngle: 0.9572401812829799 },
    { x: 0.4979050279329609, y: 0.72265625, start: 0.20055860010979812, growthRate: 1.3269257430194923, handleAngle: -0.7990959367703141 }
  ];
}

// Same technique as every object's own reveal (see state-reveal.js:
// createStateRevealThresholds / stateRevealHash): a cached, per-pixel,
// domain-warped multi-origin distance field, widened to match the same
// irregularity objects use for their own irregular growth.
function createPondRevealThresholds(maskWidth, maskHeight) {
  initializePondMaskOrigins();
  const origins = pondMaskOrigins;

  const thresholds = new Float32Array(maskWidth * maskHeight);
  const raw = new Float32Array(thresholds.length);
  const aspect = maskWidth / max(maskHeight, 1);
  let minimum = Infinity;
  let maximum = -Infinity;

  for (let y = 0; y < maskHeight; y++) {
    const normalizedY = y / max(maskHeight - 1, 1);
    for (let x = 0; x < maskWidth; x++) {
      const normalizedX = x / max(maskWidth - 1, 1);
      const warpedX = normalizedX
        + sin(normalizedY * 19.7 + normalizedX * 4.1) * 0.05
        + sin((normalizedX + normalizedY) * 43.3) * 0.024
        + sin(normalizedY * 78.5 - normalizedX * 8.9) * 0.011;
      const warpedY = normalizedY
        + sin(normalizedX * 16.9 - normalizedY * 3.7) * 0.046
        + sin((normalizedX - normalizedY) * 37.1) * 0.021
        + sin(normalizedX * 69.2 + normalizedY * 7.4) * 0.010;
      let arrival = Infinity;
      for (const origin of origins) {
        const dx = (warpedX - origin.x) * aspect;
        const dy = warpedY - origin.y;
        arrival = min(
          arrival,
          origin.start + sqrt(dx * dx + dy * dy)
            * (origin.growthRate || POND_MASK_DEFAULT_GROWTH_RATE)
        );
      }
      const texture = sin(normalizedX * 71.3 + normalizedY * 29.7) * 0.02
        + sin(normalizedX * 23.1 - normalizedY * 61.9) * 0.014
        + sin(normalizedX * 137.0 + normalizedY * 101.0) * 0.007;
      const index = y * maskWidth + x;
      raw[index] = arrival + texture;
      minimum = min(minimum, raw[index]);
      maximum = max(maximum, raw[index]);
    }
  }

  const range = max(maximum - minimum, 0.0001);
  for (let index = 0; index < raw.length; index++) {
    thresholds[index] = 0.025 + (raw[index] - minimum) / range * 0.94;
  }
  return thresholds;
}

function updateInkPollution() {
  if (!inkLayer || !inkScratch || !inkActive) return;
  const now = millis();
  if (now - inkLastDepositAt > INK_IDLE_CLEAR_MS) {
    clearInkPollution();
    return;
  }
  const elapsedSeconds = min(deltaTime / 1000, 0.05);
  decayWaterFlowField(elapsedSeconds);
  inkScratch.clear();
  const context = inkScratch.drawingContext;
  const centerX = inkScratch.width / 2;
  const centerY = inkScratch.height / 2;
  const driftX = (noise(now * 0.00011, 31) - 0.5) * 0.42;
  const driftY = (noise(47, now * 0.00009) - 0.5) * 0.28;
  const rotation = (noise(73, now * 0.00007) - 0.5)
    * 0.0024 * elapsedSeconds * 60;
  const expansion = 1 + INK_POLLUTION.diffusionPerSecond * elapsedSeconds;
  context.save();
  context.translate(centerX + driftX, centerY + driftY);
  context.rotate(rotation);
  context.scale(expansion, expansion);
  context.translate(-centerX, -centerY);
  context.filter = `blur(${INK_POLLUTION.blurPixels}px)`;
  context.drawImage(inkLayer.canvas, 0, 0);
  context.restore();

  const idleSeconds = (now - lastEcosystemInputAt) / 1000;
  const recovering = idleSeconds >= ECOSYSTEM.recoveryDelay;
  const fadeSeconds = recovering
    ? INK_POLLUTION.recoveryFadeSeconds
    : INK_POLLUTION.idleFadeSeconds;
  const fadeAmount = 1 - exp(-elapsedSeconds / fadeSeconds);
  context.save();
  context.globalCompositeOperation = "destination-out";
  context.globalAlpha = fadeAmount;
  context.fillStyle = "white";
  context.fillRect(0, 0, inkScratch.width, inkScratch.height);
  context.restore();

  const previousLayer = inkLayer;
  inkLayer = inkScratch;
  inkScratch = previousLayer;
  for (const source of pollutionSources) {
    const age = (now - source.lastTouchedAt) / 1000;
    if (age < INK_POLLUTION.tendrilLife) {
      drawInkTendril(source, age, elapsedSeconds);
    }
  }
}

function depositInkSplat(pointerX, pointerY, direction, seed, strength = 1) {
  if (!inkLayer) return;
  inkActive = true;
  inkLastDepositAt = millis();
  const x = pointerX / width * inkLayer.width;
  const y = pointerY / height * inkLayer.height;
  const baseRadius = min(inkLayer.width, inkLayer.height)
    * INK_POLLUTION.coreRadius;
  const context = inkLayer.drawingContext;
  for (let i = 0; i < INK_POLLUTION.splatsPerDeposit; i++) {
    const angle = noise(seed, i * 0.37) * TWO_PI;
    const jitter = noise(seed + 19, i * 0.53) * baseRadius * 0.86;
    const radiusX = baseRadius * (0.36 + noise(seed + 37, i) * 0.78);
    const radiusY = radiusX * (0.48 + noise(seed + 53, i) * 0.70);
    const splatX = x + cos(angle) * jitter;
    const splatY = y + sin(angle) * jitter;
    const radius = max(radiusX, radiusY);
    const gradient = context.createRadialGradient(
      splatX, splatY, 0, splatX, splatY, radius
    );
    gradient.addColorStop(0, `rgba(255,255,255,${0.34 * strength})`);
    gradient.addColorStop(0.52, `rgba(255,255,255,${0.18 * strength})`);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.beginPath();
    context.ellipse(
      splatX,
      splatY,
      radiusX,
      radiusY,
      direction + (noise(seed + 71, i) - 0.5) * 1.4,
      0,
      TWO_PI
    );
    context.fill();
  }
  context.save();
  context.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    const bend = (noise(seed + 101, i) - 0.5) * 1.8;
    const length = baseRadius * (1.2 + noise(seed + 131, i) * 2.2);
    const endAngle = direction + bend;
    context.strokeStyle = `rgba(255,255,255,${0.12 * strength})`;
    context.lineWidth = max(0.6, baseRadius * (0.06 + i * 0.025));
    context.beginPath();
    context.moveTo(x, y);
    context.bezierCurveTo(
      x + cos(direction) * length * 0.32,
      y + sin(direction) * length * 0.32,
      x + cos(endAngle - bend * 0.35) * length * 0.72,
      y + sin(endAngle - bend * 0.35) * length * 0.72,
      x + cos(endAngle) * length,
      y + sin(endAngle) * length
    );
    context.stroke();
  }
  context.restore();
}

// Dragging the cursor over open water: a long, irregular zigzagging streak —
// a chain of kinked segments that wander left and right of the drag
// direction by a noise-driven amount, tapered thin at both ends — reading as
// a ribbon of pigment curling through water rather than a straight smear.
function depositWaterSwirl(pointerX, pointerY, direction, seed, strength = 1) {
  if (!inkLayer) return;
  inkActive = true;
  inkLastDepositAt = millis();
  const x = pointerX / width * inkLayer.width;
  const y = pointerY / height * inkLayer.height;
  const baseRadius = min(inkLayer.width, inkLayer.height)
    * INK_POLLUTION.coreRadius;
  const context = inkLayer.drawingContext;
  const length = baseRadius * (6 + noise(seed, 5) * 4);
  const smearWidth = baseRadius * (0.5 + noise(seed, 11) * 0.3);

  const segmentCount = 7;
  const segmentLength = length / segmentCount;
  const points = [{
    x: x - cos(direction) * length * 0.5,
    y: y - sin(direction) * length * 0.5
  }];
  let angle = direction;
  for (let i = 1; i <= segmentCount; i++) {
    const turn = (0.35 + noise(seed + i * 3.1, 9) * 0.55)
      * (i % 2 === 0 ? 1 : -1);
    angle = direction + turn;
    const previous = points[points.length - 1];
    points.push({
      x: previous.x + cos(angle) * segmentLength,
      y: previous.y + sin(angle) * segmentLength
    });
  }

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  for (let i = 0; i < points.length - 1; i++) {
    // A sine taper keeps both ends thin and faint, thickest in the middle —
    // the zigzag reads as one continuous dragged streak, not a bar.
    const taper = sin(PI * (i + 0.5) / (points.length - 1));
    context.strokeStyle = `rgba(255,255,255,${0.38 * strength * (0.3 + 0.7 * taper)})`;
    context.lineWidth = max(0.8, smearWidth * (0.3 + 0.7 * taper));
    context.beginPath();
    context.moveTo(points[i].x, points[i].y);
    context.lineTo(points[i + 1].x, points[i + 1].y);
    context.stroke();

    // A thinner, brighter core vein along the same segment for a marbled
    // highlight running through the streak.
    context.strokeStyle = `rgba(255,255,255,${0.20 * strength * (0.3 + 0.7 * taper)})`;
    context.lineWidth = max(0.5, smearWidth * (0.3 + 0.7 * taper) * 0.32);
    context.stroke();
  }
  context.restore();
}

// A discrete click/tap: one bright, tightly concentrated splash centered
// exactly on the click point (nothing jittered off-center, unlike
// depositInkSplat), plus a few short radiating spatter rays for an impact
// look without scattering the pigment itself away from the click point.
function depositConcentratedSplash(pointerX, pointerY, direction, seed, strength = 1) {
  if (!inkLayer) return;
  inkActive = true;
  inkLastDepositAt = millis();
  const x = pointerX / width * inkLayer.width;
  const y = pointerY / height * inkLayer.height;
  const baseRadius = min(inkLayer.width, inkLayer.height)
    * INK_POLLUTION.coreRadius;
  const context = inkLayer.drawingContext;
  // Bumped again on top of the earlier 2.2-2.9x (now ~3.3-4.3x) since it
  // was still reading as not obviously visible — though the more likely
  // actual cause was the ambient lingering-ink-advance bug fixed in
  // updatePondRevealMask (inkAdvanceSuppression) drowning it out in visual
  // noise elsewhere on the pond, not the splash itself being too small.
  // Worth confirming whether that fix alone was enough before pushing this
  // larger again. Rays and their stroke width are coreRadius-relative, so
  // they scale up with it too.
  const coreRadius = baseRadius * (3.3 + noise(seed, 2) * 1.0);

  const gradient = context.createRadialGradient(x, y, 0, x, y, coreRadius);
  gradient.addColorStop(0, `rgba(255,255,255,${0.78 * strength})`);
  gradient.addColorStop(0.45, `rgba(255,255,255,${0.48 * strength})`);
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.beginPath();
  context.ellipse(x, y, coreRadius, coreRadius * 0.92, 0, 0, TWO_PI);
  context.fill();

  context.save();
  context.lineCap = "round";
  const rayCount = 6;
  for (let i = 0; i < rayCount; i++) {
    const angle = (TWO_PI / rayCount) * i + noise(seed + i, 7) * 0.6;
    const length = coreRadius * (0.9 + noise(seed + i, 13) * 0.9);
    context.strokeStyle = `rgba(255,255,255,${0.24 * strength})`;
    context.lineWidth = max(0.7, coreRadius * 0.06);
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + cos(angle) * length, y + sin(angle) * length);
    context.stroke();
  }
  context.restore();
}

// Pushes a directional impulse into waterFlowField at the pointer's position
// — the CPU analogue of the reference fluid sim's velocity-field injection.
// Only called while dragging over open water (see registerPollutionSource in
// tree-interaction.js); updatePondRevealMask() is what actually consumes this
// field to smear the reveal boundary along it.
function depositWaterFlow(pointerX, pointerY, direction, speed, strength = 1) {
  if (!waterFlowField) return;
  const magnitude = constrain(
    speed * WATER_FLOW.speedScale, 0, WATER_FLOW.maxDisplacement
  ) * strength;
  if (magnitude < 0.05) return;

  const fieldWidth = pondRevealMask.width;
  const fieldHeight = pondRevealMask.height;
  const x = (pointerX / width) * fieldWidth;
  const y = (pointerY / height) * fieldHeight;
  const radius = min(fieldWidth, fieldHeight) * WATER_FLOW.radiusFactor;
  const impulseX = cos(direction) * magnitude;
  const impulseY = sin(direction) * magnitude;

  const minX = max(0, floor(x - radius));
  const maxX = min(fieldWidth - 1, ceil(x + radius));
  const minY = max(0, floor(y - radius));
  const maxY = min(fieldHeight - 1, ceil(y + radius));
  for (let iy = minY; iy <= maxY; iy++) {
    for (let ix = minX; ix <= maxX; ix++) {
      const dx = ix - x;
      const dy = iy - y;
      const distance = sqrt(dx * dx + dy * dy);
      if (distance > radius) continue;
      const falloff = 1 - distance / radius;
      const index = (iy * fieldWidth + ix) * 2;
      waterFlowField[index] = constrain(
        waterFlowField[index] + impulseX * falloff,
        -WATER_FLOW.maxDisplacement, WATER_FLOW.maxDisplacement
      );
      waterFlowField[index + 1] = constrain(
        waterFlowField[index + 1] + impulseY * falloff,
        -WATER_FLOW.maxDisplacement, WATER_FLOW.maxDisplacement
      );
    }
  }
  waterFlowActive = true;
  waterFlowLastInjectedAt = millis();
}

// Relaxes waterFlowField back toward zero once nothing is actively injecting
// into it. Skipped entirely while inactive — the common case, since flow only
// exists during and briefly after a water drag — so this never costs anything
// during ordinary idle play.
function decayWaterFlowField(elapsedSeconds) {
  if (!waterFlowActive || !waterFlowField) return;
  if (millis() - waterFlowLastInjectedAt > WATER_FLOW_IDLE_CLEAR_MS) {
    waterFlowField.fill(0);
    waterFlowActive = false;
    return;
  }
  const decay = exp(-elapsedSeconds / WATER_FLOW.decaySeconds);
  for (let index = 0; index < waterFlowField.length; index++) {
    waterFlowField[index] *= decay;
  }
}

function drawInkTendril(source, age, elapsedSeconds) {
  const context = inkLayer.drawingContext;
  const life = 1 - age / INK_POLLUTION.tendrilLife;
  const time = millis() / 1000;
  const x = source.x * inkLayer.width;
  const y = source.y * inkLayer.height;
  const baseRadius = min(inkLayer.width, inkLayer.height)
    * INK_POLLUTION.coreRadius;
  const curl = (noise(source.seed, time * 0.24) - 0.5) * 2.4;
  const angle = source.direction + curl;
  const length = baseRadius * (0.55 + age * 0.38);
  const alpha = 0.030 * life * min(1, elapsedSeconds * 60);
  context.save();
  context.lineCap = "round";
  context.strokeStyle = `rgba(255,255,255,${alpha})`;
  context.lineWidth = max(0.45, baseRadius * 0.045 * life);
  context.beginPath();
  context.moveTo(x, y);
  context.bezierCurveTo(
    x + cos(source.direction) * length * 0.35,
    y + sin(source.direction) * length * 0.35,
    x + cos(angle - curl * 0.4) * length * 0.78,
    y + sin(angle - curl * 0.4) * length * 0.78,
    x + cos(angle) * length,
    y + sin(angle) * length
  );
  context.stroke();
  context.restore();
}

function clearInkPollution() {
  if (inkLayer) inkLayer.clear();
  if (inkScratch) inkScratch.clear();
  inkActive = false;
}

function rebuildCaches() {
  const coverScale = max(width / pond.width, height / pond.height);
  const scaleFactor = coverScale * POOL_CAMERA.zoom;
  view = {
    x: (width - pond.width * scaleFactor) / 2 + width * POOL_CAMERA.panX,
    y: (height - pond.height * scaleFactor) / 2 + height * POOL_CAMERA.panY,
    scale: scaleFactor
  };

  // Release old canvases before allocating replacements on resize.
  if (pondHealthyCache) pondHealthyCache.remove();
  if (pondUnhealthyCache) pondUnhealthyCache.remove();
  if (pondDeadCache) pondDeadCache.remove();
  if (pondDiffusionCache) pondDiffusionCache.remove();
  if (pondRevealMask) pondRevealMask.remove();
  if (pondRevealMaskBlurred) pondRevealMaskBlurred.remove();
  if (inkLayer) inkLayer.remove();
  if (inkScratch) inkScratch.remove();
  if (waterSurfaceBuffer) waterSurfaceBuffer.remove();
  if (waterSurfaceBuffer2) waterSurfaceBuffer2.remove();
  pondHealthyCache = createBuffer(width, height);
  pondHealthyCache.background("#90933D");
  pondHealthyCache.image(
    pond,
    view.x,
    view.y,
    pond.width * view.scale,
    pond.height * view.scale
  );
  pondUnhealthyCache = createBuffer(width, height);
  pondUnhealthyCache.background("#90933D");
  pondUnhealthyCache.image(
    pondUnhealthy,
    view.x,
    view.y,
    pond.width * view.scale,
    pond.height * view.scale,
    POOL_UNHEALTHY_SOURCE.x,
    POOL_UNHEALTHY_SOURCE.y,
    POOL_UNHEALTHY_SOURCE.width,
    POOL_UNHEALTHY_SOURCE.height
  );
  pondDeadCache = createBuffer(width, height);
  pondDeadCache.background("#90933D");
  pondDeadCache.image(
    pondDead,
    view.x,
    view.y,
    pond.width * view.scale,
    pond.height * view.scale,
    POOL_DEAD_SOURCE.x,
    POOL_DEAD_SOURCE.y,
    POOL_DEAD_SOURCE.width,
    POOL_DEAD_SOURCE.height
  );
  // Full-size compositing buffer plus two cheap quarter-size ink buffers.
  pondDiffusionCache = createBuffer(width, height);
  const inkWidth = max(1, ceil(width * INK_POLLUTION.resolution));
  const inkHeight = max(1, ceil(height * INK_POLLUTION.resolution));
  pondRevealMask = createBuffer(inkWidth, inkHeight, 1);
  pondRevealMaskBlurred = createBuffer(inkWidth, inkHeight, 1);
  pondRevealPixels = pondRevealMask.drawingContext.createImageData(
    inkWidth, inkHeight
  );
  pondRevealThresholds = createPondRevealThresholds(inkWidth, inkHeight);
  pondRevealStage = -1;
  pondRevealProgress = 0;
  // Forces the very next compositePondStateWithInk call to actually
  // recompute rather than reusing a mask sized for the old buffers.
  pondRevealMaskLastUpdateAt = -Infinity;
  inkLayer = createBuffer(inkWidth, inkHeight, 1);
  inkScratch = createBuffer(inkWidth, inkHeight, 1);
  waterFlowField = new Float32Array(inkWidth * inkHeight * 2);
  waterFlowActive = false;
  rebuildWaterSurfaceBuffer();
  for (const source of pollutionSources) {
    depositInkSplat(
      source.x * width,
      source.y * height,
      source.direction,
      source.seed,
      0.75
    );
  }
}

function initializeWaterSurfacePoints() {
  if (waterSurfaceInitPoints.length === WATER_SURFACE.pointCount) return;
  waterSurfaceInitPoints = [];
  for (let index = 0; index < WATER_SURFACE.pointCount; index++) {
    waterSurfaceInitPoints.push({
      x: 0.04 + stateRevealHash(70, index, 0, 121) * 0.92,
      y: 0.04 + stateRevealHash(70, index, 0, 122) * 0.92
    });
  }
}

function rebuildWaterSurfaceBuffer() {
  initializeWaterSurfacePoints();
  const tier = getPerfTier();
  const resolution = WATER_SURFACE.resolution[tier];
  const bufferWidth = max(24, ceil(width * resolution));
  const bufferHeight = max(16, ceil(height * resolution));
  waterSurfaceBuffer = createBuffer(bufferWidth, bufferHeight, 1);
  waterSurfaceBuffer.noSmooth();
  // High tier only, not just "not low" — a full second full-buffer pass
  // measurably doubled this system's per-frame cost (see WATER_SURFACE's
  // own comment), which is exactly the kind of regression the medium tier
  // exists to avoid.
  waterSurfaceBuffer2 = tier === "high" ? createBuffer(
    bufferWidth, bufferHeight, 1
  ) : null;
  if (waterSurfaceBuffer2) waterSurfaceBuffer2.noSmooth();
  waterSurfaceLastUpdateAt = -Infinity;
  waterSurfaceLayer2LastUpdateAt = -Infinity;
  waterSurfaceBlueMask = buildWaterBlueMask(bufferWidth, bufferHeight);
}

// Classifies each low-res buffer cell as "blue water" or not, sampled once
// from the pond's own healthy-state colors — the water/land silhouette is
// the same shape across health states, only the tint changes, so this
// doesn't need rebuilding when ecosystem health changes, only on resize
// (when rebuildWaterSurfaceBuffer() itself reruns). This is what lets the
// vein effect follow the pond's actual blue water area precisely instead of
// a hand-guessed shape, and keeps it off the green/mossy shallows and the
// architecture entirely.
function buildWaterBlueMask(bufferWidth, bufferHeight) {
  const mask = new Float32Array(bufferWidth * bufferHeight);
  const source = pondHealthyCache;
  if (!source) {
    mask.fill(1);
    return mask;
  }
  source.loadPixels();
  for (let y = 0; y < bufferHeight; y++) {
    const sourceY = constrain(floor((y / bufferHeight) * height), 0, height - 1);
    for (let x = 0; x < bufferWidth; x++) {
      const sourceX = constrain(floor((x / bufferWidth) * width), 0, width - 1);
      const sample = source.get(sourceX, sourceY);
      const isWater = sample[2] > WATER_SURFACE.waterBlueFloor
        && sample[0] <= sample[1] + WATER_SURFACE.waterRedMargin;
      mask[y * bufferWidth + x] = isWater ? 1 : 0;
    }
  }
  return mask;
}

// Paints one water-surface layer's buffer. rotationRadians rotates only the
// SAMPLE coordinate fed into the nearest-moving-point search, not the mask
// lookup — the blue mask always reads the pixel's true position, so a
// rotated second layer still stays perfectly aligned to the pond's actual
// water silhouette; only the wave pattern itself appears rotated relative
// to an unrotated layer.
function paintWaterSurfaceLayer(
  buffer, movingPoints, distanceScale, red, green, blue, rotationRadians
) {
  const bufferWidth = buffer.width;
  const bufferHeight = buffer.height;
  const centerX = bufferWidth / 2;
  const centerY = bufferHeight / 2;
  const cosR = cos(rotationRadians);
  const sinR = sin(rotationRadians);
  buffer.loadPixels();
  for (let y = 0; y < bufferHeight; y++) {
    for (let x = 0; x < bufferWidth; x++) {
      const pixelIndex = (x + y * bufferWidth) * 4;
      // Replaces the old ellipse clip (which matched the small FISH_WATER
      // region this used to be confined to) — the blue mask now defines the
      // effect's actual shape, following the pond's real water silhouette
      // across the whole canvas instead of an arbitrary circle.
      const maskValue = waterSurfaceBlueMask
        ? waterSurfaceBlueMask[y * bufferWidth + x] : 1;
      if (maskValue <= 0) {
        buffer.pixels[pixelIndex + 3] = 0;
        continue;
      }

      const relX = x - centerX;
      const relY = y - centerY;
      const sampleX = centerX + relX * cosR - relY * sinR;
      const sampleY = centerY + relX * sinR + relY * cosR;

      let nearestSquared = Infinity;
      for (const point of movingPoints) {
        const dx = sampleX - point.x;
        const dy = sampleY - point.y;
        nearestSquared = min(nearestSquared, dx * dx + dy * dy);
      }
      const nearest = sqrt(nearestSquared);
      const normalizedDistance = constrain(nearest / distanceScale, 0, 1);
      const vein = pow(normalizedDistance, WATER_SURFACE.waveExponent);
      const softVein = pow(normalizedDistance, 1.35) * 0.22;
      const alpha = (vein + softVein) * WATER_SURFACE.opacity * maskValue;
      buffer.pixels[pixelIndex] = red;
      buffer.pixels[pixelIndex + 1] = green;
      buffer.pixels[pixelIndex + 2] = blue;
      buffer.pixels[pixelIndex + 3] = alpha;
    }
  }
  buffer.updatePixels();
}

// Nearest-moving-point field adapted from the supplied water sketch. Only a
// small transparent buffer is recalculated, then bilinear scaling turns its
// powered nearest-distance boundaries into soft moving surface veins.
// Layer 2 (see waterSurfaceBuffer2) shares the same moving points and
// timing — only its sample rotation differs — so this only pays for the
// per-pixel painting loop twice, not the point-motion setup.
function updateWaterSurface() {
  if (!waterSurfaceBuffer) return;
  const now = millis();
  const tier = getPerfTier();
  if (now - waterSurfaceLastUpdateAt
    < WATER_SURFACE.updateIntervalMs[tier]) return;
  waterSurfaceLastUpdateAt = now;

  const bufferWidth = waterSurfaceBuffer.width;
  const bufferHeight = waterSurfaceBuffer.height;
  const elapsed = now / 1000;
  const amplitudeX = bufferWidth * WATER_SURFACE.pointMotion;
  const amplitudeY = bufferHeight * WATER_SURFACE.pointMotion;
  const motionFrame = elapsed * WATER_SURFACE.referenceFrameRate
    % WATER_SURFACE.frameLength;
  const motionAngle = motionFrame * TWO_PI / WATER_SURFACE.frameLength;
  const movingPoints = waterSurfaceInitPoints.map((point) => ({
    x: point.x * bufferWidth + amplitudeX * Math.sin(
      motionAngle + point.x * 20 * PI
    ),
    y: point.y * bufferHeight + amplitudeY * Math.cos(
      motionAngle + point.y * 20 * PI
    )
  }));

  const stateAmount = constrain(treeTransition / 2, 0, 1);
  const red = round(lerp(175, 146, stateAmount));
  const green = round(lerp(255, 170, stateAmount));
  const blue = round(lerp(238, 122, stateAmount));
  const averagePointSpacing = sqrt(
    bufferWidth * bufferHeight / WATER_SURFACE.pointCount
  );
  const distanceScale = averagePointSpacing
    * WATER_SURFACE.veinDistanceScale;

  paintWaterSurfaceLayer(
    waterSurfaceBuffer, movingPoints, distanceScale, red, green, blue, 0
  );
  // Layer 2 repaints less often than layer 1 (its own interval) and against
  // a sparser subset of the same moving points — a rotated, 65%-opacity
  // accent layer doesn't need layer 1's own fidelity, and both cuts
  // meaningfully reduce what would otherwise be a flat doubling of this
  // system's per-frame cost.
  if (waterSurfaceBuffer2 && now - waterSurfaceLayer2LastUpdateAt
    >= WATER_SURFACE.updateIntervalMs[tier]
      * WATER_SURFACE.layer2UpdateIntervalMultiplier) {
    waterSurfaceLayer2LastUpdateAt = now;
    const layer2Points = movingPoints.filter(
      (_, index) => index % WATER_SURFACE.layer2PointStride === 0
    );
    paintWaterSurfaceLayer(
      waterSurfaceBuffer2, layer2Points, distanceScale, red, green, blue,
      radians(WATER_SURFACE.layer2RotationDegrees)
    );
  }
}

function drawWaterSurface() {
  if (!waterSurfaceBuffer) return;
  updateWaterSurface();
  // Covers the full canvas now — the blue mask (not a positioned/rotated
  // region) is what confines the visible effect to the pond's actual water.
  push();
  imageMode(CORNER);
  blendMode(SCREEN);
  drawingContext.imageSmoothingEnabled = true;
  drawingContext.imageSmoothingQuality = "high";
  image(waterSurfaceBuffer, 0, 0, width, height);
  // Layer 2: same pattern sampled from a rotated coordinate space (see
  // paintWaterSurfaceLayer), composited on top at reduced opacity for a
  // layered, cross-hatched water look instead of one flat repeating pattern.
  if (waterSurfaceBuffer2) {
    tint(255, 255, 255, WATER_SURFACE.layer2Opacity * 255);
    image(waterSurfaceBuffer2, 0, 0, width, height);
    noTint();
  }
  blendMode(BLEND);
  pop();
}


function getLilyRippleScreenPosition(point) {
  const vegetation = LILYPAD_VEGETATION;
  const placement = lilyPartPlacement[point.part] || makePlacementTransform();
  const artwork = lilyPadVegetationArtwork[0]
    && lilyPadVegetationArtwork[0][point.part];
  const part = LILYPAD_VEGETATION_STATES[0][point.part];
  if (!artwork || !part) return null;

  const partCenterX = part.x + artwork.width / 2;
  const partCenterY = part.y + artwork.height / 2;
  const relativeX = (point.x - partCenterX) * placement.scale;
  const relativeY = (point.y - partCenterY) * placement.scale;
  const rotatedPart = rotatePointAround(
    relativeX,
    relativeY,
    0,
    0,
    placement.rotation
  );
  const drift = lilyPadHoverDrift.clusters[point.part] || { x: 0, y: 0 };
  const localX = partCenterX + placement.x + rotatedPart.x + drift.x;
  const localY = partCenterY + placement.y + rotatedPart.y + drift.y;
  const stateScale = getLilyPadAssemblyScale();
  const center = vegetation.radialCenter;
  const stateX = center.x + (localX - center.x) * stateScale;
  const stateY = center.y + (localY - center.y) * stateScale;
  const artworkScale = width * vegetation.width / vegetation.masterWidth;
  const idleMotion = getLilyPadIdleMotion(millis() / 1000);
  const rotatedRoot = rotatePointAround(
    stateX * artworkScale,
    stateY * artworkScale,
    0,
    0,
    idleMotion.angle
  );
  return {
    x: idleMotion.x + rotatedRoot.x,
    y: idleMotion.y + rotatedRoot.y,
    size: point.size * artworkScale * stateScale * placement.scale
  };
}

// One point on the organic ripple ring at the given angle — coherent noise
// sampled using cos/sin of the angle, so it's seamless across a full loop,
// mixed at two frequencies (a broad wobble plus a finer one) for a
// hand-drawn, watery look instead of a mathematically perfect curve.
function organicRipplePoint(x, y, radiusX, radiusY, angle, seed, progress) {
  const broad = noise(
    seed + cos(angle) * 1.4,
    seed + sin(angle) * 1.4,
    progress * 0.6
  ) - 0.5;
  const fine = noise(
    seed + 41 + cos(angle) * 3.1,
    seed + 41 + sin(angle) * 3.1,
    progress * 0.6
  ) - 0.5;
  const wobble = 1 + broad * 0.14 + fine * 0.06;
  return {
    x: x + cos(angle) * radiusX * wobble,
    y: y + sin(angle) * radiusY * wobble
  };
}

// A slightly irregular ring instead of a perfect ellipse, threaded through
// curveVertex for a smooth loop from relatively few sampled points — the same
// kind of irregularity used everywhere else in this piece (ink masks, leaf
// silhouettes, tree paths). About half the time it's not even a full ring: a
// stable, seed-derived choice (not re-rolled per frame, so a given ring keeps
// the same shape as it grows) draws a partial, broken arc instead — real
// water ripples rarely trace a perfect closed circle, especially once they
// overlap or graze something.
function drawOrganicRipple(x, y, rippleWidth, rippleHeight, seed, progress) {
  const radiusX = rippleWidth / 2 * WATER_RIPPLE_SIZE_SCALE;
  const radiusY = rippleHeight / 2 * WATER_RIPPLE_SIZE_SCALE;
  const isPartial = stateRevealHash(seed, 0, 0, 201) < 0.5;

  if (!isPartial) {
    const segments = 12;
    const points = [];
    for (let i = 0; i < segments; i++) {
      const angle = (TWO_PI * i) / segments;
      points.push(
        organicRipplePoint(x, y, radiusX, radiusY, angle, seed, progress)
      );
    }
    beginShape();
    curveVertex(points[segments - 1].x, points[segments - 1].y);
    for (const point of points) curveVertex(point.x, point.y);
    curveVertex(points[0].x, points[0].y);
    curveVertex(points[1].x, points[1].y);
    endShape(CLOSE);
    return;
  }

  const arcStart = stateRevealHash(seed, 0, 0, 202) * TWO_PI;
  const arcSpan = lerp(0.5, 0.85, stateRevealHash(seed, 0, 0, 203)) * TWO_PI;
  const segments = max(6, round(12 * (arcSpan / TWO_PI)));
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const angle = arcStart + (arcSpan * i) / segments;
    points.push(
      organicRipplePoint(x, y, radiusX, radiusY, angle, seed, progress)
    );
  }
  beginShape();
  curveVertex(points[0].x, points[0].y);
  for (const point of points) curveVertex(point.x, point.y);
  curveVertex(points[points.length - 1].x, points[points.length - 1].y);
  endShape();
}

function drawLoopingRipple(x, y, baseSize, seed, opacity = 80) {
  const elapsed = millis() / 1000;
  for (let ring = 0; ring < 3; ring++) {
    const progress = (elapsed * 0.34 + seed * 0.071 + ring / 3) % 1;
    const eased = progress * progress * (3 - 2 * progress);
    const rippleWidth = lerp(baseSize * 0.48, baseSize * 1.38, eased);
    const rippleHeight = rippleWidth * 0.23;
    stroke(175, 255, 236, opacity * sq(1 - progress));
    strokeWeight(lerp(2.2, 0.7, progress));
    drawOrganicRipple(x, y, rippleWidth, rippleHeight, seed + ring * 17, progress);
  }
}

function drawInteractiveRipple(ripple) {
  const progress = constrain(
    (millis() - ripple.startedAt) / ripple.duration,
    0,
    1
  );
  for (let ring = 0; ring < 3; ring++) {
    const ringProgress = constrain(progress - ring * 0.10, 0, 1);
    if (ringProgress <= 0) continue;
    const eased = ringProgress * ringProgress * (3 - 2 * ringProgress);
    const rippleWidth = lerp(12, ripple.maxSize, eased);
    stroke(190, 255, 242, ripple.opacity * sq(1 - ringProgress));
    strokeWeight(lerp(2.6, 0.7, ringProgress));
    drawOrganicRipple(
      ripple.x, ripple.y, rippleWidth, rippleWidth * 0.24,
      ripple.seed + ring * 17, ringProgress
    );
  }
}

function drawWaterRippleLayer() {
  push();
  noFill();
  blendMode(SCREEN);

  for (const point of LILYPAD_RIPPLE_POINTS) {
    const position = getLilyRippleScreenPosition(point);
    if (!position) continue;
    drawLoopingRipple(
      position.x,
      position.y,
      max(24, position.size),
      point.seed,
      72
    );
  }

  for (let index = 0; index < MOSS_PARTS.length; index++) {
    const bounds = getMossPartPlacementBounds(index);
    if (!bounds) continue;
    drawLoopingRipple(
      bounds.x + bounds.w / 2,
      bounds.y + bounds.h * 0.88,
      constrain(bounds.w * 0.34, 34, 150),
      MOSS_PARTS[index].seed,
      58
    );
  }

  for (const ripple of interactiveWaterRipples) {
    drawInteractiveRipple(ripple);
  }
  interactiveWaterRipples = interactiveWaterRipples.filter((ripple) => (
    millis() - ripple.startedAt < ripple.duration
  ));

  blendMode(BLEND);
  pop();
}

function addInteractiveWaterRipple(
  pointerX, pointerY, strength = 1, sizeScale = 1
) {
  interactiveWaterRipples.push({
    x: pointerX,
    y: pointerY,
    seed: random(1000),
    startedAt: millis(),
    duration: lerp(850, 1250, constrain(strength, 0, 1)),
    maxSize: lerp(70, 145, constrain(strength, 0, 1)) * sizeScale,
    opacity: lerp(100, 175, constrain(strength, 0, 1))
  });
  if (interactiveWaterRipples.length > 28) interactiveWaterRipples.shift();
}

function maybeAddWaterHoverRipple(
  pointerX, pointerY, force = false, knownTarget = null
) {
  if (placementMode) return;
  if (pointerX < 0 || pointerX > width || pointerY < 0 || pointerY > height) {
    return;
  }
  const target = (knownTarget || getPollutableTargetAt(pointerX, pointerY)).object;
  if (target !== "none" && target !== "water") return;
  const now = millis();
  const movedEnough = dist(
    pointerX,
    pointerY,
    lastPointerRippleX,
    lastPointerRippleY
  ) >= 18;
  if (!force && (now - lastPointerRippleAt < 95 || !movedEnough)) return;
  // Ordinary hover ripples are larger than before and vary across a true
  // 2:1 size range. Forced ripples (click/touch entry) retain their existing
  // consistent size so the stronger interaction feedback stays predictable.
  const hoverSizeScale = force ? 1 : random(0.9, 1.8);
  addInteractiveWaterRipple(
    pointerX,
    pointerY,
    force ? 1 : 0.60,
    hoverSizeScale
  );
  lastPointerRippleAt = now;
  lastPointerRippleX = pointerX;
  lastPointerRippleY = pointerY;
}

// TREE-PALETTE COLOR SYSTEM
