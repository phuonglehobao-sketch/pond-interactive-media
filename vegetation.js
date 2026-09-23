// Moss, grass, lily-pad rendering, artwork transitions, and visual helpers.

function createPlantCluster(x, y, plantScale, seed, depth) {
  randomSeed(seed);
  const blades = [];
  for (let i = 0; i < 12; i++) {
    // Keep the original seeded random sequence, but evaluate it just once.
    const offsetX = random(-42, 42);
    const bladeScale = random(0.45, 1.65);
    const bladeHeight = random(70, 250) * bladeScale;
    const thickness = lerp(1.1, 10.5, pow(random(), 2.2));
    const lean = random(-0.20, 0.20);
    const direction = random() < 0.5 ? -1 : 1;
    const lowerBend = random(0.04, 0.18) * bladeHeight * direction;
    const hookWidth = random(0.30, 0.68) * bladeHeight;
    const shoulderY = -bladeHeight * random(0.62, 0.72);
    const crownY = -bladeHeight * random(0.98, 1.16);
    const hookEndY = -bladeHeight * random(0.56, 0.74);
    const leafT = random(0.76, 0.98);
    const leafShape = floor(random(4));
    const outerSizeScale = lerp(0.50, 2, pow(random(), 2));
    const sizes = [[16, 42], [10, 64], [17, 46], [22, 34]];
    const angleOffset = HALF_PI + random(-0.32, 0.32);
    const control1X = lowerBend + hookWidth * 0.10 * direction;
    const control2X = lowerBend + hookWidth * 0.76 * direction;
    const endX = lowerBend + hookWidth * direction;
    const tangentX = bezierTangent(lowerBend, control1X, control2X, endX, leafT);
    const tangentY = bezierTangent(shoulderY, crownY, crownY, hookEndY, leafT);
    blades.push({
      index: i, offsetX, thickness, lean, lowerBend, shoulderY, crownY, hookEndY,
      control1X, control2X, endX,
      lowerControl1X: lowerBend * 0.08,
      lowerControl1Y: -bladeHeight * 0.24,
      lowerControl2Y: -bladeHeight * 0.52,
      leafX: bezierPoint(lowerBend, control1X, control2X, endX, leafT),
      leafY: bezierPoint(shoulderY, crownY, crownY, hookEndY, leafT),
      // The crown's first three x coordinates move by 0.22*sway;
      // its end moves by another sway. Cache the corresponding cubic weights.
      leafSway: 0.22 + leafT * leafT * leafT,
      tangentSway: 3 * leafT * leafT,
      tangentX, tangentY, angleOffset,
      restAngle: atan2(tangentY, tangentX) + angleOffset,
      leafWidth: sizes[leafShape][0] * outerSizeScale,
      leafHeight: sizes[leafShape][1] * outerSizeScale,
      leafShape,
      palette: getLeafPalette(depth, i),
      stemColor: getStemColor(depth, i)
    });
  }
  return { x, y, scale: plantScale, seed, blades };
}

function drawVegetation() {
  push();
  translate(view.x, view.y);
  scale(view.scale);
  // Soft light lets the saturated plant blobs inherit the pond lighting.
  blendMode(SOFT_LIGHT);
  for (const plant of plants) {
    push();
    translate(plant.x, plant.y);
    scale(plant.scale);
    drawWaterRipples(plant.seed);
    for (const blade of plant.blades) {
      const sway = sin(frameCount * 0.025 + blade.index * 0.7 + plant.seed) * 12;
      const shoulderShift = sway * 0.22;
      const shoulderX = blade.lowerBend + shoulderShift;
      push();
      translate(blade.offsetX, 0);
      rotate(blade.lean);
      noFill();
      stroke(blade.stemColor);
      strokeWeight(blade.thickness);
      strokeCap(ROUND);
      bezier(0, 0, blade.lowerControl1X, blade.lowerControl1Y,
        shoulderX * 0.78, blade.lowerControl2Y, shoulderX, blade.shoulderY);
      bezier(shoulderX, blade.shoulderY,
        blade.control1X + shoulderShift, blade.crownY,
        blade.control2X + shoulderShift, blade.crownY,
        blade.endX + shoulderShift + sway, blade.hookEndY);
      translate(blade.leafX + blade.leafSway * sway, blade.leafY);
      rotate(atan2(blade.tangentY, blade.tangentX + blade.tangentSway * sway) + blade.angleOffset);
      image(blade.sprite, -blade.sprite.width / 2, -blade.sprite.height / 2);
      pop();
    }
    pop();
  }
  blendMode(BLEND);
  pop();
}

function drawMossAssembly() {
  const blend = getImportedStateBlend();
  const assembly = MOSS_ASSEMBLY;
  const assemblyScaleX = width * assembly.width / assembly.masterWidth;
  const assemblyScaleY = height * assembly.height / assembly.masterHeight;

  push();
  translate(width * assembly.x, height * assembly.y);
  rotate(assembly.rotation);
  for (let index = 0; index < MOSS_PARTS.length; index++) {
    const part = MOSS_PARTS[index];
    const placement = mossPartPlacement[index] || makePlacementTransform();
    const glide = mossGlide.parts[index] || { scale: 1 };
    const artworkStates = mossStateArtwork[index];

    push();
    scale(assemblyScaleX, assemblyScaleY);
    translate(
      part.pivot.x + placement.x,
      part.pivot.y + placement.y
    );
    rotate(placement.rotation);
    scale(placement.scale * glide.scale);
    imageMode(CORNER);
    const bounds = {
      x: -part.pivot.x,
      y: -part.pivot.y,
      w: part.sizes[0].w,
      h: part.sizes[0].h
    };
    for (const layer of blend.layers) {
      const artwork = artworkStates[layer.state];
      if (!artwork) continue;
      const stateOffset = part.offsets[layer.state];
      const stateSize = part.sizes[layer.state];
      const stateRegions = part.regions && part.regions[layer.state];
      drawStateReveal(
        `moss-${index}`, blend.progress, bounds, part.seed,
        layer.state === blend.toState,
        (g) => {
          g.push();
          g.scale(layer.scale);
          if (stateRegions) {
            for (const region of stateRegions) {
              const source = region.source;
              const drawArtwork = () => {
                g.image(
                  artwork,
                  region.x - part.pivot.x,
                  region.y - part.pivot.y + layer.offsetY / assemblyScaleY,
                  source.w,
                  source.h,
                  source.x / stateSize.w * artwork.width,
                  source.y / stateSize.h * artwork.height,
                  source.w / stateSize.w * artwork.width,
                  source.h / stateSize.h * artwork.height
                );
              };
              // drawLongCastShadow only paints the tinted shadow copies —
              // unlike the native-shadow technique it replaced, it doesn't
              // also draw the real object as a side effect, so the actual
              // artwork still needs its own draw call on top.
              drawLongCastShadow(g, VEGETATION_SHADOWS.moss, drawArtwork);
              drawArtwork();
            }
          } else {
            const drawArtwork = () => {
              g.image(
                artwork,
                stateOffset.x - part.pivot.x,
                stateOffset.y - part.pivot.y
                  + layer.offsetY / assemblyScaleY,
                stateSize.w,
                stateSize.h
              );
            };
            drawLongCastShadow(g, VEGETATION_SHADOWS.moss, drawArtwork);
            drawArtwork();
          }
          g.pop();
        }
      );
    }
    pop();
  }
  pop();
}

