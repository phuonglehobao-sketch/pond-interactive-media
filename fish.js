// Fish population, spawning, movement, interaction, death, and rendering.

// Fish generate and disappear normally through Stage 1 (friendly) and
// Stage 2 (intimidated). Stage 3 (hostile, health < deadBelow) keeps
// whatever fish remain — no more spawning or forced die-off — until the
// player kills them individually.
function isFishActiveStage() {
  return ecosystemHealth >= TREE_HEALTH_BANDS.deadBelow;
}

function constrainFishToWater(sourceX, sourceY) {
  const inverseCos = cos(-FISH_WATER.rotation);
  const inverseSin = sin(-FISH_WATER.rotation);
  let localX = (sourceX - FISH_WATER.x) * inverseCos
    - (sourceY - FISH_WATER.y) * inverseSin;
  let localY = (sourceX - FISH_WATER.x) * inverseSin
    + (sourceY - FISH_WATER.y) * inverseCos;
  const normalizedDistance = sqrt(
    sq(localX / FISH_WATER.radiusX) + sq(localY / FISH_WATER.radiusY)
  );
  if (normalizedDistance > 1) {
    localX /= normalizedDistance;
    localY /= normalizedDistance;
  }
  const rotationCos = cos(FISH_WATER.rotation);
  const rotationSin = sin(FISH_WATER.rotation);
  return {
    x: FISH_WATER.x + localX * rotationCos - localY * rotationSin,
    y: FISH_WATER.y + localX * rotationSin + localY * rotationCos
  };
}

function getFishSourcePointer(pointerX, pointerY) {
  return constrainFishToWater(
    (pointerX - view.x) / view.scale,
    (pointerY - view.y) / view.scale
  );
}

function initializeFishPopulation() {
  fishPopulation = [];
  fishHitAreas = [];
  fishSeedCounter = 0;
  hasFishBeenKilled = false;
  nextGradualRespawnAt = Infinity;
  nextFishExpiryAt = Infinity;
  if (!isFishActiveStage()) return;
  spawnFish();
  spawnFish();
  spawnFish();
}

function countLivingFish() {
  let count = 0;
  for (const fish of fishPopulation) {
    if (fish.status === "alive") count++;
  }
  return count;
}

function spawnFish() {
  if (countLivingFish() >= FISH_BEHAVIOR.maxFish) return false;
  const fishId = fishSeedCounter++;
  const seed = 401 + fishId * 53;
  const fish = {
    id: fishId,
    seed,
    // Assigned once and retained for this fish's entire lifetime.
    visualDepth: random(0, 1),
    // Randomized fresh per spawn (not derived from the deterministic seed),
    // so simultaneous fish don't all trace the same shared ellipse offset
    // only in time — each gets its own size, tilt and center, and starts
    // at its own random point along it.
    phase: random(TWO_PI),
    orbit: {
      // Cycled by spawn order, not randomized — see FISH_TRAJECTORY_TYPES.
      type: FISH_TRAJECTORY_TYPES[fishId % FISH_TRAJECTORY_TYPES.length],
      radiusXScale: random(0.72, 1.18),
      radiusYScale: random(0.72, 1.18),
      centerOffsetX: random(-0.16, 0.16) * FISH_WATER.radiusX,
      centerOffsetY: random(-0.16, 0.16) * FISH_WATER.radiusY,
      rotation: random(-0.4, 0.4),
      speedScale: random(0.82, 1.22)
    },
    status: "alive",
    spawnedAt: millis(),
    deadAt: -Infinity,
    position: { x: FISH_WATER.x, y: FISH_WATER.y, facing: 1 },
    drag: { active: false, offsetX: 0, offsetY: 0 },
    release: { x: 0, y: 0, facing: 1, startedAt: -Infinity },
    trail: [],
    trailFacing: 1
  };
  fish.position = getFishSwimmingMotion(fish, millis() / 1000);
  fishPopulation.push(fish);
  return true;
}

