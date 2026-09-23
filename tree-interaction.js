// Tree rendering and shared ecosystem interaction/health behavior.

function updateTreeTransition() {
  const transitionTarget = getTreeStateTarget();
  let speedMultiplier = millis() < clickTransitionBoostUntil
    ? TREE_TRANSITION.clickSpeedMultiplier
    : 1;
  // Below deadBelow (40%) — the same range getTreeStateTarget() now keeps
  // responsive down to slowUnhealthyStart(20%) instead of freezing at
  // fully-dead — movement runs at a reduced speed instead of the same rate
  // as everywhere else, so recovery starting this early reads as a soft
  // "just beginning" hint rather than an equally-fast animation. At
  // deadBelow and up, this is exactly the speed that already applied before
  // this change.
  if (ecosystemHealth < TREE_HEALTH_BANDS.deadBelow) {
    speedMultiplier *= TREE_TRANSITION.slowUnhealthySpeedMultiplier;
  }
  const transitionStep = deltaTime
    / (TREE_TRANSITION.hoverDuration * 1000)
    * speedMultiplier;
  const previousTransition = treeTransition;
  treeTransition += constrain(
    transitionTarget - treeTransition,
    -transitionStep,
    transitionStep
  );
  treeTransitionVelocity = abs(treeTransition - previousTransition)
    / max(deltaTime / 1000, 0.001);
}

function drawTreeLayer() {
  const targetHeight = height * TREE.scale;
  const treeX = width * TREE.x;
  const treeY = height * TREE.y;
  const elapsedSeconds = millis() / 1000;

  // Keep the complete assembly connected by applying a very small shared sway
  // around the base of the trunk. Parts add their own much smaller motion.
  const artworkScale = targetHeight / 1571;
  const rootX = 1034;
  const rootY = 1321;
  const rootDriftX = (noise(911, elapsedSeconds * 0.12) - 0.5) * 12;
  const rootDriftY = (noise(929, elapsedSeconds * 0.09) - 0.5) * 5;
  const rootSway = (noise(947, elapsedSeconds * 0.14) - 0.5) * 0.014;

  push();
  translate(
    treeX + rootX * artworkScale + rootDriftX,
    treeY + rootY * artworkScale + rootDriftY
  );
  rotate(TREE.rotation + rootSway);
  scale(artworkScale);
  translate(-rootX, -rootY);

  for (let i = 0; i < TREE_PARTS.length; i++) {
    drawTreePart(i, treeTransition, elapsedSeconds);
  }
  pop();
}

function getTreeStateTarget() {
  if (ecosystemHealth >= TREE_HEALTH_BANDS.healthyAbove) {
    return map(
      ecosystemHealth,
      ECOSYSTEM.maxHealth,
      TREE_HEALTH_BANDS.healthyAbove,
      0,
      1
    );
  }
  // Anchored at slowUnhealthyStart (20%), not TREE_HEALTH_BANDS.deadBelow
  // (40%) — a deliberate behavior change, not just a speed change: fully
  // dead (target 2) is now reached at 20% instead of 40%, so at exactly 40%
  // health this returns 1.6 (already 60% of the way from dead to unhealthy)
  // instead of the old flat 2. updateTreeTransition() is what keeps that
  // 20-40% stretch animating slowly instead of at full speed.
  if (ecosystemHealth >= TREE_TRANSITION.slowUnhealthyStart) {
    return map(
      ecosystemHealth,
      TREE_HEALTH_BANDS.healthyAbove,
      TREE_TRANSITION.slowUnhealthyStart,
      1,
      2
    );
  }
  return 2;
}

function getTreePartState(part, state) {
  return state === 0 ? part.healthy : state === 1 ? part.unhealthy : part.dead;
}

function getTreePartImage(index, state) {
  return state === 0
    ? treeHealthyParts[index]
    : state === 1
      ? treeUnhealthyParts[index]
      : treeDeadParts[index];
}

function getTreePartTransition(part, overallTransition) {
  // Transition 0 is healthy → unhealthy; transition 1 is unhealthy → dead.
  const fromState = min(1, floor(constrain(overallTransition, 0, 1.999999)));
  let progress = constrain(
    (overallTransition - fromState - part.delay) / (1 - part.delay),
    0,
    1
  );
  progress = progress * progress * (3 - 2 * progress);
  return { fromState, toState: fromState + 1, progress };
}