function drawGrassPatches() {
  if (grassArtwork.length === 0) return;
  const unhealthyAmount = smoothRange(treeTransition, 0.12, 0.94);
  const deathScale = 1 - smoothRange(treeTransition, 1.02, 1.55);
  if (deathScale <= 0.001) return;

  for (let index = 0; index < GRASS_PATCHES.length; index++) {
    const patch = GRASS_PATCHES[index];
    const artworkStates = grassArtwork[index];
    const healthyArtwork = artworkStates && artworkStates[0];
    const unhealthyArtwork = artworkStates && artworkStates[1];
    if (!healthyArtwork) continue;
    const patchWidth = width * patch.width;
    const patchHeight = patchWidth
      * (patch.sourceHeight / patch.sourceWidth);

    push();
    translate(
      width * patch.x + patchWidth / 2,
      height * patch.y + patchHeight
    );
    rotate(patch.angle);
    scale(patch.flipX * deathScale, deathScale);
    imageMode(CORNER);
    const unhealthyHeight = patchHeight;
    const unhealthyWidth = unhealthyArtwork
      ? unhealthyHeight * (patch.unhealthyWidth / patch.unhealthyHeight)
      : patchWidth;
    const bounds = {
      x: -max(patchWidth, unhealthyWidth) / 2,
      y: -patchHeight,
      w: max(patchWidth, unhealthyWidth),
      h: patchHeight
    };
    drawStateReveal(
      `grass-${index}`, unhealthyAmount,
      bounds, patch.seed, false, (g) => {
      drawWithVegetationShadow(g, VEGETATION_SHADOWS.grass, () => {
        g.image(
          healthyArtwork,
          -patchWidth / 2,
          -patchHeight,
          patchWidth,
          patchHeight
        );
      });
      },
      !unhealthyArtwork
    );
    if (unhealthyArtwork) {
      drawStateReveal(
        `grass-${index}`, unhealthyAmount, bounds, patch.seed, true, (g) => {
          drawWithVegetationShadow(g, VEGETATION_SHADOWS.grass, () => {
            g.image(
              unhealthyArtwork,
              -unhealthyWidth / 2,
              -unhealthyHeight,
              unhealthyWidth,
              unhealthyHeight
            );
          });
        }
      );
    }
    pop();
  }
}

function drawForegroundGrass() {
  if (foregroundGrassArtwork.length === 0) return;
  const blend = getImportedStateBlend();
  const elapsedSeconds = millis() / 1000;
  const fromState = blend.layers[0].state;
  const toState = blend.layers[1].state;

  for (let index = 0; index < FOREGROUND_GRASS_PARTS.length; index++) {
    const part = FOREGROUND_GRASS_PARTS[index];
    const artworkStates = foregroundGrassArtwork[index];
    if (!artworkStates) continue;

    const phase = part.seed * 0.037;
    const sway = sin(TWO_PI * elapsedSeconds * part.speed + phase) * part.sway
      + sin(
        TWO_PI * elapsedSeconds * part.speed * 0.43 + phase * 1.71
      ) * part.sway * 0.32;

    push();
    translate(width * part.x, height * part.y);
    rotate(part.rotation + sway);
    imageMode(CORNER);

    const drawHeight = height * part.height;
    let left = 0;
    let right = 0;
    let top = 0;
    let bottom = 0;
    for (const sourceSize of part.sizes) {
      if (!sourceSize) continue;
      const stateWidth = drawHeight * sourceSize.w / sourceSize.h;
      left = min(left, -stateWidth * part.anchorX);
      right = max(right, stateWidth * (1 - part.anchorX));
      top = min(top, -drawHeight * part.anchorY);
      bottom = max(bottom, drawHeight * (1 - part.anchorY));
    }
    const bounds = { x: left, y: top, w: right - left, h: bottom - top };
    const drawState = (state, g) => {
      const artwork = artworkStates[state];
      const sourceSize = part.sizes[state];
      if (!artwork || !sourceSize) return;
      const drawWidth = drawHeight * sourceSize.w / sourceSize.h;
      const drawX = -drawWidth * part.anchorX;
      const drawY = -drawHeight * part.anchorY;
      drawWithVegetationShadow(g, VEGETATION_SHADOWS.grass, () => {
        g.image(artwork, drawX, drawY, drawWidth, drawHeight);
      });
    };
    const outgoingArtwork = artworkStates[fromState];
    const incomingArtwork = artworkStates[toState];
    const revealId = `foreground-grass-${index}-${fromState}`;

    if (outgoingArtwork) {
      drawStateReveal(
        revealId,
        blend.progress,
        bounds,
        part.seed + fromState * 17,
        false,
        (g) => drawState(fromState, g),
        !incomingArtwork
      );
    }
    if (incomingArtwork) {
      drawStateReveal(
        revealId,
        blend.progress,
        bounds,
        part.seed + fromState * 17,
        true,
        (g) => drawState(toState, g)
      );
    }
    pop();
  }
}

function getImportedStateBlend() {
  const transition = constrain(treeTransition, 0, 2);
  const fromState = min(1, floor(min(transition, 1.999999)));
  const progress = transition - fromState;
  const eased = progress * progress * (3 - 2 * progress);
  return {
    toState: fromState + 1,
    progress: eased,
    layers: [
      {
        state: fromState,
        scale: lerp(1, 0.96, eased),
        offsetY: eased * 7
      },
      {
        state: fromState + 1,
        scale: lerp(0.96, 1, eased),
        offsetY: (1 - eased) * 7
      }
    ]
  };
}

// ---------------------------------------------------------------------------
// LILY PAD SCATTER
// The main LILYPAD_VEGETATION group's own starting position, plus a handful
// of extra decorative single-pad instances, randomized once per device and
// persisted in localStorage so a reload on the same browser keeps the same
// layout (see LILYPAD_SCATTER in sketch.js).