// The three FISH_TRAJECTORY_TYPES shapes, all in the same pre-tilt,
// pre-recenter "raw" space that getFishSwimmingMotion() then rotates and
// offsets per-fish. "ellipse" is the original single-frequency loop;
// "figure8" doubles the y-frequency for a crossing lemniscate loop; "bean"
// adds a second harmonic to both axes for an asymmetric, kidney-shaped loop
// — three genuinely different paths, not just re-scaled versions of one.
function getFishOrbitOffset(orbit, healthyAmount, phase, wobbleY) {
  if (orbit.type === "figure8") {
    return {
      x: cos(phase) * FISH_WATER.radiusX
        * lerp(0.46, 0.62, healthyAmount) * orbit.radiusXScale,
      y: sin(phase * 2) * FISH_WATER.radiusY
        * lerp(0.17, 0.24, healthyAmount) * orbit.radiusYScale + wobbleY
    };
  }
  if (orbit.type === "bean") {
    return {
      x: (cos(phase) + 0.35 * cos(phase * 2)) * FISH_WATER.radiusX
        * lerp(0.36, 0.48, healthyAmount) * orbit.radiusXScale,
      y: (sin(phase) - 0.25 * sin(phase * 2)) * FISH_WATER.radiusY
        * lerp(0.30, 0.42, healthyAmount) * orbit.radiusYScale + wobbleY
    };
  }
  return {
    x: cos(phase) * FISH_WATER.radiusX
      * lerp(0.46, 0.62, healthyAmount) * orbit.radiusXScale,
    y: sin(phase) * FISH_WATER.radiusY
      * lerp(0.34, 0.48, healthyAmount) * orbit.radiusYScale + wobbleY
  };
}

function getFishSwimmingMotion(fish, elapsedSeconds) {
  const healthyAmount = 1 - constrain(treeTransition, 0, 1) * 0.42;
  const orbit = fish.orbit;
  const phase = fish.phase
    + sin(elapsedSeconds * 0.14 * orbit.speedScale + fish.seed) * 0.42
    + (noise(fish.seed, elapsedSeconds * 0.06) - 0.5) * 0.55;
  const wobbleY = (noise(fish.seed + 16, elapsedSeconds * 0.17) - 0.5)
    * lerp(34, 55, healthyAmount);
  const raw = getFishOrbitOffset(orbit, healthyAmount, phase, wobbleY);
  // A tiny forward step along the same path, used only to read off which way
  // it's currently heading — works the same for every trajectory shape
  // instead of needing a hand-derived facing rule per type.
  const rawAhead = getFishOrbitOffset(orbit, healthyAmount, phase + 0.01, wobbleY);
  // Tilt and re-center this fish's own orbit so it visibly doesn't share the
  // exact same path as the others.
  const orbitX = raw.x * cos(orbit.rotation) - raw.y * sin(orbit.rotation)
    + orbit.centerOffsetX;
  const orbitY = raw.x * sin(orbit.rotation) + raw.y * cos(orbit.rotation)
    + orbit.centerOffsetY;
  const orbitCos = cos(FISH_WATER.rotation);
  const orbitSin = sin(FISH_WATER.rotation);
  return {
    x: FISH_WATER.x + orbitX * orbitCos - orbitY * orbitSin,
    y: FISH_WATER.y + orbitX * orbitSin + orbitY * orbitCos,
    // The sprite's un-flipped (facing=1) orientation is drawn facing left,
    // not right — matches the sign the original single-trajectory formula
    // (-sin(phase) < 0 ? 1 : -1) used, which this generalizes.
    facing: rawAhead.x - raw.x >= 0 ? -1 : 1,
    pulse: 1 + sin(elapsedSeconds * 4.8 + phase) * 0.025,
    wobble: sin(elapsedSeconds * 3.6 + phase * 1.7)
      * lerp(0.035, 0.055, healthyAmount)
  };
}