function drawTreePart(index, overallTransition, elapsedSeconds) {
  const part = TREE_PARTS[index];
  const placement = treePartPlacement[index] || makePlacementTransform();
  const { fromState, toState, progress } = getTreePartTransition(
    part,
    overallTransition
  );
  const from = getTreePartState(part, fromState);
  const to = getTreePartState(part, toState);
  const fromCenterX = from.x + from.w / 2;
  const fromCenterY = from.y + from.h / 2;
  const toCenterX = to.x + to.w / 2;
  const toCenterY = to.y + to.h / 2;
  const transitionArc = sin(PI * progress);

  let centerX = lerp(fromCenterX, toCenterX, progress);
  let centerY = lerp(fromCenterY, toCenterY, progress);
  centerX += transitionArc * part.arc * 85;
  centerY += transitionArc * abs(part.arc) * 65;

  const partWidth = lerp(from.w, to.w, progress);
  const partHeight = lerp(from.h, to.h, progress);
  const isLeaf = part.name.startsWith("leaf");
  const unhealthyAmount = min(1, fromState + progress);
  const motionAmount = (isLeaf ? 9 : 4) * lerp(1, 0.45, unhealthyAmount);
  const driftX = (noise(part.seed, elapsedSeconds * 0.18) - 0.5)
    * motionAmount * 2;
  const driftY = (noise(part.seed + 50, elapsedSeconds * 0.13) - 0.5)
    * motionAmount;
  const idleAngle = (noise(part.seed + 100, elapsedSeconds * 0.16) - 0.5)
    * (isLeaf ? 0.018 : 0.007);
  const angle = lerp(0, part.droop, unhealthyAmount)
    + transitionArc * part.arc
    + idleAngle;
  const squashX = 1 + transitionArc * part.pulse * 0.45;
  const squashY = 1 - transitionArc * part.pulse;

  // Hover-entry and click each trigger one finite vibration. A linear envelope
  // keeps the heavier displacement present before bringing it cleanly to rest.
  const phase = part.seed * 0.37;
  const vibration = treePartVibration[index];
  const vibrationAge = (millis() - vibration.startedAt) / 1000;
  const vibrationProgress = constrain(
    vibrationAge / TREE_INTERACTION.vibrationDuration,
    0,
    1
  );
  const shakeAmount = vibrationAge >= 0
    && vibrationAge < TREE_INTERACTION.vibrationDuration
    ? vibration.strength * (1 - vibrationProgress)
    : 0;
  const shakeX = sin(elapsedSeconds * TREE_INTERACTION.vibrationSpeed + phase)
    * shakeAmount;
  const shakeY = sin(elapsedSeconds * TREE_INTERACTION.vibrationSpeed * 1.37 + phase * 1.9)
    * shakeAmount * 0.72;
  const shakeAngle = sin(elapsedSeconds * TREE_INTERACTION.vibrationSpeed * 1.61 + phase)
    * shakeAmount * 0.0009;

  // Dragging behaves like pulling soft material: the selected component moves
  // slightly toward the pointer and stretches along the pull direction. The
  // same transform eases away after release instead of snapping back.
  let pullX = 0;
  let pullY = 0;
  if (treeDragging && activeTreePart === index) {
    const artworkScale = height * TREE.scale / 1571;
    pullX = (treePointerX - treePressX) / artworkScale;
    pullY = (treePointerY - treePressY) / artworkScale;
  } else if (treeDragRelease.part === index) {
    const releaseProgress = constrain(
      (millis() - treeDragRelease.startedAt)
        / (TREE_INTERACTION.releaseDuration * 1000),
      0,
      1
    );
    const releaseAmount = sq(1 - releaseProgress);
    pullX = treeDragRelease.x * releaseAmount;
    pullY = treeDragRelease.y * releaseAmount;
    if (releaseProgress >= 1) treeDragRelease.part = -1;
  }

  const pullDistance = sqrt(pullX * pullX + pullY * pullY);
  const stretch = constrain(
    pullDistance / TREE_INTERACTION.stretchDistance,
    0,
    TREE_INTERACTION.maxStretch
  );
  const pullAngle = pullDistance > 0.01 ? atan2(pullY, pullX) : 0;

  const fromImage = getTreePartImage(index, fromState);
  const toImage = getTreePartImage(index, toState);

  push();
  translate(
    centerX + placement.x + driftX + shakeX
      + pullX * TREE_INTERACTION.dragFollow,
    centerY + placement.y + driftY + shakeY
      + pullY * TREE_INTERACTION.dragFollow
  );
  rotate(pullAngle);
  scale(1 + stretch, 1 - stretch * 0.28);
  rotate(-pullAngle);
  rotate(angle + shakeAngle + placement.rotation);
  scale(squashX * placement.scale, squashY * placement.scale);
  imageMode(CENTER);

  const bounds = {
    x: -partWidth / 2, y: -partHeight / 2,
    w: partWidth, h: partHeight
  };
  if (fromImage) {
    drawStateReveal(`tree-${index}`, progress, bounds, part.seed, false, (g) => {
      g.imageMode(CENTER);
      g.image(fromImage, 0, 0, partWidth, partHeight);
    });
  }
  if (toImage) {
    drawStateReveal(`tree-${index}`, progress, bounds, part.seed, true, (g) => {
      g.imageMode(CENTER);
      g.image(toImage, 0, 0, partWidth, partHeight);
    });
  }
  pop();
}

function isPointerOverTree(pointerX, pointerY) {
  const treeHeight = height * TREE.scale;
  const treeWidth = treeHeight * (1577 / 1571);
  const treeX = width * TREE.x;
  const treeY = height * TREE.y;
  const artworkScale = treeHeight / 1571;
  const rootX = treeX + 1034 * artworkScale;
  const rootY = treeY + 1321 * artworkScale;
  const dx = pointerX - rootX;
  const dy = pointerY - rootY;
  const inverseCos = cos(-TREE.rotation);
  const inverseSin = sin(-TREE.rotation);
  const unrotatedX = rootX + dx * inverseCos - dy * inverseSin;
  const unrotatedY = rootY + dx * inverseSin + dy * inverseCos;

  const insideAssembly = unrotatedX >= treeX
    && unrotatedX <= treeX + treeWidth
    && unrotatedY >= treeY
    && unrotatedY <= treeY + treeHeight;
  if (insideAssembly) return true;

  // A component may be deliberately placed outside the original assembly.
  return TREE_PARTS.some((part, index) => {
    const bounds = getTreePartPlacementBounds(index);
    return bounds
      && pointerX >= bounds.x && pointerX <= bounds.x + bounds.w
      && pointerY >= bounds.y && pointerY <= bounds.y + bounds.h;
  });
}