function loadLilyPadScatter() {
  try {
    const raw = localStorage.getItem(LILYPAD_SCATTER.storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("Could not load lily pad scatter", error);
    return null;
  }
}

function saveLilyPadScatter(scatter) {
  try {
    localStorage.setItem(LILYPAD_SCATTER.storageKey, JSON.stringify(scatter));
  } catch (error) {
    console.warn("Could not save lily pad scatter", error);
  }
}

// A random point inside one of LILYPAD_SAFE_ZONES (sketch.js), weighted so
// the primary zone is picked far more often than the secondary one — already
// in viewport-fraction space, so no camera/view math needed here at all.
function pickLilyPadSafeZone() {
  const totalWeight = LILYPAD_SAFE_ZONES.reduce(
    (sum, zone) => sum + zone.weight, 0
  );
  let roll = random(totalWeight);
  for (const zone of LILYPAD_SAFE_ZONES) {
    if (roll < zone.weight) return zone;
    roll -= zone.weight;
  }
  return LILYPAD_SAFE_ZONES[0];
}

function randomPointInWater() {
  const zone = pickLilyPadSafeZone();
  return {
    x: zone.x + random(zone.w),
    y: zone.y + random(zone.h)
  };
}

// Rejection-samples randomPointInWater() until it finds a point whose
// distance to every already-placed pad is at least the sum of both pads'
// own "personal space" radii (see LILYPAD_SCATTER.spacingRadiusFactor) plus
// a fixed padding — size-aware, unlike a flat minimum distance, which let a
// wide pad and a narrow pad still land on top of each other as long as their
// centers cleared some constant. Falls back to the most spread-out (least
// negative slack) candidate tried if nothing fully clears within the
// attempt budget, rather than stacking blindly or looping forever.
function randomPointAwayFromExisting(existingPoints, radius) {
  const maxAttempts = 120;
  let bestPoint = null;
  let bestSlack = -Infinity;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = randomPointInWater();
    let minSlack = Infinity;
    for (const existing of existingPoints) {
      const required = existing.radius + radius + LILYPAD_SCATTER.spacingPadding;
      const actual = dist(candidate.x, candidate.y, existing.x, existing.y);
      minSlack = min(minSlack, actual - required);
    }
    if (minSlack >= 0) return candidate;
    if (minSlack > bestSlack) {
      bestSlack = minSlack;
      bestPoint = candidate;
    }
  }
  return bestPoint;
}

function generateLilyPadScatter() {
  const placed = [];
  // The main group's own visual footprint is much larger than one
  // individual pad, but its exclusion radius uses a much smaller factor
  // (mainSpacingRadiusFactor) than extra-to-extra pairs do, so it doesn't
  // dominate the small zone's budget all by itself.
  const mainExclusion = LILYPAD_VEGETATION.width
    * LILYPAD_SCATTER.mainSpacingRadiusFactor;
  const main = randomPointAwayFromExisting(placed, mainExclusion);
  placed.push({ x: main.x, y: main.y, radius: mainExclusion });

  const extras = [];
  // Exact composition (see LILYPAD_SCATTER_COMPOSITION) — only position and
  // size are randomized per instance, not which types appear or how many.
  for (const entry of LILYPAD_SCATTER_COMPOSITION) {
    for (let i = 0; i < entry.count; i++) {
      // A multiplier against LILYPAD_VEGETATION.width, not an absolute
      // viewport fraction — resolved again at draw time in
      // drawLilyPadScatterExtras, so the two stay in sync if that width
      // is ever edited.
      const sizeFraction = random(
        LILYPAD_SCATTER.minSizeFraction, LILYPAD_SCATTER.maxSizeFraction
      );
      const radius = LILYPAD_VEGETATION.width * sizeFraction
        * LILYPAD_SCATTER.spacingRadiusFactor;
      const point = randomPointAwayFromExisting(placed, radius);
      placed.push({ x: point.x, y: point.y, radius });
      extras.push({
        artIndex: entry.fileIndex,
        x: point.x,
        y: point.y,
        sizeFraction,
        phase: random(1000)
      });
    }
  }
  return { main, extras };
}

function applyLilyPadScatter(scatter) {
  LILYPAD_VEGETATION.x = scatter.main.x;
  LILYPAD_VEGETATION.y = scatter.main.y;
  lilyPadScatterExtras = scatter.extras;
  lilyPadScatterDrift = scatter.extras.map(() => (
    { x: 0, y: 0, targetX: 0, targetY: 0, lastActivatedAt: -Infinity }
  ));
}

// Called once from setup(). No longer needs to run after rebuildCaches() —
// LILYPAD_SAFE_ZONES is plain viewport-fraction space, not camera-relative —
// but stays where it is since that's still a harmless, correct place for it.
function initializeLilyPadScatter() {
  let scatter = loadLilyPadScatter();
  if (!scatter || !scatter.main || !Array.isArray(scatter.extras)) {
    scatter = generateLilyPadScatter();
    saveLilyPadScatter(scatter);
  }
  applyLilyPadScatter(scatter);
}

// Debug-only: forces a brand new random layout regardless of what's
// currently stored, for iterating on placement without a full page reload
// (which would also reset ecosystem health/dialogue history). Wired to the
// placement-mode "Reroll lily pads" button — see placement-editor.js.
function regenerateLilyPadScatter() {
  const scatter = generateLilyPadScatter();
  saveLilyPadScatter(scatter);
  applyLilyPadScatter(scatter);
}

function getLilyPadScatterIdleMotion(extra, elapsedSeconds) {
  const floatX = sin(
    TWO_PI * elapsedSeconds * LILYPAD_SCATTER.speed + extra.phase
  ) * LILYPAD_SCATTER.range;
  const floatY = sin(
    TWO_PI * elapsedSeconds * LILYPAD_SCATTER.speed * 0.7 + extra.phase * 1.3
  ) * LILYPAD_SCATTER.bob;
  return { x: width * extra.x + floatX, y: height * extra.y + floatY };
}

// Idle motion plus this pad's own push-away/spring-back offset (see
// pushLilyPadScatterExtraAwayFromPointer / updateLilyPadScatterDrift in
// tree-interaction.js) — the single source of truth for where a scattered
// pad actually is on screen, shared by both drawing and hit-testing so the
// two never disagree once a pad has drifted.
function getLilyPadScatterExtraScreenPosition(index, elapsedSeconds) {
  const extra = lilyPadScatterExtras[index];
  const motion = getLilyPadScatterIdleMotion(extra, elapsedSeconds);
  const drift = lilyPadScatterDrift[index] || { x: 0, y: 0 };
  return { x: motion.x + drift.x, y: motion.y + drift.y };
}