function updateFishMotion(fish, elapsedSeconds, elapsed) {
  if (fish.status !== "alive") return;
  const swimmingMotion = getFishSwimmingMotion(fish, elapsedSeconds);
  if (fish.drag.active) {
    fish.position = {
      ...swimmingMotion,
      x: fish.position.x,
      y: fish.position.y,
      facing: fish.position.facing,
      wobble: swimmingMotion.wobble * 0.35
    };
    return;
  }

  const releaseProgress = constrain(
    (millis() - fish.release.startedAt) / FISH_BEHAVIOR.dragReturnDuration,
    0,
    1
  );
  if (releaseProgress < 1) {
    const returnAmount = smoothRange(releaseProgress, 0, 1);
    fish.position = {
      ...swimmingMotion,
      x: lerp(fish.release.x, swimmingMotion.x, returnAmount),
      y: lerp(fish.release.y, swimmingMotion.y, returnAmount),
      facing: returnAmount < 0.5
        ? fish.release.facing
        : swimmingMotion.facing
    };
  } else {
    fish.position = swimmingMotion;
  }

  const fishScreenX = view.x + fish.position.x * view.scale;
  const fishScreenY = view.y + fish.position.y * view.scale;
  const proximity = 1 - smoothRange(
    dist(treePointerX, treePointerY, fishScreenX, fishScreenY),
    0,
    FISH_BEHAVIOR.cursorSlowRadius
  );
  const speedMultiplier = lerp(
    1,
    FISH_BEHAVIOR.cursorMinimumSpeed,
    proximity
  );
  const healthyAmount = 1 - constrain(treeTransition, 0, 1) * 0.42;
  fish.phase += elapsed * lerp(0.18, 0.27, healthyAmount) * speedMultiplier;
}

function killFish(fish, queueForRecovery = false) {
  if (!fish) return;
  fish.status = "dead";
  fish.deadAt = millis();
  fish.drag.active = false;
  fish.trail = [];
  fish.release.startedAt = -Infinity;
  nextFishExpiryAt = min(
    nextFishExpiryAt,
    fish.deadAt + FISH_BEHAVIOR.deadDuration
  );
  // A player-initiated kill (not the ecosystem-collapse mass death below)
  // unlocks gradual respawning for the rest of the session.
  if (!queueForRecovery) {
    hasFishBeenKilled = true;
    if (nextGradualRespawnAt === Infinity) {
      nextGradualRespawnAt = millis() + FISH_BEHAVIOR.gradualRespawnInterval;
    }
  }
}

function updateFishBehavior() {
  const elapsed = min(deltaTime / 1000, 0.1);
  const now = millis();
  const activeStage = isFishActiveStage();

  // A dead fish still finishes its visible window and disappears in any
  // stage; only new spawning/respawning is gated to Stage 1 & 2. Only pay for
  // the filter/reallocation on the frame something is actually due to expire.
  if (now >= nextFishExpiryAt) {
    fishPopulation = fishPopulation.filter((fish) => (
      fish.status !== "dead" || now - fish.deadAt < FISH_BEHAVIOR.deadDuration
    ));
    nextFishExpiryAt = Infinity;
    for (const fish of fishPopulation) {
      if (fish.status === "dead") {
        nextFishExpiryAt = min(
          nextFishExpiryAt,
          fish.deadAt + FISH_BEHAVIOR.deadDuration
        );
      }
    }
  }
  if (activeStage && hasFishBeenKilled && now >= nextGradualRespawnAt) {
    if (countLivingFish() < FISH_BEHAVIOR.maxFish) spawnFish();
    nextGradualRespawnAt = now + FISH_BEHAVIOR.gradualRespawnInterval;
  }

  const elapsedSeconds = now / 1000;
  for (const fish of fishPopulation) {
    updateFishMotion(fish, elapsedSeconds, elapsed);
    if (fish.status === "alive") updateFishTrail(fish, elapsed);
  }
}