// Returns the topmost component under the pointer. The inverse root transform
// keeps hit detection aligned with the tree's global position, scale and sway.
function getTreePartAt(pointerX, pointerY) {
  if (!isPointerOverTree(pointerX, pointerY)) return -1;

  const elapsedSeconds = millis() / 1000;
  const artworkScale = height * TREE.scale / 1571;
  const rootX = 1034;
  const rootY = 1321;
  const rootDriftX = (noise(911, elapsedSeconds * 0.12) - 0.5) * 12;
  const rootDriftY = (noise(929, elapsedSeconds * 0.09) - 0.5) * 5;
  const rootSway = TREE.rotation
    + (noise(947, elapsedSeconds * 0.14) - 0.5) * 0.014;
  const screenRootX = width * TREE.x + rootX * artworkScale + rootDriftX;
  const screenRootY = height * TREE.y + rootY * artworkScale + rootDriftY;
  const screenDX = pointerX - screenRootX;
  const screenDY = pointerY - screenRootY;
  const inverseCos = cos(-rootSway);
  const inverseSin = sin(-rootSway);
  const artworkX = (screenDX * inverseCos - screenDY * inverseSin)
    / artworkScale + rootX;
  const artworkY = (screenDX * inverseSin + screenDY * inverseCos)
    / artworkScale + rootY;

  // Reverse order matches the visual stacking order used by drawTreeLayer().
  for (let index = TREE_PARTS.length - 1; index >= 0; index--) {
    const part = TREE_PARTS[index];
    const placement = treePartPlacement[index] || makePlacementTransform();
    const { fromState, toState, progress } = getTreePartTransition(
      part,
      treeTransition
    );
    const from = getTreePartState(part, fromState);
    const to = getTreePartState(part, toState);
    const transitionArc = sin(PI * progress);
    const centerX = lerp(
      from.x + from.w / 2,
      to.x + to.w / 2,
      progress
    ) + transitionArc * part.arc * 85 + placement.x;
    const centerY = lerp(
      from.y + from.h / 2,
      to.y + to.h / 2,
      progress
    ) + transitionArc * abs(part.arc) * 65 + placement.y;
    const partWidth = lerp(from.w, to.w, progress) * placement.scale;
    const partHeight = lerp(from.h, to.h, progress) * placement.scale;
    const unhealthyAmount = min(1, fromState + progress);
    const angle = lerp(0, part.droop, unhealthyAmount)
      + transitionArc * part.arc + placement.rotation;
    const localDX = artworkX - centerX;
    const localDY = artworkY - centerY;
    const inversePartCos = cos(-angle);
    const inversePartSin = sin(-angle);
    const localX = localDX * inversePartCos - localDY * inversePartSin;
    const localY = localDX * inversePartSin + localDY * inversePartCos;

    if (abs(localX) <= partWidth / 2 && abs(localY) <= partHeight / 2) {
      return index;
    }
  }

  return -1;
}

function isPointerOverLilyPad(pointerX, pointerY) {
  // Include independently scattered pads: they also render in front of fish
  // but are not part of the main assembly's hover clusters. Delegates to
  // getLilyPadScatterExtraAt (vegetation.js) — the same hit test
  // beginPollutableInteraction uses to decide which specific pad to push
  // away — so the two never disagree once a pad has drifted from its idle
  // position.
  if (getLilyPadScatterExtraAt(pointerX, pointerY) !== -1) return true;

  for (const name of LILYPAD_EDITABLE_PARTS) {
    if ((name.startsWith("main") || name.startsWith("small"))
      && treeTransition >= 1.6) continue;
    const bounds = getLilyPartPlacementBounds(name);
    if (bounds
      && pointerX >= bounds.x && pointerX <= bounds.x + bounds.w
      && pointerY >= bounds.y && pointerY <= bounds.y + bounds.h) {
      return true;
    }
  }
  const elapsedSeconds = millis() / 1000;
  const vegetation = LILYPAD_VEGETATION;
  const idleMotion = getLilyPadIdleMotion(elapsedSeconds);
  const interactionMotion = getLilyPadInteractionMotion(elapsedSeconds);
  const artworkScale = width * vegetation.width / vegetation.masterWidth;
  const center = vegetation.radialCenter;
  const rootAngle = idleMotion.angle + interactionMotion.shakeAngle;
  const rootX = idleMotion.x + interactionMotion.shakeX
    + interactionMotion.pullX * TREE_INTERACTION.dragFollow;
  const rootY = idleMotion.y + interactionMotion.shakeY
    + interactionMotion.pullY * TREE_INTERACTION.dragFollow;

  let localX = pointerX - rootX;
  let localY = pointerY - rootY;
  const rootCos = cos(-rootAngle);
  const rootSin = sin(-rootAngle);
  const rotatedX = localX * rootCos - localY * rootSin;
  const rotatedY = localX * rootSin + localY * rootCos;
  localX = rotatedX / artworkScale;
  localY = rotatedY / artworkScale;

  const pullAngle = interactionMotion.pullDistance > 0.01
    ? atan2(interactionMotion.pullY, interactionMotion.pullX)
    : 0;
  const stretch = constrain(
    interactionMotion.pullDistance / TREE_INTERACTION.stretchDistance,
    0,
    TREE_INTERACTION.maxStretch
  );
  let centerX = localX - center.x;
  let centerY = localY - center.y;
  const pullCos = cos(-pullAngle);
  const pullSin = sin(-pullAngle);
  const alongPull = centerX * pullCos - centerY * pullSin;
  const acrossPull = centerX * pullSin + centerY * pullCos;
  const unstretchedX = alongPull / (1 + stretch);
  const unstretchedY = acrossPull / (1 - stretch * 0.28);
  const restoreCos = cos(pullAngle);
  const restoreSin = sin(pullAngle);
  centerX = unstretchedX * restoreCos - unstretchedY * restoreSin;
  centerY = unstretchedX * restoreSin + unstretchedY * restoreCos;

  const stateScale = getLilyPadAssemblyScale();
  localX = center.x + centerX / stateScale;
  localY = center.y + centerY / stateScale;
  for (const [name, cluster] of Object.entries(vegetation.hoverClusters)) {
    if ((name === "main" || name === "small") && treeTransition >= 1.6) {
      continue;
    }
    const drift = lilyPadHoverDrift.clusters[name];
    const normalizedX = (localX - cluster.x - drift.x) / cluster.radiusX;
    const normalizedY = (localY - cluster.y - drift.y) / cluster.radiusY;
    if (normalizedX * normalizedX + normalizedY * normalizedY <= 1) {
      return true;
    }
  }
  return false;
}