// Which scattered pad (if any) sits under the pointer, topmost-drawn first
// — used both by isPointerOverLilyPad (tree-interaction.js, which only
// needs yes/no) and by beginPollutableInteraction (input-events.js, which
// needs to know WHICH pad to push away). Pads whose current state has
// dissolved are excluded, matching drawLilyPadScatterExtras.
function getLilyPadScatterExtraAt(pointerX, pointerY) {
  const blend = getImportedStateBlend();
  const fromState = blend.layers[0].state;
  const toState = blend.layers[1].state;
  const elapsedSeconds = millis() / 1000;
  for (let index = lilyPadScatterExtras.length - 1; index >= 0; index--) {
    const extra = lilyPadScatterExtras[index];
    const artworkStates = individualLilyPadArtwork[extra.artIndex];
    if (!artworkStates) continue;
    const outgoingArtwork = artworkStates[fromState];
    const incomingArtwork = artworkStates[toState];
    const approximateVisibility = (outgoingArtwork ? 1 - blend.progress : 0)
      + (incomingArtwork ? blend.progress : 0);
    if (approximateVisibility < 0.04) continue;
    const artwork = incomingArtwork && blend.progress >= 0.5
      ? incomingArtwork
      : outgoingArtwork || incomingArtwork;
    if (!artwork) continue;
    const position = getLilyPadScatterExtraScreenPosition(index, elapsedSeconds);
    const drawWidth = width * LILYPAD_VEGETATION.width * extra.sizeFraction;
    const drawHeight = drawWidth * (artwork.height / artwork.width);
    const normalizedX = (pointerX - position.x) / (drawWidth * 0.5);
    const normalizedY = (pointerY - position.y) / (drawHeight * 0.5);
    if (normalizedX * normalizedX + normalizedY * normalizedY <= 1) {
      return index;
    }
  }
  return -1;
}

function drawLilyPadScatterExtras() {
  if (lilyPadScatterExtras.length === 0) return;
  if (individualLilyPadArtwork.length === 0) return;
  const elapsedSeconds = millis() / 1000;
  const blend = getImportedStateBlend();
  const fromState = blend.layers[0].state;
  const toState = blend.layers[1].state;

  lilyPadScatterExtras.forEach((extra, index) => {
    const artworkStates = individualLilyPadArtwork[extra.artIndex];
    if (!artworkStates) return;
    const outgoingArtwork = artworkStates[fromState];
    const incomingArtwork = artworkStates[toState];
    if (!outgoingArtwork && !incomingArtwork) return;
    const position = getLilyPadScatterExtraScreenPosition(index, elapsedSeconds);
    const drawWidth = width * LILYPAD_VEGETATION.width * extra.sizeFraction;
    const stateHeights = artworkStates
      .filter((artwork) => artwork)
      .map((artwork) => drawWidth * artwork.height / artwork.width);
    const maxDrawHeight = max(stateHeights);
    // Same pattern as drawFish(): translate to the object's position first,
    // then bounds/the artwork draw are relative to that local origin — this
    // is what makes drawStateReveal's offscreen-buffer path line up with its
    // direct-to-canvas fallback.
    const bounds = {
      x: -drawWidth / 2,
      y: -maxDrawHeight / 2,
      w: drawWidth,
      h: maxDrawHeight
    };
    push();
    translate(position.x, position.y);
    imageMode(CENTER);
    const drawState = (state, g) => {
      const artwork = artworkStates[state];
      if (!artwork) return;
      const drawHeight = drawWidth * artwork.height / artwork.width;
      g.imageMode(CENTER);
      const drawArtwork = () => {
        g.image(artwork, 0, 0, drawWidth, drawHeight);
      };
      // drawLongCastShadow only paints the tinted shadow copies — the real
      // artwork still needs its own draw call on top.
      drawLongCastShadow(g, VEGETATION_SHADOWS.lilyPad, drawArtwork);
      drawArtwork();
    };
    const revealId = `lily-scatter-${index}-${fromState}`;
    const revealSeed = extra.phase + fromState * 29;
    if (outgoingArtwork) {
      drawStateReveal(
        revealId,
        blend.progress,
        bounds,
        revealSeed,
        false,
        (g) => drawState(fromState, g),
        !incomingArtwork
      );
    }
    if (incomingArtwork) {
      drawStateReveal(
        revealId,
        blend.progress,
        bounds,
        revealSeed,
        true,
        (g) => drawState(toState, g)
      );
    }
    pop();
  });
}

function drawImportedLilyPads() {
  const elapsedSeconds = millis() / 1000;
  const vegetation = LILYPAD_VEGETATION;
  const idleMotion = getLilyPadIdleMotion(elapsedSeconds);
  const interactionMotion = getLilyPadInteractionMotion(elapsedSeconds);
  const artworkScale = width * vegetation.width / vegetation.masterWidth;
  const center = vegetation.radialCenter;
  const pullAngle = interactionMotion.pullDistance > 0.01
    ? atan2(interactionMotion.pullY, interactionMotion.pullX)
    : 0;
  const stretch = constrain(
    interactionMotion.pullDistance / TREE_INTERACTION.stretchDistance,
    0,
    TREE_INTERACTION.maxStretch
  );
  const stateScale = getLilyPadAssemblyScale();
  const stateBlend = getLilyPadStateBlend();

  push();
  translate(
    idleMotion.x + interactionMotion.shakeX
      + interactionMotion.pullX * TREE_INTERACTION.dragFollow,
    idleMotion.y + interactionMotion.shakeY
      + interactionMotion.pullY * TREE_INTERACTION.dragFollow
  );
  rotate(idleMotion.angle + interactionMotion.shakeAngle);
  scale(artworkScale);
  translate(center.x, center.y);
  rotate(pullAngle);
  scale(1 + stretch, 1 - stretch * 0.28);
  rotate(-pullAngle);
  scale(stateScale);
  translate(-center.x, -center.y);
  imageMode(CORNER);

  drawLilyPadVegetationSample(stateBlend);
  pop();
}

function getLilyPadIdleMotion(elapsedSeconds) {
  const vegetation = LILYPAD_VEGETATION;
  const phase = vegetation.seed * 0.37;
  const floatX = sin(TWO_PI * elapsedSeconds * vegetation.speed + phase)
    * vegetation.range
    + sin(TWO_PI * elapsedSeconds * vegetation.speed * 0.41 + phase * 1.8)
      * vegetation.range * 0.35;
  const floatY = sin(
    TWO_PI * elapsedSeconds * vegetation.speed * 0.63 + phase * 0.8
  ) * vegetation.bob;
  const floatAngle = sin(
    TWO_PI * elapsedSeconds * vegetation.speed * 0.47 + phase * 1.4
  ) * vegetation.tilt;
  return {
    x: width * vegetation.x + floatX,
    y: height * vegetation.y + floatY,
    angle: vegetation.rotation + floatAngle
  };
}