function getFishAt(pointerX, pointerY) {
  for (let index = fishHitAreas.length - 1; index >= 0; index--) {
    const area = fishHitAreas[index];
    const normalizedX = (pointerX - area.x) / area.radiusX;
    const normalizedY = (pointerY - area.y) / area.radiusY;
    if (normalizedX * normalizedX + normalizedY * normalizedY <= 1) {
      return area.id;
    }
  }
  return null;
}

function getFishById(id) {
  return fishPopulation.find((fish) => fish.id === id) || null;
}

function beginFishPress(fishId, pointerX, pointerY, inputType) {
  const fish = getFishById(fishId);
  if (!fish) return;
  fishPress = {
    id: fishId,
    x: pointerX,
    y: pointerY,
    dragging: false,
    inputType
  };
}

function updateFishPress(pointerX, pointerY) {
  if (fishPress.id === null) return false;
  const fish = getFishById(fishPress.id);
  if (!fish) return false;
  // Dead fish stay draggable as corpses, not just click targets.
  if (!fishPress.dragging) {
    fishPress.dragging = dist(pointerX, pointerY, fishPress.x, fishPress.y)
      >= ECOSYSTEM.dragThreshold;
    if (fishPress.dragging) {
      if (fish.status === "alive") {
        notifyDialogueInteraction("drag", { object: "fish", part: fish.id });
      } else {
        notifyDialogueInteraction(
          "fishDragDead",
          { object: "fish", part: fish.id },
          { health: ecosystemHealth }
        );
      }
      const pointer = getFishSourcePointer(fishPress.x, fishPress.y);
      fish.drag.active = true;
      fish.drag.offsetX = pointer.x - fish.position.x;
      fish.drag.offsetY = pointer.y - fish.position.y;
      fish.release.startedAt = -Infinity;
    }
  }
  if (fishPress.dragging) {
    const pointer = getFishSourcePointer(pointerX, pointerY);
    const position = constrainFishToWater(
      pointer.x - fish.drag.offsetX,
      pointer.y - fish.drag.offsetY
    );
    const movement = position.x - fish.position.x;
    fish.position.x = position.x;
    fish.position.y = position.y;
    if (abs(movement) > 0.2) fish.position.facing = movement >= 0 ? 1 : -1;
  }
  return true;
}

function endFishPress() {
  if (fishPress.id === null) return false;
  const fish = getFishById(fishPress.id);
  if (fish) {
    if (fishPress.dragging) {
      fish.drag.active = false;
      if (fish.status === "alive") {
        // Unkillable while a dialogue line is on screen — killing a fish
        // mid-line silently drops that kill's own dialogue trigger (and its
        // place in the fishKillCount sequence), since
        // notifyDialogueInteraction already no-ops whenever
        // isDialoguePlaying(). Simplest fix: the fish just isn't killable
        // during that window at all, same as a healthy-pond release.
        if (ecosystemHealth <= TREE_HEALTH_BANDS.healthyAbove
          && !isDialoguePlaying()) {
          // Once the pond isn't fully healthy, dragging a fish is as fatal
          // as clicking it — released or not, it ends up dead.
          killFish(fish);
          notifyDialogueInteraction(
            "fishDragKill",
            { object: "fish", part: fish.id },
            { health: ecosystemHealth }
          );
          playPondEffect("fishAttack");
          applyEcosystemDamage(
            ECOSYSTEM.clickDamage * ECOSYSTEM.inputMultiplier.drag,
            fishPress.inputType
          );
          clickTransitionBoostUntil = millis()
            + TREE_TRANSITION.hoverDuration * 1000;
        } else {
          fish.release = {
            x: fish.position.x,
            y: fish.position.y,
            facing: fish.position.facing,
            startedAt: millis()
          };
        }
      }
      // A dead fish simply stays wherever its corpse was dropped.
    } else if (fish.status === "alive" && !isDialoguePlaying()) {
      killFish(fish);
      notifyDialogueInteraction(
        "fishKill",
        { object: "fish", part: fish.id },
        { health: ecosystemHealth }
      );
      playPondEffect("fishAttack");
      applyEcosystemDamage(ECOSYSTEM.clickDamage, fishPress.inputType);
      clickTransitionBoostUntil = millis()
        + TREE_TRANSITION.hoverDuration * 1000;
    } else if (fish.status === "dead") {
      notifyDialogueInteraction(
        "fishClickDead",
        { object: "fish", part: fish.id },
        { health: ecosystemHealth }
      );
    }
  }
  fishPress = { id: null, x: 0, y: 0, dragging: false, inputType: "none" };
  return true;
}