function isPointerOverFish(pointerX, pointerY) {
  return getFishAt(pointerX, pointerY) !== null;
}

// Grass is foreground but is not itself a separate interaction target. Its
// transformed bounds are still needed so covered fish do not receive the
// fish cursor or clicks through the artwork.
function isPointerOverGrass(pointerX, pointerY) {
  const deathScale = 1 - smoothRange(treeTransition, 1.02, 1.55);
  if (deathScale <= 0.001) return false;

  for (const patch of GRASS_PATCHES) {
    const patchWidth = width * patch.width;
    const patchHeight = patchWidth * (patch.sourceHeight / patch.sourceWidth);
    const unhealthyWidth = patchHeight
      * (patch.unhealthyWidth / patch.unhealthyHeight);
    const centerX = width * patch.x + patchWidth / 2;
    const centerY = height * patch.y + patchHeight;
    const dx = pointerX - centerX;
    const dy = pointerY - centerY;
    const inverseCos = cos(-patch.angle);
    const inverseSin = sin(-patch.angle);
    const localX = (dx * inverseCos - dy * inverseSin)
      / (patch.flipX * deathScale);
    const localY = (dx * inverseSin + dy * inverseCos) / deathScale;
    const hitWidth = max(patchWidth, unhealthyWidth);
    if (abs(localX) <= hitWidth / 2
      && localY >= -patchHeight && localY <= 0) return true;
  }
  return false;
}

function isPointerOverMoss(pointerX, pointerY) {
  for (let index = 0; index < MOSS_PARTS.length; index++) {
    const bounds = getMossPartPlacementBounds(index);
    if (bounds
      && pointerX >= bounds.x && pointerX <= bounds.x + bounds.w
      && pointerY >= bounds.y && pointerY <= bounds.y + bounds.h) {
      return true;
    }
  }
  const assembly = MOSS_ASSEMBLY;
  const original = placementDefaults && placementDefaults.moss;
  const originalX = original ? original.x : 0.07;
  const originalY = original ? original.y : 0.45;
  const originalWidth = original ? original.width : 0.76;
  const originalHeight = original ? original.height : 0.60;
  const dx = pointerX - width * assembly.x;
  const dy = pointerY - height * assembly.y;
  const inverseCos = cos(-assembly.rotation);
  const inverseSin = sin(-assembly.rotation);
  const localX = dx * inverseCos - dy * inverseSin;
  const localY = dx * inverseSin + dy * inverseCos;
  const scaleX = assembly.width / originalWidth;
  const scaleY = assembly.height / originalHeight;

  for (const area of MOSS_HIT_AREAS) {
    const areaX = (area.x - originalX) * width * scaleX;
    const areaY = (area.y - originalY) * height * scaleY;
    const normalizedX = (localX - areaX) / (area.radiusX * width * scaleX);
    const normalizedY = (localY - areaY) / (area.radiusY * height * scaleY);
    if (normalizedX * normalizedX + normalizedY * normalizedY <= 1) {
      return true;
    }
  }
  return false;
}

// Reuses the fish's own swimming ellipse as the open-water hit region — it's
// the only pond-shaped area already defined in the code, and it was placed to
// match the visible water surface. Adjust FISH_WATER in placement mode (P) if
// it ever needs to track the artwork more closely.
function isPointerOverWater(pointerX, pointerY) {
  const sourceX = (pointerX - view.x) / view.scale;
  const sourceY = (pointerY - view.y) / view.scale;
  const inverseCos = cos(-FISH_WATER.rotation);
  const inverseSin = sin(-FISH_WATER.rotation);
  const localX = (sourceX - FISH_WATER.x) * inverseCos
    - (sourceY - FISH_WATER.y) * inverseSin;
  const localY = (sourceX - FISH_WATER.x) * inverseSin
    + (sourceY - FISH_WATER.y) * inverseCos;
  return sq(localX / FISH_WATER.radiusX) + sq(localY / FISH_WATER.radiusY) <= 1;
}