function getLilyPadInteractionMotion(elapsedSeconds) {
  let pullX = 0;
  let pullY = 0;
  if (treeDragging && activePollutableObject === "lilyPad") {
    pullX = treePointerX - treePressX;
    pullY = treePointerY - treePressY;
  } else {
    const releaseProgress = constrain(
      (millis() - lilyPadDragRelease.startedAt)
        / (TREE_INTERACTION.releaseDuration * 1000),
      0,
      1
    );
    if (releaseProgress < 1) {
      const releaseAmount = sq(1 - releaseProgress);
      pullX = lilyPadDragRelease.x * releaseAmount;
      pullY = lilyPadDragRelease.y * releaseAmount;
    }
  }

  return {
    pullX,
    pullY,
    pullDistance: sqrt(pullX * pullX + pullY * pullY),
    shakeX: 0,
    shakeY: 0,
    shakeAngle: 0
  };
}

function drawLilyPadVegetationSample(blend) {
  push();
  // Back pads sit below the plants. Only the front pad sheet is drawn over the
  // stems and flowers, keeping the intended yellow-pad occlusion during motion.
  drawLilyPadHoverCluster("padsBack", () => {
    drawLilyPadStatePart("padsBack", blend);
  });
  drawDanglingFlower("main", blend);
  drawDanglingFlower("small", blend);
  drawLilyPadHoverCluster("padsFront", () => {
    drawLilyPadStatePart("padsFront", blend);
  });
  pop();
}

function drawLilyPadHoverCluster(name, drawCluster) {
  const drift = lilyPadHoverDrift.clusters[name];
  push();
  translate(drift.x, drift.y);
  drawCluster();
  pop();
}

function getLilyPadAssemblyScale() {
  const stateScale = LILYPAD_VEGETATION.stateScale;
  const transition = constrain(treeTransition, 0, 2);
  const fromState = min(1, floor(min(transition, 1.999999)));
  return lerp(
    stateScale[fromState],
    stateScale[fromState + 1],
    transition - fromState
  );
}

function getLilyPadStateBlend() {
  const transition = constrain(treeTransition, 0, 2);
  const fromState = min(1, floor(min(transition, 1.999999)));
  const progress = transition - fromState;
  const outgoingMotion = smoothRange(progress, 0.08, 0.62);
  const incomingMotion = smoothRange(progress, 0.38, 0.92);

  return {
    fromState,
    toState: fromState + 1,
    progress,
    fromScale: lerp(1, 0.94, outgoingMotion),
    toScale: lerp(0.94, 1, incomingMotion),
    fromOffsetY: outgoingMotion * 13,
    toOffsetY: (1 - incomingMotion) * 13
  };
}