function getFishTailPosition(fish, visualScale = 1) {
  const position = fish.position;
  const angle = FISH_WATER.rotation + position.wobble;
  const forwardX = -cos(angle) * position.facing;
  const forwardY = -sin(angle) * position.facing;
  const tailDistance = FISH_WATER.width * 0.54 * visualScale;
  return {
    x: position.x - forwardX * tailDistance,
    y: position.y - forwardY * tailDistance
  };
}

// Store only a short history of meaningful tail movement. A facing change
// clears the history so the wake cannot cut across the fish as it turns.
function updateFishTrail(fish, elapsed) {
  if (!fish.trail) fish.trail = [];
  if (fish.trailFacing !== fish.position.facing) {
    fish.trail = [];
    fish.trailFacing = fish.position.facing;
  }

  const depth = constrain(fish.visualDepth ?? 0.35, 0, 1);
  const tail = getFishTailPosition(fish, lerp(1, 0.76, depth));
  const last = fish.trail[fish.trail.length - 1];
  if (!last || dist(tail.x, tail.y, last.x, last.y)
    > FISH_BEHAVIOR.trailMinDistance) {
    fish.trail.push({ x: tail.x, y: tail.y, life: 1 });
  }
  if (fish.trail.length > FISH_BEHAVIOR.trailMaxPoints) fish.trail.shift();

  const frameScale = elapsed * 60;
  for (const point of fish.trail) {
    point.life -= FISH_BEHAVIOR.trailFadePerFrame * frameScale;
  }
  fish.trail = fish.trail.filter((point) => point.life > 0);
}

function drawFishTrail(fish, visualScale = 1, depth = 0) {
  if (!fish.trail || fish.trail.length < 2) return;
  const points = fish.trail.map((point) => ({
    x: point.x,
    y: point.y,
    alpha: point.life
  }));
  const tail = getFishTailPosition(fish, visualScale);
  points.push({ x: tail.x, y: tail.y, alpha: 1 });
  drawFlowTrail(
    points,
    FISH_BEHAVIOR.trailLineCount,
    FISH_BEHAVIOR.trailLineSpacing,
    FISH_BEHAVIOR.trailStrokeWeight,
    lerp(82, 34, depth),
    true
  );
}