function getPollutableTargetAt(pointerX, pointerY) {
  // Fish always win over whatever else the pointer happens to be above.
  // Lily pad / grass / tree hit tests are all generous, padded bounding
  // boxes (not pixel-accurate art), so a pond with any real coverage could
  // make fish swimming underneath essentially unclickable anywhere — the
  // player would need to land a click on open water within a fish's own
  // small hit ellipse, which is often nowhere to be found.
  const fishId = getFishAt(pointerX, pointerY);
  if (fishId !== null) return { object: "fish", part: fishId };
  if (isPointerOverLilyPad(pointerX, pointerY)) {
    return { object: "lilyPad", part: -1 };
  }
  if (isPointerOverMoss(pointerX, pointerY)) {
    return { object: "moss", part: -1 };
  }
  const treePart = getTreePartAt(pointerX, pointerY);
  if (treePart !== -1) return { object: "tree", part: treePart };
  if (isPointerOverWater(pointerX, pointerY)) return { object: "water", part: -1 };
  return { object: "none", part: -1 };
}

// Per-move reaction cues only (vibration, moss disturbance, audio,
// dialogue) — health damage from hovering is no longer decided here. It's
// now a continuous, time-based drain applied every frame the pointer sits
// over a pollutable object, independent of whether it's actively moving
// (see the hover branch in updateEcosystemHealth), so holding the pointer
// still over something drains health exactly as steadily as sweeping it
// around does.
function updatePollutableHover(pointerX, pointerY, activate, knownTarget = null) {
  treePointerX = pointerX;
  treePointerY = pointerY;
  if (!activate) return;
  // Accepts an already-computed target so callers that already ran the hit
  // test this event (mouseMoved etc. — see input-events.js) don't pay for
  // getPollutableTargetAt's tree/moss/lily/fish/water sweep a second time.
  const target = knownTarget || getPollutableTargetAt(pointerX, pointerY);
  handlePondHoverAudio(target);
  registerDialogueHoverEntry(target);

  if (target.object === "tree") {
    triggerTreeVibration(target.part, TREE_INTERACTION.hoverShake);
  } else if (target.object === "moss") {
    disturbMossAtPointer(pointerX, pointerY);
  }
  // lilyPad/water/fish/none: no extra per-move reaction beyond the
  // audio/dialogue cues above.
}

function pushLilyPadAwayFromPointer(pointerX, pointerY, strength = 1) {
  const vegetation = LILYPAD_VEGETATION;
  const idleMotion = getLilyPadIdleMotion(millis() / 1000);
  const artworkScale = width * vegetation.width / vegetation.masterWidth;
  const center = vegetation.radialCenter;
  const stateScale = getLilyPadAssemblyScale();
  const screenScale = artworkScale * stateScale;
  const driftDistance = min(width, height) * vegetation.hoverDriftDistance;
  const rootCos = cos(idleMotion.angle);
  const rootSin = sin(idleMotion.angle);

  for (const [name, cluster] of Object.entries(vegetation.hoverClusters)) {
    if (name === "main" || name === "small") continue;
    const drift = lilyPadHoverDrift.clusters[name];
    const transformedX = center.x
      + (cluster.x + drift.x - center.x) * stateScale;
    const transformedY = center.y
      + (cluster.y + drift.y - center.y) * stateScale;
    const clusterScreenX = idleMotion.x
      + (rootCos * transformedX - rootSin * transformedY) * artworkScale;
    const clusterScreenY = idleMotion.y
      + (rootSin * transformedX + rootCos * transformedY) * artworkScale;
    let awayX = clusterScreenX - pointerX;
    let awayY = clusterScreenY - pointerY;
    let awayDistance = sqrt(awayX * awayX + awayY * awayY);
    if (awayDistance < 1) {
      const fallbackAngle = millis() * 0.001 + vegetation.seed + cluster.bias;
      awayX = cos(fallbackAngle);
      awayY = sin(fallbackAngle);
      awayDistance = 1;
    }

    // Fan the groups slightly so overlapping pads do not travel in parallel.
    const awayAngle = atan2(awayY, awayX) + cluster.bias;
    const targetScreenDistance = driftDistance * cluster.distance * strength;
    const worldTargetX = cos(awayAngle) * targetScreenDistance;
    const worldTargetY = sin(awayAngle) * targetScreenDistance;
    // Convert the desired screen direction back into assembly coordinates.
    drift.targetX = (
      worldTargetX * rootCos + worldTargetY * rootSin
    ) / screenScale;
    drift.targetY = (
      -worldTargetX * rootSin + worldTargetY * rootCos
    ) / screenScale;
  }
  lilyPadHoverDrift.lastActivatedAt = millis();
}

function updateLilyPadHoverDrift() {
  const vegetation = LILYPAD_VEGETATION;
  const elapsedSeconds = min(deltaTime / 1000, 0.1);
  const idleFor = (millis() - lilyPadHoverDrift.lastActivatedAt) / 1000;
  const returning = idleFor > vegetation.hoverDriftHold;
  const returnAmount = returning
    ? exp(-elapsedSeconds / vegetation.hoverReturnDuration)
    : 1;
  const followAmount = 1 - exp(-elapsedSeconds * 4.2);

  for (const drift of Object.values(lilyPadHoverDrift.clusters)) {
    drift.targetX *= returnAmount;
    drift.targetY *= returnAmount;
    drift.x += (drift.targetX - drift.x) * followAmount;
    drift.y += (drift.targetY - drift.y) * followAmount;
    if (returning && abs(drift.x) < 0.02 && abs(drift.y) < 0.02) {
      drift.x = 0;
      drift.y = 0;
      drift.targetX = 0;
      drift.targetY = 0;
    }
  }
}