function smoothRange(value, start, end) {
  const amount = constrain((value - start) / (end - start), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

// ---------------------------------------------------------------------------
// DIALOGUE
// Dialogue rules mirror the Stage 1 table: arrival/reload/return are tracked
// across visits, while leaf-hover and object-click lines play only on their
// first matching interaction.

function drawWithVegetationShadow(g, shadow, drawArtwork) {
  g.drawingContext.save();
  g.drawingContext.shadowColor = shadow.color;
  g.drawingContext.shadowBlur = shadow.blur;
  g.drawingContext.shadowOffsetX = shadow.offsetX;
  g.drawingContext.shadowOffsetY = shadow.offsetY;
  // A small filter blur softens the artwork's own cut edge, independent of
  // the drop shadow above. Skipped on the lowest performance tier — it's a
  // per-object-per-frame canvas filter cost, and the plain shadowBlur above
  // still grounds the shape without it.
  if (shadow.edgeBlur && getPerfTier() !== "low") {
    g.drawingContext.filter = `blur(${shadow.edgeBlur}px)`;
  }
  drawArtwork();
  g.drawingContext.restore();
}

// Long, soft cast shadow: draws the same drawArtwork() callback several
// times, each copy pushed progressively farther along a fixed angle, wider,
// fainter, and unblurred (see below) than the last — simulating a shadow
// cast at a low light angle instead of drawWithVegetationShadow's single
// fixed-offset blur. Drop-in replacement with the same (g, shadow,
// drawArtwork) call shape, so every call site's own image-drawing logic
// (cropped source regions, CORNER vs CENTER placement, etc.) is reused
// unchanged — only the transform wrapped around it differs per copy.
// Adapted from a supplied reference implementation, which did blur each
// step individually; see why that's gone below. Dropped to one cheap copy
// on the low performance tier, same as every other expensive-looking-detail
// lever in this piece (ink mask blur, state-reveal mask resolution, etc.).
function drawLongCastShadow(g, shadow, drawArtwork) {
  const tier = getPerfTier();
  const angle = radians(shadow.angle);
  const dx = cos(angle) * shadow.length;
  const dy = sin(angle) * shadow.length;

  if (tier === "low") {
    g.push();
    g.translate(dx * 0.6, dy * 0.6);
    g.tint(shadow.tintColor[0], shadow.tintColor[1], shadow.tintColor[2],
      shadow.opacity * 0.5);
    drawArtwork();
    g.pop();
    return;
  }

  // No per-step canvas filter blur — by far the most expensive operation in
  // the original version, paid on every one of shadow.steps copies, on
  // every call. Moss in particular calls this once per state region (a
  // single part can have several) per active transition layer, so the old
  // 12-step, per-step-blurred version multiplied out to dozens of full
  // filter-blur passes a frame and made the whole scene visibly laggy. The
  // overlapping, alpha-tapered, widening copies already read as soft
  // without an explicit blur on each one — steps also cut well below the
  // configured shadow.steps for the same reason.
  const steps = tier === "medium" ? 3 : 5;
  for (let i = steps; i >= 1; i--) {
    const t = i / steps;
    const spread = lerp(1, 1.3, t);
    const heightSpread = lerp(1, 1.2, t);
    const alpha = shadow.opacity * pow(1 - t, 1.4);
    g.push();
    g.translate(dx * t, dy * t);
    g.scale(spread, heightSpread);
    g.tint(shadow.tintColor[0], shadow.tintColor[1], shadow.tintColor[2], alpha);
    drawArtwork();
    g.pop();
  }
  g.noTint();
}

function forEachLilyPadStateImage(partName, blend, drawImage) {
  const layers = [
    {
      state: blend.fromState,
      incoming: false,
      scale: blend.fromScale,
      offsetY: blend.fromOffsetY
    },
    {
      state: blend.toState,
      incoming: true,
      scale: blend.toScale,
      offsetY: blend.toOffsetY
    }
  ];
  const bounds = getLilyPartRevealBounds(partName, layers);
  const seed = partName.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  for (const layer of layers) {
    const artwork = lilyPadVegetationArtwork[layer.state][partName];
    const part = LILYPAD_VEGETATION_STATES[layer.state][partName];
    if (!artwork || !part) continue;
    drawStateReveal(
      `lily-${partName}`, blend.progress, bounds, seed, layer.incoming,
      (g) => {
        drawImage(g, artwork, part, layer.state, layer);
      }
    );
  }
}

function getLilyPartRevealBounds(partName, layers) {
  const placement = lilyPartPlacement[partName] || makePlacementTransform();
  const isPad = partName.startsWith("pads");
  const plant = isPad ? null : LILYPAD_VEGETATION.plants[
    partName.startsWith("main") ? "main" : "small"
  ];
  const anchors = !plant ? null : partName.endsWith("Stem")
    ? plant.stemBase : plant.flowerAnchor;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const layer of layers) {
    const artwork = lilyPadVegetationArtwork[layer.state][partName];
    const part = LILYPAD_VEGETATION_STATES[layer.state][partName];
    const anchor = anchors && anchors[layer.state];
    if (!artwork || !part || (!isPad && !anchor)) continue;
    const scaledWidth = artwork.width * layer.scale * placement.scale;
    const scaledHeight = artwork.height * layer.scale * placement.scale;
    const x = isPad
      ? part.x + artwork.width / 2 + placement.x - scaledWidth / 2
      : placement.x - anchor.x * layer.scale * placement.scale;
    const y = isPad
      ? part.y + artwork.height / 2 + placement.y + layer.offsetY
        - scaledHeight / 2
      : placement.y + layer.offsetY
        - anchor.y * layer.scale * placement.scale;
    left = min(left, x);
    top = min(top, y);
    right = max(right, x + scaledWidth);
    bottom = max(bottom, y + scaledHeight);
  }
  return {
    x: left - 40, y: top - 40,
    w: right - left + 80, h: bottom - top + 80
  };
}

function drawLilyPadStatePart(partName, blend, drawShadow = true) {
  const placement = lilyPartPlacement[partName] || makePlacementTransform();
  forEachLilyPadStateImage(partName, blend, (g, artwork, part, state, layer) => {
    const centerX = part.x + artwork.width / 2;
    const centerY = part.y + artwork.height / 2;
    g.push();
    g.translate(
      centerX + placement.x,
      centerY + layer.offsetY + placement.y
    );
    g.rotate(placement.rotation);
    g.scale(layer.scale * placement.scale);
    const drawArtwork = () => {
      g.image(artwork, -artwork.width / 2, -artwork.height / 2);
    };
    // drawLongCastShadow only paints the tinted shadow copies — the real
    // artwork always still needs its own draw call on top.
    if (drawShadow) {
      drawLongCastShadow(g, VEGETATION_SHADOWS.lilyPad, drawArtwork);
    }
    drawArtwork();
    g.pop();
  });
}

function drawDanglingFlower(plantName, blend) {
  const plant = LILYPAD_VEGETATION.plants[plantName];
  const degradation = constrain(treeTransition / 2, 0, 1);
  const dangleAngle = degradation * plant.droop;

  // Follow the front pad's push-away drift so a clicked pad can't leave the
  // stem's base uncovered behind it.
  const frontDrift = lilyPadHoverDrift.clusters.padsFront;

  push();
  translate(plant.base.x + frontDrift.x, plant.base.y + frontDrift.y);

  forEachLilyPadStateImage(
    plantName + "Stem",
    blend,
    (g, artwork, part, state, layer) => {
      const anchor = plant.stemBase[state];
      if (!anchor) return;
      const placement = lilyPartPlacement[plantName + "Stem"]
        || makePlacementTransform();
      g.push();
      g.translate(placement.x, layer.offsetY + placement.y);
      g.rotate(placement.rotation);
      g.scale(layer.scale * placement.scale);
      g.image(artwork, -anchor.x, -anchor.y);
      g.pop();
    }
  );

  translate(plant.tipOffset.x, plant.tipOffset.y);
  rotate(dangleAngle);
  forEachLilyPadStateImage(
    plantName + "Flower",
    blend,
    (g, artwork, part, state, layer) => {
      const anchor = plant.flowerAnchor[state];
      if (!anchor) return;
      const placement = lilyPartPlacement[plantName + "Flower"]
        || makePlacementTransform();
      g.push();
      g.translate(placement.x, layer.offsetY + placement.y);
      g.rotate(placement.rotation);
      g.scale(layer.scale * placement.scale);
      g.image(artwork, -anchor.x, -anchor.y);
      g.pop();
    }
  );
  pop();
}

function getStemColor(depth, bladeIndex) {
  const foregroundStems = [
    "#4FCB78", // required vegetation green
    "#E43E3D", // saturated tree red
    "#7A619A", // purple
    "#BD3B8F", // magenta
    "#9B9D38"  // olive
  ];

  const backgroundStems = [
    "#55B66E", // required vegetation green
    "#9B9D38", // olive
    "#E5D316", // yellow
    "#7A619A", // purple accent
    "#55B66E"  // repeat green so it remains dominant
  ];

  const palette = depth === "foreground"
    ? foregroundStems
    : backgroundStems;

  const stemColor = color(palette[bladeIndex % palette.length]);
  stemColor.setAlpha(220);
  return stemColor;
}

function plantColor(hexValue, alphaValue) {
  const result = color(hexValue);
  result.setAlpha(alphaValue);
  return result;
}

function getLeafPalette(depth, bladeIndex) {
  const foregroundLeaves = [
    { outer: "#E43E3D", inner: "#FF7760" }, // red + coral
    { outer: "#73558F", inner: "#E43E3D" }, // purple + red
    { outer: "#B63B8D", inner: "#E5D316" }, // magenta + yellow
    { outer: "#758D43", inner: "#C7CC42" }, // olive accent
    { outer: "#4FAA68", inner: "#E5D316" }  // green indicator
  ];

  const backgroundLeaves = [
    { outer: "#4FAA68", inner: "#C7CC42" }, // green + lime
    { outer: "#84963D", inner: "#E5D316" }, // olive + yellow
    { outer: "#65B86B", inner: "#E5D316" }, // green + yellow
    { outer: "#9B9D38", inner: "#D8C94A" }, // olive variation
    { outer: "#73558F", inner: "#B6C83F" }  // restrained purple accent
  ];

  const choices = depth === "foreground"
    ? foregroundLeaves
    : backgroundLeaves;
  const choice = choices[bladeIndex % choices.length];

  return {
    outer: plantColor(choice.outer, 220),
    inner: plantColor(choice.inner, 235),

    // Saturated red remains an edge accent, not the dominant fill.
    edge: plantColor("#FF3048", depth === "foreground" ? 145 : 85)
  };
}
function renderLeaf(g, w, h, angle, palette, leafShape, plantSeed, bladeIndex, effectScale, opaqueBody = false) {
  g.push();
  g.translate(g.width / 2, g.height / 2);

  const context = g.drawingContext;
  const blurAmount = max(2, w * 0.25) * effectScale;

  // Moss and lily pads have a fully opaque body beneath the soft edge treatment.
  if (opaqueBody) {
    g.noStroke();
    g.fill(palette.outer);
    drawLeafShape(g, w, h, leafShape);
  }

  // OUTER LINE ART: saturated red, blurred only on the left side.
  g.noFill();
  g.stroke(palette.edge);
  g.strokeWeight(max(1, w * 0.06));

  // Left half: displaced softness and a wider red halo.
  context.save();
  context.beginPath();
  context.rect(-w * 3, -h * 3, w * 3, h * 6);
  context.clip();
  context.filter = `blur(${max(1.5, w * 0.12) * effectScale}px)`;
  context.shadowColor = palette.edge.toString();
  context.shadowBlur = max(6, w * 0.48) * effectScale;
  drawLeafShape(g, w * 1.04, h * 1.04, leafShape);
  context.restore();

  // Right half: crisp line with only a restrained edge glow.
  context.save();
  context.beginPath();
  context.rect(0, -h * 3, w * 3, h * 6);
  context.clip();
  context.filter = "none";
  context.shadowColor = palette.edge.toString();
  context.shadowBlur = 2 * effectScale;
  drawLeafShape(g, w * 1.04, h * 1.04, leafShape);
  context.restore();

  // OUTER BODY: left half soft, right half crisp.
  g.noStroke();
  g.fill(palette.outer);

  context.save();
  context.beginPath();
  context.rect(-w * 3, -h * 3, w * 3, h * 6);
  context.clip();
  context.filter = `blur(${blurAmount}px)`;
  drawLeafShape(g, w, h, leafShape);
  context.restore();

  context.save();
  context.beginPath();
  context.rect(0, -h * 3, w * 3, h * 6);
  context.clip();
  context.filter = "none";
  drawLeafShape(g, w, h, leafShape);
  context.restore();

  // INNER GLOW: softer and deliberately displaced from the leaf center.
  // Freeze the glow offset so the complete leaf can be cached.
  const corePositionSeed =
    plantSeed * 0.73 + bladeIndex * 4.19 + angle * 9 + leafShape * 4.7;

  // CORE SIZE RATIO = 1 : 4, independent from the outer leaf.
  // The sine hash keeps each size stable while the plant animates.
  const minimumCoreScale = 0.18;
  const maximumCoreScale = minimumCoreScale * 4;
  const coreSizeRandom = abs(
    sin(plantSeed * 12.9898 + bladeIndex * 78.233)
  );
  const coreSizeScale = lerp(
    minimumCoreScale,
    maximumCoreScale,
    coreSizeRandom
  );

  const coreOffsetX = map(
    noise(corePositionSeed),
    0,
    1,
    -w * 0.30,
    w * 0.30
  );
  const coreOffsetY = map(
    noise(corePositionSeed + 40),
    0,
    1,
    -h * 0.20,
    h * 0.20
  );

  g.push();
  g.translate(coreOffsetX, coreOffsetY);
  g.scale(coreSizeScale, coreSizeScale);
  context.save();
  context.filter = `blur(${max(1.5, w * 0.10) * effectScale}px)`;
  context.shadowColor = palette.inner.toString();
  context.shadowBlur = max(9, w * 0.70) * effectScale;
  g.noStroke();
  g.fill(palette.inner);
  drawLeafShape(g, w, h, leafShape);
  context.restore();
  g.pop();
  g.pop();
}

// [1] FOUR LEAF SILHOUETTES
function drawLeafShape(g, w, h, leafShape) {
  if (leafShape === 0) {
    // Oval leaf
    g.ellipse(0, 0, w, h);
  } else if (leafShape === 1) {
    // Long pointed blade
    g.beginShape();
    g.vertex(0, -h * 0.5);
    g.bezierVertex(w * 0.55, -h * 0.12, w * 0.38, h * 0.30, 0, h * 0.5);
    g.bezierVertex(-w * 0.38, h * 0.30, -w * 0.55, -h * 0.12, 0, -h * 0.5);
    g.endShape(CLOSE);
  } else if (leafShape === 2) {
    // Asymmetrical teardrop
    g.beginShape();
    g.vertex(-w * 0.08, -h * 0.5);
    g.bezierVertex(w * 0.62, -h * 0.2, w * 0.45, h * 0.34, -w * 0.08, h * 0.5);
    g.bezierVertex(-w * 0.42, h * 0.12, -w * 0.32, -h * 0.30, -w * 0.08, -h * 0.5);
    g.endShape(CLOSE);
  } else {
    // Two-lobed sprout
    g.ellipse(-w * 0.16, -h * 0.12, w * 0.72, h * 0.72);
    g.ellipse(w * 0.18, h * 0.16, w * 0.66, h * 0.58);
  }
}

// [2] MOSS PLACEMENT
function renderMoss(g, view) {
  g.push();
  g.translate(view.x, view.y);
  g.scale(view.scale);

  const unit = pond.height / 700;

  // Left inner wall: upper and lower patches.
  drawMossPatch(g, pond.width * 0.225, pond.height * 0.48, 54 * unit, 115 * unit, -0.28, 101);
  drawMossPatch(g, pond.width * 0.255, pond.height * 0.72, 70 * unit, 120 * unit, -0.50, 102);

  // Bottom inner rim: long low-growing patches.
  drawMossPatch(g, pond.width * 0.63, pond.height * 0.925, 175 * unit, 38 * unit, -0.03, 103);
  drawMossPatch(g, pond.width * 0.76, pond.height * 0.90, 150 * unit, 42 * unit, -0.18, 104);

  // Right inner wall plus additional growth tucked into the shaded edges.
  drawMossPatch(g, pond.width * 0.82, pond.height * 0.82, 58 * unit, 105 * unit, 0.42, 105);
  drawMossPatch(g, pond.width * 0.18, pond.height * 0.60, 46 * unit, 95 * unit, -0.20, 106);
  drawMossPatch(g, pond.width * 0.70, pond.height * 0.86, 112 * unit, 30 * unit, -0.10, 107);

  g.pop();
}

function opaquePalette(depth, index) {
  const palette = getLeafPalette(depth, index);
  for (const value of Object.values(palette)) value.setAlpha(255);
  return palette;
}

function drawMossPatch(g, x, y, patchWidth, patchHeight, angle, seed) {
  g.push();
  g.translate(x, y);
  g.rotate(angle);
  randomSeed(seed);
  const density = max(1, ceil(view.scale * pixelDensity()));
  const effectScale = density / (view.scale * pixelDensity());
  const unit = pond.height / 700;

  // Individual circles replace the transparent oval backing. Diameters span 1:4.
  for (let i = 0; i < 18; i++) {
    const theta = random(TWO_PI);
    const radius = sqrt(random());
    const mossX = cos(theta) * radius * patchWidth * 0.43;
    const mossY = sin(theta) * radius * patchHeight * 0.43;
    const diameter = lerp(10, 40, pow(random(), 2)) * unit;
    const palette = opaquePalette(seed < 103 ? "background" : "foreground", i);
    const padding = ceil(max(diameter * 2, 30 * effectScale / density));
    const sprite = createBuffer(diameter + padding * 2, diameter + padding * 2, density);
    renderLeaf(sprite, diameter, diameter, 0, palette, 0, seed, i, effectScale, true);
    g.image(sprite, mossX - sprite.width / 2, mossY - sprite.height / 2);
    // The complete patch now lives in mossCache; no per-circle canvas is retained.
    sprite.remove();
  }
  g.pop();
}

function createLilyPads() {
  const unit = pond.height / 700;
  // A still, oversized focal pad is ringed by smaller, gently travelling clusters.
  const pads = [
    { x: 0.63, y: 0.72, size: 3.0, phase: 0.0, speed: 0.20, radiusX: 15, radiusY: 8 },
    { x: 0.53, y: 0.66, size: 1.0, phase: 0.5, speed: 0.42, radiusX: 18, radiusY: 10 },
    { x: 0.56, y: 0.76, size: 0.50, phase: 1.7, speed: 0.36, radiusX: 16, radiusY: 13 },
    { x: 0.70, y: 0.64, size: 0.58, phase: 2.4, speed: 0.40, radiusX: 19, radiusY: 11 },
    { x: 0.73, y: 0.78, size: 0.46, phase: 3.1, speed: 0.34, radiusX: 15, radiusY: 12 },
    { x: 0.47, y: 0.58, size: 0.54, phase: 4.2, speed: 0.38, radiusX: 17, radiusY: 9 },
    { x: 0.42, y: 0.63, size: 0.42, phase: 5.0, speed: 0.44, radiusX: 13, radiusY: 10 },
    { x: 0.49, y: 0.51, size: 0.47, phase: 5.7, speed: 0.35, radiusX: 14, radiusY: 12 }
  ];

  return pads.map((pad) => ({
    x: pond.width * pad.x,
    y: pond.height * pad.y,
    width: 56 * unit * pad.size,
    height: 32 * unit * pad.size,
    phase: pad.phase,
    speed: pad.speed,
    radiusX: pad.radiusX * unit,
    radiusY: pad.radiusY * unit
  }));
}

function cacheLilyPads() {
  const density = max(1, ceil(view.scale * pixelDensity()));
  const effectScale = density / (view.scale * pixelDensity());
  for (let i = 0; i < lilyPads.length; i++) {
    const pad = lilyPads[i];
    if (pad.sprite) pad.sprite.remove();
    const padding = ceil(max(pad.width * 2, 30 * effectScale / density));
    pad.sprite = createBuffer(pad.width + padding * 2, pad.height + padding * 2, density);
    renderLilyPad(pad.sprite, pad, effectScale);
  }
}

function renderLilyPad(g, pad, effectScale) {
  const context = g.drawingContext;
  const w = pad.width;
  const h = pad.height;
  g.push();
  g.translate(g.width / 2, g.height / 2);
  context.save();
  context.beginPath();
  context.moveTo(w * 0.06, 0);
  context.lineTo(w * 0.48, -h * 0.12);
  context.bezierCurveTo(w * 0.34, -h * 0.65, -w * 0.50, -h * 0.65, -w * 0.50, 0);
  context.bezierCurveTo(-w * 0.50, h * 0.65, w * 0.34, h * 0.65, w * 0.48, h * 0.12);
  context.closePath();

  // Opaque green surface and a small open notch keep the floating pads readable.
  const surface = context.createRadialGradient(-w * 0.18, -h * 0.14, 0, 0, 0, w * 0.65);
  surface.addColorStop(0, "#C7CC42");
  surface.addColorStop(0.42, "#65B86B");
  surface.addColorStop(1, "#758D43");
  context.fillStyle = surface;
  context.strokeStyle = "#84963D";
  context.lineWidth = max(1, w * 0.025);
  context.shadowColor = "#758D43";
  context.shadowBlur = 3 * effectScale;
  context.fill();
  context.stroke();
  context.shadowBlur = 0;
  context.clip();
  context.strokeStyle = "rgba(199, 204, 66, 0.65)";
  context.lineWidth = max(0.7, w * 0.012);
  for (const direction of [-1, 1]) {
    context.beginPath();
    context.moveTo(w * 0.06, 0);
    context.quadraticCurveTo(-w * 0.15, direction * h * 0.03, -w * 0.32, direction * h * 0.27);
    context.stroke();
  }
  context.restore();
  g.pop();
}

function drawLilyPads() {
  push();
  translate(view.x, view.y);
  scale(view.scale);
  const elapsedSeconds = millis() / 1000;
  for (const pad of lilyPads) {
    const phase = elapsedSeconds * pad.speed + pad.phase;
    push();
    // Keep every pad upright; the larger translation makes its path easy to follow.
    translate(pad.x + cos(phase) * pad.radiusX, pad.y + sin(phase * 0.73) * pad.radiusY);
    image(pad.sprite, -pad.sprite.width / 2, -pad.sprite.height / 2);
    pop();
  }
  pop();
}

function drawWaterRipples(seed) {
  noFill();
  strokeWeight(2);

  for (let i = 0; i < 3; i++) {
    const progress =
      (frameCount * 0.008 + i / 3 + seed * 0.01) % 1;

    const rippleWidth = lerp(50, 125, progress);
    const rippleHeight = lerp(10, 28, progress);
    const opacity = lerp(110, 0, progress);

    stroke(145, 255, 220, opacity);

    ellipse(
      0,
      2,
      rippleWidth,
      rippleHeight
    );
  }
}

// ---------------------------------------------------------------------------
// PLACEMENT MODE
// Related healthy/unhealthy/dead images are edited as one assembly. The
// animation code continues to add motion inside these saved base transforms.