// Draw several gently offset strokes along one sampled path. Shared with the
// pointer's water-hover trail so both kinds of water movement feel related.
function drawFlowTrail(
  points,
  lineCount,
  lineSpacing,
  strokeSize,
  opacity,
  convergeAtEnd = false
) {
  const count = points.length;
  if (count < 3) return;

  // Two points inside every sampled segment soften corners without inventing
  // a separate side-to-side wave. The result follows the real swimming arc.
  const smoothed = [points[0]];
  for (let i = 0; i < count - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const alphaA = a.alpha === undefined ? 1 : a.alpha;
    const alphaB = b.alpha === undefined ? 1 : b.alpha;
    smoothed.push(
      {
        x: lerp(a.x, b.x, 0.25),
        y: lerp(a.y, b.y, 0.25),
        alpha: lerp(alphaA, alphaB, 0.25)
      },
      {
        x: lerp(a.x, b.x, 0.75),
        y: lerp(a.y, b.y, 0.75),
        alpha: lerp(alphaA, alphaB, 0.75)
      }
    );
  }
  smoothed.push(points[count - 1]);

  push();
  noFill();
  strokeCap(ROUND);
  strokeJoin(ROUND);
  blendMode(SCREEN);
  const flowPhase = millis() / 1000 * 2.1;
  for (let lane = 0; lane < lineCount; lane++) {
    const lanePosition = lane - (lineCount - 1) / 2;
    const irregularOffset = sin((lane + 1) * 2.41) * lineSpacing * 0.42;
    const laneStrength = 1 - abs(lanePosition) / (lineCount + 1) * 0.55;
    const lanePoints = [];
    for (let i = 0; i < smoothed.length; i++) {
      const previous = smoothed[max(0, i - 1)];
      const a = smoothed[i];
      const next = smoothed[min(smoothed.length - 1, i + 1)];
      const tangent = atan2(next.y - previous.y, next.x - previous.x);
      const progress = i / (smoothed.length - 1);
      const spread = convergeAtEnd ? pow(1 - progress, 0.7) : 1;
      const baseOffset = lanePosition * lineSpacing + irregularOffset;
      // Phase travels toward the oldest end of the wake, producing water
      // flow without breaking the stroke into visible dots or dashes.
      const flowingOffset = sin(
        i * 0.42 - flowPhase + lane * 1.73
      ) * lineSpacing * 0.28;
      const offset = (baseOffset + flowingOffset) * spread;
      lanePoints.push({
        x: a.x + cos(tangent + HALF_PI) * offset,
        y: a.y + sin(tangent + HALF_PI) * offset
      });
    }

    const oldestAlpha = smoothed[0].alpha === undefined
      ? 1 : smoothed[0].alpha;
    const newestAlpha = smoothed[smoothed.length - 1].alpha === undefined
      ? 1 : smoothed[smoothed.length - 1].alpha;
    const laneOpacity = opacity * laneStrength;
    stroke(190, 255, 242, laneOpacity * newestAlpha);
    strokeWeight(max(0.55, strokeSize * laneStrength));
    const first = lanePoints[0];
    const last = lanePoints[lanePoints.length - 1];
    const gradient = drawingContext.createLinearGradient(
      first.x, first.y, last.x, last.y
    );
    gradient.addColorStop(
      0,
      `rgba(190, 255, 242, ${laneOpacity * oldestAlpha / 255})`
    );
    gradient.addColorStop(
      1,
      `rgba(190, 255, 242, ${laneOpacity * newestAlpha / 255})`
    );
    drawingContext.strokeStyle = gradient;
    beginShape();
    curveVertex(lanePoints[0].x, lanePoints[0].y);
    for (const point of lanePoints) curveVertex(point.x, point.y);
    curveVertex(last.x, last.y);
    endShape();
  }
  blendMode(BLEND);
  pop();
}