// Same push-away-then-spring-back behavior as pushLilyPadAwayFromPointer,
// applied to one individual scattered pad instead of the main assembly's
// clusters. Scattered pads live in plain screen space (see
// getLilyPadScatterExtraScreenPosition) with no nested assembly rotation/
// scale to undo, so this is simpler than the main-cluster version: just a
// screen-space away-vector and a matching drift offset.
function pushLilyPadScatterExtraAwayFromPointer(index, pointerX, pointerY, strength = 1) {
  const extra = lilyPadScatterExtras[index];
  const drift = lilyPadScatterDrift[index];
  if (!extra || !drift) return;
  const position = getLilyPadScatterExtraScreenPosition(index, millis() / 1000);
  let awayX = position.x - pointerX;
  let awayY = position.y - pointerY;
  let awayDistance = sqrt(awayX * awayX + awayY * awayY);
  if (awayDistance < 1) {
    const fallbackAngle = millis() * 0.001 + extra.phase;
    awayX = cos(fallbackAngle);
    awayY = sin(fallbackAngle);
    awayDistance = 1;
  }
  const awayAngle = atan2(awayY, awayX);
  const driftDistance = min(width, height) * LILYPAD_VEGETATION.hoverDriftDistance;
  const targetDistance = driftDistance * strength;
  drift.targetX = cos(awayAngle) * targetDistance;
  drift.targetY = sin(awayAngle) * targetDistance;
  drift.lastActivatedAt = millis();
}

function updateLilyPadScatterDrift() {
  const vegetation = LILYPAD_VEGETATION;
  const elapsedSeconds = min(deltaTime / 1000, 0.1);
  const followAmount = 1 - exp(-elapsedSeconds * 4.2);

  for (const drift of lilyPadScatterDrift) {
    const idleFor = (millis() - drift.lastActivatedAt) / 1000;
    const returning = idleFor > vegetation.hoverDriftHold;
    const returnAmount = returning
      ? exp(-elapsedSeconds / vegetation.hoverReturnDuration)
      : 1;
    drift.targetX *= returnAmount;
    drift.targetY *= returnAmount;
    drift.x += (drift.targetX - drift.x) * followAmount;
    drift.y += (drift.targetY - drift.y) * followAmount;
    if (returning && abs(drift.x) < 0.02 && abs(drift.y) < 0.02) {
      drift.x = 0;
      drift.y = 0;
      drift.targetX = 0;
      drift.targetY = 0;
    }
  }
}

function mossVariation(seed, channel) {
  const value = sin(seed * 12.9898 + channel * 78.233) * 43758.5453;
  return value - floor(value);
}

function disturbMossAtPointer(pointerX, pointerY, strength = 1) {
  for (let index = 0; index < mossGlide.parts.length; index++) {
    const bounds = getMossPartPlacementBounds(index);
    if (!bounds) continue;
    const centerX = bounds.x + bounds.w / 2;
    const centerY = bounds.y + bounds.h / 2;
    const radius = max(bounds.w, bounds.h) * 0.55
      + min(width, height) * 0.12;
    const proximity = constrain(
      1 - dist(pointerX, pointerY, centerX, centerY) / radius,
      0, 1
    );
    const glide = mossGlide.parts[index];
    if (proximity > 0 && glide.influence === 0) {
      glide.activatedAt = millis();
    }
    glide.influence = max(
      glide.influence,
      min(1, proximity * strength)
    );
  }
}

function updateMossGlide() {
  if (mossGlide.parts.length === 0) return;
  const elapsedSeconds = min(deltaTime / 1000, 0.1);
  if (treePointerDown && treeDragging
    && activePollutableObject === "moss") {
    disturbMossAtPointer(treePointerX, treePointerY);
  }
  const damageFraction = 1 - ecosystemHealth / ECOSYSTEM.maxHealth;
  const now = millis();

  for (const glide of mossGlide.parts) {
    const active = now >= glide.activatedAt
      + glide.responseDelay * 1000;
    // The shallow curve makes small disturbances visible while health still
    // controls the full shrink and recovery range.
    const targetScale = active
      ? max(
        MOSS_INTERACTION.minimumScale,
        1 - glide.influence * glide.responseStrength
          * (1 - MOSS_INTERACTION.minimumScale)
          * pow(damageFraction, 0.3)
      )
      : 1;
    const rate = targetScale < glide.scale
      ? glide.shrinkRate : glide.regrowthRate;
    glide.scale += (targetScale - glide.scale)
      * (1 - exp(-elapsedSeconds * rate));
    if (ecosystemHealth >= ECOSYSTEM.maxHealth
      && abs(glide.scale - 1) < 0.001) {
      glide.scale = 1;
      glide.influence = 0;
      glide.activatedAt = -Infinity;
    }
  }
}

function applyEcosystemDamage(amount, inputType, knownTarget = null) {
  ecosystemHealth = constrain(
    ecosystemHealth - amount,
    ECOSYSTEM.minHealth,
    ECOSYSTEM.maxHealth
  );
  lastEcosystemInputAt = millis();
  activeInputType = inputType;
  registerPollutionSource(treePointerX, treePointerY, inputType, knownTarget);
}

// Picks the ink deposit's visual style for this particular event: a discrete
// click/tap always reads as one concentrated splash regardless of what was
// clicked; continuous hover/drag over open water instead leaves a dragged,
// marbled swirl; continuous hover/drag over anything else (tree/moss/lily)
// keeps the original scattered-splotch look.
function getInkDepositStyle(inputType, target) {
  if (inputType === "click" || inputType === "touch") {
    return depositConcentratedSplash;
  }
  if (target.object === "water") return depositWaterSwirl;
  return depositInkSplat;
}

function registerPollutionSource(pointerX, pointerY, inputType, knownTarget = null) {
  // See applyEcosystemDamage's own knownTarget — avoids re-running the same
  // hit test the caller (click/hover) already ran this event/frame.
  const target = knownTarget || getPollutableTargetAt(pointerX, pointerY);
  if (!treePointerDown && target.object === "none") return;
  const depositFn = getInkDepositStyle(inputType, target);
  // Crossing the pond's own reveal boundary is the single most "alive"
  // moment to leave a mark — boosts both the visual ink deposit and the flow
  // smear there, tapering to no boost away from any active edge.
  const edgeBoost = target.object === "water"
    ? 1 + getPondRevealEdgeProximity(pointerX, pointerY)
      * INK_POLLUTION.edgeBoostStrength
    : 1;
  const normalizedX = constrain(pointerX / width, 0, 1);
  const normalizedY = constrain(pointerY / height, 0, 1);
  const previous = pollutionSources[pollutionSources.length - 1];
  const spacing = INK_POLLUTION.sourceSpacing;
  const previousX = previous ? previous.x * width : -Infinity;
  const previousY = previous ? previous.y * height : -Infinity;
  const distanceFromPrevious = previous
    ? dist(pointerX, pointerY, previousX, previousY)
    : Infinity;
  const now = millis();
  if (previous && distanceFromPrevious < spacing) {
    if (distanceFromPrevious > 0.5) {
      previous.direction = atan2(pointerY - previousY, pointerX - previousX);
    }
    previous.x = normalizedX;
    previous.y = normalizedY;
    previous.lastTouchedAt = now;
    // Runs every drag frame (not gated by depositInterval like the visual ink
    // splats below) — per-frame pointer motion is exactly what should drive
    // the flow field, and it's cheap enough not to need throttling.
    if (target.object === "water") {
      const speed = distanceFromPrevious / max(1, deltaTime);
      depositWaterFlow(
        pointerX, pointerY, previous.direction, speed,
        (treeDragging ? 1 : 0.7) * edgeBoost
      );
    }
    if (now - previous.lastDepositAt >= INK_POLLUTION.depositInterval) {
      depositFn(
        pointerX,
        pointerY,
        previous.direction,
        previous.seed + now * 0.013,
        (treeDragging ? 0.58 : 0.42) * edgeBoost
      );
      previous.lastDepositAt = now;
    }
    return;
  }

  const direction = previous
    ? atan2(pointerY - previousY, pointerX - previousX)
    : random(TWO_PI);
  const source = {
    x: normalizedX,
    y: normalizedY,
    direction,
    seed: random(1000),
    lastTouchedAt: now,
    lastDepositAt: now
  };
  pollutionSources.push(source);
  depositFn(pointerX, pointerY, direction, source.seed, edgeBoost);
  if (pollutionSources.length > INK_POLLUTION.maxSources) {
    pollutionSources.shift();
  }
}

function triggerTreeVibration(index, strength) {
  if (index < 0 || index >= treePartVibration.length) return;
  treePartVibration[index].startedAt = millis();
  treePartVibration[index].strength = strength;
}

// Passive idle recovery no longer runs at one flat rate across the whole
// range. Below deadBelow (dead/hostile band, recovering toward unhealthy) it
// starts at a 12% trickle and ramps up the longer the pond is left alone —
// 24% at 30s idle, 36% at 40s, 60% at 55s — rewarding patience instead of
// staying a flat crawl the whole time. idleSeconds is the same "time since
// last interaction" value already gating recovery itself (ECOSYSTEM.
// recoveryDelay), not a separate clock. Between deadBelow and healthyAbove
// (unhealthy, recovering toward healthy) it's a flat 50%, unaffected by
// idle time. healthyAbove and up is unaffected.
function getEcosystemRecoveryRateMultiplier(health, idleSeconds) {
  if (health < TREE_HEALTH_BANDS.deadBelow) {
    if (idleSeconds >= 55) return 0.6;
    if (idleSeconds >= 40) return 0.36;
    if (idleSeconds >= 30) return 0.24;
    return 0.12;
  }
  if (health < TREE_HEALTH_BANDS.healthyAbove) return 0.5;
  return 1;
}