function drawFish() {
  push();
  translate(view.x, view.y);
  scale(view.scale);

  const context = drawingContext;
  context.save();
  context.beginPath();
  context.translate(FISH_WATER.x, FISH_WATER.y);
  context.rotate(FISH_WATER.rotation);
  // Clipped well past FISH_WATER's own radius, not at it — a fish's body,
  // blur halo, drop shadow, and wake trail all extend past its own orbit
  // center, and the orbit itself (see getFishOrbitOffset) can carry that
  // center out to ~90% of FISH_WATER's radius. Clipping at the exact radius
  // sliced a hard, flat edge straight through the fish (visible blur/tint
  // cut off mid-fade) any time it swam near the boundary during ordinary,
  // trajectory-bounded swimming — this margin keeps the clip from ever
  // touching a normally-swimming fish, while a fish dragged hard against the
  // true water edge is still contained.
  const clipMargin = FISH_WATER.width * 0.75;
  context.ellipse(
    0, 0,
    FISH_WATER.radiusX + clipMargin,
    FISH_WATER.radiusY + clipMargin,
    0, 0, TWO_PI
  );
  context.clip();
  context.rotate(-FISH_WATER.rotation);
  context.translate(-FISH_WATER.x, -FISH_WATER.y);

  const elapsedSeconds = millis() / 1000;
  const aliveStateAmount = smoothRange(constrain(treeTransition, 0, 1), 0, 1);
  // Canvas2D's `filter` blur is a full convolution pass, paid per draw call
  // it wraps — with up to maxFish fish each getting two passes (shadow +
  // body) every single frame, this was previously the one visual-quality
  // lever in this file that never checked getPerfTier(). Skipped outright on
  // the lowest tier: the tint/alpha depth treatment below still reads as
  // "underwater," just with a harder edge instead of a soft one.
  const blurEnabled = getPerfTier() !== "low";
  fishHitAreas = [];
  fishCurrentPosition = null;

  // Deeper fish render first so shallower fish naturally sit above them.
  const fishToDraw = [...fishPopulation].sort(
    (a, b) => (b.visualDepth ?? 0.35) - (a.visualDepth ?? 0.35)
  );
  for (const fish of fishToDraw) {
    const isDead = fish.status === "dead";
    const position = fish.position;
    if (!position) continue;
    const depth = constrain(fish.visualDepth ?? 0.35, 0, 1);
    const deathElapsed = isDead
      ? constrain(millis() - fish.deadAt, 0, FISH_BEHAVIOR.deadDuration)
      : 0;
    const deathStageDuration = FISH_BEHAVIOR.deathSinkStageDuration;
    const deathSinkDuration = deathStageDuration * 3;
    // No reveal mask for a sinking corpse: water tint/blur instead builds
    // continuously to 30%, 60%, and 90% at one-second intervals. Scale holds
    // at 100% through second one, then reaches 80% and 60% at seconds two and
    // three. Only after those sink stages finish does opacity begin fading.
    const deathBlendStrength = isDead
      ? constrain(deathElapsed / deathSinkDuration * 0.9, 0, 0.9)
      : 0;
    let deathScale = 1;
    if (isDead && deathElapsed > deathStageDuration) {
      if (deathElapsed <= deathStageDuration * 2) {
        deathScale = lerp(
          1,
          0.8,
          smoothRange(
            deathElapsed,
            deathStageDuration,
            deathStageDuration * 2
          )
        );
      } else {
        deathScale = lerp(
          0.8,
          0.6,
          smoothRange(
            deathElapsed,
            deathStageDuration * 2,
            deathSinkDuration
          )
        );
      }
    }
    const deathFadeProgress = isDead ? smoothRange(
      deathElapsed,
      deathSinkDuration,
      FISH_BEHAVIOR.deadDuration
    ) : 0;
    const blendDepth = isDead
      ? lerp(depth, 1, deathBlendStrength)
      : depth;
    const depthScale = lerp(1, 0.76, depth);
    // Static depth transparency is retained, but increasing water-blend
    // intensity does not itself lower opacity. That happens only after 3s.
    const fishAlpha = lerp(255, 178, depth);
    const blurAmount = lerp(0, 2.4, blendDepth);
    const spawnAmount = isDead
      ? 1 - deathFadeProgress
      : smoothRange(
          (millis() - fish.spawnedAt) / FISH_BEHAVIOR.spawnFadeDuration,
          0,
          1
        );
    const floatY = isDead
      ? sin(elapsedSeconds * 0.68 + fish.seed) * 5
      : 0;
    const deadTilt = isDead
      ? 0.11 + sin(elapsedSeconds * 0.42 + fish.seed) * 0.012
      : 0;
    const layers = [
      { state: 0, incoming: false },
      { state: 1, incoming: true }
    ];
    const pulse = isDead ? 1 : position.pulse;
    const spawnScale = isDead ? 1 : lerp(0.85, 1, spawnAmount);
    const visualScale = spawnScale * depthScale * deathScale;
    const rotation = FISH_WATER.rotation
      + (isDead ? deadTilt : position.wobble);
    const fishWidth = FISH_WATER.width;
    const fishHeight = fishWidth * fishMaxAspectRatio;

    if (!fishCurrentPosition) fishCurrentPosition = position;
    if (spawnAmount > 0.11) {
      fishHitAreas.push({
        id: fish.id,
        x: view.x + position.x * view.scale,
        y: view.y + position.y * view.scale,
        radiusX: FISH_WATER.width * view.scale * 0.52 * visualScale,
        radiusY: FISH_WATER.width * view.scale * 0.25 * visualScale
      });
    }

    if (!isDead) {
      drawFishTrail(fish, visualScale, depth);
    }

    // A soft, compressed silhouette settles the fish into the water without
    // giving it a hard drop-shadow edge. The blur hides the state switch.
    const shadowState = isDead ? 2 : aliveStateAmount < 0.5 ? 0 : 1;
    const shadowArtwork = fishStateArtwork[shadowState];
    if (shadowArtwork) {
      push();
      translate(
        position.x + lerp(7, 13, depth),
        position.y + floatY + lerp(12, 22, depth)
      );
      rotate(rotation);
      scale(
        position.facing * pulse * visualScale,
        visualScale / pulse
      );
      imageMode(CENTER);
      tint(15, 32, 38, lerp(34, 12, blendDepth) * spawnAmount);
      if (blurEnabled) {
        drawingContext.filter = `blur(${lerp(4, 9, blendDepth)}px)`;
      }
      const shadowHeight = fishWidth
        * (shadowArtwork.height / shadowArtwork.width);
      image(
        shadowArtwork,
        0,
        0,
        fishWidth * 1.05,
        shadowHeight * 0.8
      );
      if (blurEnabled) drawingContext.filter = "none";
      noTint();
      pop();
    }

    push();
    translate(position.x, position.y + floatY);
    rotate(rotation);
    scale(
      position.facing * pulse * visualScale,
      visualScale / pulse
    );
    imageMode(CENTER);
    const bounds = {
      x: -fishWidth / 2, y: -fishHeight / 2,
      w: fishWidth, h: fishHeight
    };
    const redMultiplier = lerp(255, 168, blendDepth);
    const greenMultiplier = lerp(255, 226, blendDepth);
    const blueMultiplier = lerp(255, 238, blendDepth);
    const bodyAlpha = fishAlpha * spawnAmount;
    if (isDead) {
      const artwork = fishStateArtwork[2];
      if (artwork) {
        const artworkHeight = fishWidth * (artwork.height / artwork.width);
        if (blurEnabled) drawingContext.filter = `blur(${blurAmount}px)`;
        tint(redMultiplier, greenMultiplier, blueMultiplier, bodyAlpha);
        image(artwork, 0, 0, fishWidth, artworkHeight);
        noTint();
        if (blurEnabled) drawingContext.filter = "none";
      }
    } else {
      if (blurEnabled) drawingContext.filter = `blur(${blurAmount}px)`;
      for (const layer of layers) {
        const artwork = fishStateArtwork[layer.state];
        if (!artwork) continue;
        const artworkHeight = fishWidth * (artwork.height / artwork.width);
        // drawStateReveal's drawArtwork(g) target is `window` only at the
        // two progress extremes; for the rest of a transition (which,
        // per state-reveal.js, is most of normal play) it's this channel's
        // own offscreen p5.Graphics buffer instead, which has its own
        // independent tint state — a tint() call made out here, on the
        // global instance, never reaches it. Setting it on `g` inside the
        // callback works for both targets (on `window` it's just the same
        // call the global one would have made), so the depth tint/alpha
        // this is meant to apply — including fishAlpha's own falloff,
        // fading a fish out as it gets deeper — actually takes effect
        // instead of silently no-op'ing for as long as the buffered path
        // is the one running.
        drawStateReveal(
          `fish-${fish.id}`, aliveStateAmount, bounds, fish.seed,
          layer.incoming,
          (g) => {
            g.imageMode(CENTER);
            g.tint(redMultiplier, greenMultiplier, blueMultiplier, bodyAlpha);
            g.image(artwork, 0, 0, fishWidth, artworkHeight);
            g.noTint();
          }
        );
      }
      if (blurEnabled) drawingContext.filter = "none";
    }
    pop();
  }
  context.restore();
  pop();
}