function updateEcosystemHealth() {
  // Cap frame time so returning to the tab cannot apply one giant jump.
  const elapsedSeconds = min(deltaTime / 1000, 0.1);
  activeInputType = "none";

  if (treePointerDown && treeDragging) {
    applyEcosystemDamage(
      ECOSYSTEM.dragDamagePerSecond
        * ECOSYSTEM.inputMultiplier.drag
        * elapsedSeconds,
      "drag"
    );
    return;
  }

  // Continuous, time-based drain: unlike the old per-move-event model,
  // damage accrues smoothly by elapsed time rather than in fixed chunks per
  // mouse-move event, so sweeping the cursor slowly and quickly both drain
  // at the same real rate. It's still gated on recent movement
  // (hoverActiveWindowMs), though, not merely on where the cursor happens
  // to sit — treePointerX/Y stay wherever the cursor last was regardless of
  // whether it's moving, so without this gate a cursor simply left resting
  // over the pond (not actively swept around) would drain health and reset
  // the recovery-delay timer every frame forever, making recovery
  // structurally impossible any time the cursor rested over an interactive
  // area. Touch is deliberately excluded — touch has never had a hover
  // concept (it's press/drag only; see touchStarted/touchMoved), so only
  // true mouse hover (mouseHoverEnabled) counts here. Fish are excluded
  // too: fish death is click/drag-only (see fish.js), merely hovering one
  // has no effect.
  if (!treePointerDown && pondInteractionEnabled && mouseHoverEnabled
    && !placementMode && !pondMaskEditorMode
    && millis() - lastPointerMoveAt < ECOSYSTEM.hoverActiveWindowMs
    && treePointerX >= 0 && treePointerX <= width
    && treePointerY >= 0 && treePointerY <= height) {
    // Reuses the hit test mouseMoved() already ran for this same pointer
    // position (see cachedHoverTarget) instead of this running its own
    // fresh copy of the same tree/moss/lily/fish/water sweep every single
    // render frame — that redundant second hit test, active for as long as
    // hoverActiveWindowMs keeps this branch open, was roughly doubling this
    // function's cost throughout any actual hovering.
    const hoverTarget = cachedHoverTarget;
    if (hoverTarget.object !== "none" && hoverTarget.object !== "fish") {
      applyEcosystemDamage(
        ECOSYSTEM.hoverDamagePerSecond * elapsedSeconds,
        "hover",
        hoverTarget
      );
      return;
    }
  }

  const idleSeconds = (millis() - lastEcosystemInputAt) / 1000;
  if (idleSeconds >= ECOSYSTEM.recoveryDelay) {
    const recoveryPerSecond = ECOSYSTEM.maxHealth
      / ECOSYSTEM.fullRecoveryDuration
      * getEcosystemRecoveryRateMultiplier(ecosystemHealth, idleSeconds);
    ecosystemHealth = constrain(
      ecosystemHealth + recoveryPerSecond * elapsedSeconds,
      ECOSYSTEM.minHealth,
      ECOSYSTEM.maxHealth
    );
    if (ecosystemHealth >= ECOSYSTEM.maxHealth) {
      // Reaching 100% no longer hard-clears the ink buffers here — that
      // snapped any still-visible ink to fully gone instantly, which read
      // as a jump whenever recovery was fast enough that the ink's own
      // exponential decay (13s time constant, see updateInkPollution's
      // recoveryFadeSeconds) hadn't finished yet — invisible after a long
      // dead-band recovery (decay's had minutes to finish by then), but
      // obvious after a quick 80%->100% climb. inkActive stays true and
      // updateInkPollution() keeps fading it out on its own existing
      // schedule; its own idle-clear (INK_IDLE_CLEAR_MS) only ever snaps it
      // off once decay has already made it visually negligible anyway.
      // pollutionSources still resets here — that's just interaction
      // history, not a visible buffer, so clearing it has no jump to cause.
      pollutionSources = [];
    }
  }
}

function getEcosystemHealth() {
  return ecosystemHealth;
}

function getEcosystemBandLabel(health) {
  if (health > TREE_HEALTH_BANDS.healthyAbove) return "Healthy";
  if (health >= TREE_HEALTH_BANDS.deadBelow) return "Unhealthy";
  return "Dead";
}

// Debug only — toggled with H (see input-events.js: keyPressed()). Shows
// the same band boundaries and recovery multiplier
// getEcosystemRecoveryRateMultiplier() actually uses, so this doubles as a
// way to verify that tuning live instead of just reading the health number.
function drawDebugHealthStat() {
  const health = ecosystemHealth;
  const idleSeconds = (millis() - lastEcosystemInputAt) / 1000;
  const recovering = idleSeconds >= ECOSYSTEM.recoveryDelay;
  const multiplier = getEcosystemRecoveryRateMultiplier(health, idleSeconds);
  // treeTransition drives every object's actual visual state (lily pads,
  // moss, fish, the pond's own crossfade) — it only approaches
  // treeStateTarget gradually, frame by frame, so it can genuinely lag
  // behind ecosystemHealth rather than always matching it instantly.
  // Surfaced here so a health-vs-visual mismatch report can show both
  // numbers at once instead of guessing which one is wrong.
  const treeStateTarget = getTreeStateTarget();
  push();
  rectMode(CORNER);
  textAlign(LEFT, TOP);
  const panelWidth = 230;
  const panelHeight = 98;
  const x = width - panelWidth - 12;
  const y = 12;
  noStroke();
  fill(0, 205);
  rect(x, y, panelWidth, panelHeight, 8);
  fill("#FFE65A");
  textSize(14);
  text(
    `HEALTH  ${health.toFixed(1)}%  (${getEcosystemBandLabel(health)})`,
    x + 12, y + 10
  );
  fill(230);
  textSize(11);
  text(
    `idle: ${idleSeconds.toFixed(1)}s`
      + `   recovering: ${recovering ? "yes" : "no"}\n`
      + `recovery rate: x${multiplier}\n`
      + `treeTransition: ${treeTransition.toFixed(3)}`
      + `  (target ${treeStateTarget.toFixed(3)})`,
    x + 12, y + 34
  );
  pop();
}
