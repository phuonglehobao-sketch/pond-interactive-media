// Placement-editor persistence, transforms, hit bounds, controls, and UI.

function makePlacementTransform() {
  return { x: 0, y: 0, scale: 1, rotation: 0 };
}

function initializeIndividualPlacementTransforms() {
  treePartPlacement = TREE_PARTS.map(() => makePlacementTransform());
  mossPartPlacement = MOSS_PARTS.map(() => makePlacementTransform());
  lilyPartPlacement = {};
  for (const name of LILYPAD_EDITABLE_PARTS) {
    lilyPartPlacement[name] = makePlacementTransform();
  }
}

function copyPlacementTransforms(transforms) {
  return transforms.map((transform) => ({ ...transform }));
}

function getPlacementLayoutData() {
  return {
    version: 2,
    viewport: { width, height },
    pond: {
      panX: POOL_CAMERA.panX,
      panY: POOL_CAMERA.panY,
      zoom: POOL_CAMERA.zoom
    },
    fish: {
      x: FISH_WATER.x,
      y: FISH_WATER.y,
      width: FISH_WATER.width,
      radiusX: FISH_WATER.radiusX,
      radiusY: FISH_WATER.radiusY,
      rotation: FISH_WATER.rotation
    },
    tree: {
      x: TREE.x,
      y: TREE.y,
      scale: TREE.scale,
      rotation: TREE.rotation,
      parts: copyPlacementTransforms(treePartPlacement)
    },
    moss: {
      x: MOSS_ASSEMBLY.x,
      y: MOSS_ASSEMBLY.y,
      width: MOSS_ASSEMBLY.width,
      height: MOSS_ASSEMBLY.height,
      rotation: MOSS_ASSEMBLY.rotation,
      parts: copyPlacementTransforms(mossPartPlacement)
    },
    grass: GRASS_PATCHES.map((patch) => ({
      x: patch.x,
      y: patch.y,
      width: patch.width,
      rotation: patch.angle
    })),
    foregroundGrass: FOREGROUND_GRASS_PARTS.map((part) => ({
      x: part.x,
      y: part.y,
      height: part.height,
      rotation: part.rotation
    })),
    lilyPads: {
      x: LILYPAD_VEGETATION.x,
      y: LILYPAD_VEGETATION.y,
      width: LILYPAD_VEGETATION.width,
      rotation: LILYPAD_VEGETATION.rotation,
      parts: Object.fromEntries(
        Object.entries(lilyPartPlacement).map(([name, transform]) => (
          [name, { ...transform }]
        ))
      )
    }
  };
}

function copyPlacementLayout(layout) {
  return JSON.parse(JSON.stringify(layout));
}

function finitePlacementValue(value, fallback, minimum = -Infinity) {
  return Number.isFinite(value) ? max(minimum, value) : fallback;
}

function applyIndividualPlacementTransform(target, saved) {
  if (!target || !saved) return;
  target.x = finitePlacementValue(saved.x, target.x);
  target.y = finitePlacementValue(saved.y, target.y);
  target.scale = finitePlacementValue(saved.scale, target.scale, 0.02);
  target.rotation = finitePlacementValue(saved.rotation, target.rotation);
}

function applyPlacementLayout(layout, rebuild = true) {
  if (!layout || typeof layout !== "object") return false;

  if (layout.pond) {
    POOL_CAMERA.panX = finitePlacementValue(layout.pond.panX, POOL_CAMERA.panX);
    POOL_CAMERA.panY = finitePlacementValue(layout.pond.panY, POOL_CAMERA.panY);
    POOL_CAMERA.zoom = finitePlacementValue(layout.pond.zoom, POOL_CAMERA.zoom, 0.1);
  }
  if (layout.fish) {
    FISH_WATER.x = finitePlacementValue(layout.fish.x, FISH_WATER.x);
    FISH_WATER.y = finitePlacementValue(layout.fish.y, FISH_WATER.y);
    FISH_WATER.width = finitePlacementValue(layout.fish.width, FISH_WATER.width, 10);
    FISH_WATER.radiusX = finitePlacementValue(layout.fish.radiusX, FISH_WATER.radiusX, 10);
    FISH_WATER.radiusY = finitePlacementValue(layout.fish.radiusY, FISH_WATER.radiusY, 10);
    FISH_WATER.rotation = finitePlacementValue(
      layout.fish.rotation,
      FISH_WATER.rotation
    );
  }
  if (layout.tree) {
    TREE.x = finitePlacementValue(layout.tree.x, TREE.x);
    TREE.y = finitePlacementValue(layout.tree.y, TREE.y);
    TREE.scale = finitePlacementValue(layout.tree.scale, TREE.scale, 0.02);
    TREE.rotation = finitePlacementValue(layout.tree.rotation, TREE.rotation);
    if (Array.isArray(layout.tree.parts)) {
      for (let index = 0; index < min(
        layout.tree.parts.length,
        treePartPlacement.length
      ); index++) {
        applyIndividualPlacementTransform(
          treePartPlacement[index],
          layout.tree.parts[index]
        );
      }
    }
  }
  if (layout.moss) {
    MOSS_ASSEMBLY.x = finitePlacementValue(layout.moss.x, MOSS_ASSEMBLY.x);
    MOSS_ASSEMBLY.y = finitePlacementValue(layout.moss.y, MOSS_ASSEMBLY.y);
    MOSS_ASSEMBLY.width = finitePlacementValue(layout.moss.width, MOSS_ASSEMBLY.width, 0.01);
    MOSS_ASSEMBLY.height = finitePlacementValue(layout.moss.height, MOSS_ASSEMBLY.height, 0.01);
    MOSS_ASSEMBLY.rotation = finitePlacementValue(
      layout.moss.rotation,
      MOSS_ASSEMBLY.rotation
    );
    if (Array.isArray(layout.moss.parts)) {
      for (let index = 0; index < min(
        layout.moss.parts.length,
        mossPartPlacement.length
      ); index++) {
        applyIndividualPlacementTransform(
          mossPartPlacement[index],
          layout.moss.parts[index]
        );
      }
    }
  }
  if (Array.isArray(layout.grass)) {
    for (let index = 0; index < min(layout.grass.length, GRASS_PATCHES.length); index++) {
      const saved = layout.grass[index];
      const patch = GRASS_PATCHES[index];
      if (!saved) continue;
      patch.x = finitePlacementValue(saved.x, patch.x);
      patch.y = finitePlacementValue(saved.y, patch.y);
      patch.width = finitePlacementValue(saved.width, patch.width, 0.01);
      patch.angle = finitePlacementValue(saved.rotation, patch.angle);
    }
  }
  if (Array.isArray(layout.foregroundGrass)) {
    for (let index = 0; index < min(
      layout.foregroundGrass.length,
      FOREGROUND_GRASS_PARTS.length
    ); index++) {
      const saved = layout.foregroundGrass[index];
      const part = FOREGROUND_GRASS_PARTS[index];
      if (!saved) continue;
      part.x = finitePlacementValue(saved.x, part.x);
      part.y = finitePlacementValue(saved.y, part.y);
      part.height = finitePlacementValue(saved.height, part.height, 0.01);
      part.rotation = finitePlacementValue(saved.rotation, part.rotation);
    }
  }
  if (layout.lilyPads) {
    LILYPAD_VEGETATION.x = finitePlacementValue(layout.lilyPads.x, LILYPAD_VEGETATION.x);
    LILYPAD_VEGETATION.y = finitePlacementValue(layout.lilyPads.y, LILYPAD_VEGETATION.y);
    LILYPAD_VEGETATION.width = finitePlacementValue(
      layout.lilyPads.width,
      LILYPAD_VEGETATION.width,
      0.01
    );
    LILYPAD_VEGETATION.rotation = finitePlacementValue(
      layout.lilyPads.rotation,
      LILYPAD_VEGETATION.rotation
    );
    if (layout.lilyPads.parts) {
      for (const name of LILYPAD_EDITABLE_PARTS) {
        applyIndividualPlacementTransform(
          lilyPartPlacement[name],
          layout.lilyPads.parts[name]
        );
      }
    }
  }

  fishCurrentPosition = null;
  fishHitAreas = [];
  if (rebuild && pond && width > 0 && height > 0) rebuildCaches();
  return true;
}

function setPlacementNotice(message) {
  placementNotice = message;
  placementNoticeUntil = millis() + 2200;
}

function savePlacementLayout() {
  const layout = getPlacementLayoutData();
  try {
    localStorage.setItem(PLACEMENT_STORAGE_KEY, JSON.stringify(layout));
    placementHasUnsavedChanges = false;
    setPlacementNotice("Saved in this browser");
  } catch (error) {
    console.warn("Could not save placement layout", error);
    setPlacementNotice("Browser save failed — use E to export JSON");
  }
}

function loadPlacementLayout(showNotice = true) {
  try {
    const saved = localStorage.getItem(PLACEMENT_STORAGE_KEY)
      || localStorage.getItem(LEGACY_PLACEMENT_STORAGE_KEY);
    if (!saved) return false;
    const applied = applyPlacementLayout(JSON.parse(saved), false);
    if (applied && showNotice) setPlacementNotice("Saved layout loaded");
    placementHasUnsavedChanges = false;
    return applied;
  } catch (error) {
    console.warn("Could not load placement layout", error);
    if (showNotice) setPlacementNotice("Saved layout could not be loaded");
    return false;
  }
}

function exportPlacementLayout() {
  const layout = getPlacementLayoutData();
  layout.exportedAt = new Date().toISOString();
  console.log("===== POND PLACEMENT LAYOUT =====");
  console.log(JSON.stringify(layout, null, 2));
  saveJSON(layout, "pond-layout.json");
  setPlacementNotice("Exported pond-layout.json");
}

function resetPlacementLayout() {
  if (!placementDefaults) return;
  applyPlacementLayout(copyPlacementLayout(placementDefaults));
  placementHasUnsavedChanges = true;
  setPlacementNotice("Defaults restored — press S to save");
}

function getPlacementAssets() {
  // This is the scene's drawing order; hit testing reverses it so the visually
  // topmost assembly wins.
  const assets = [
    { id: "pond", label: "Pond / camera" },
    { id: "fish", label: "Fish swim area" },
    { id: "tree", label: "Tree — complete assembly", group: true }
  ];
  for (let index = 0; index < TREE_PARTS.length; index++) {
    assets.push({
      id: `tree-part-${index}`,
      label: `Tree SVG — ${TREE_PARTS[index].name}`
    });
  }
  assets.push({ id: "moss", label: "Moss — complete assembly", group: true });
  for (let index = 0; index < MOSS_PARTS.length; index++) {
    assets.push({
      id: `moss-part-${index}`,
      label: `Moss SVG — ${MOSS_PARTS[index].name}`
    });
  }
  for (let index = 0; index < GRASS_PATCHES.length; index++) {
    assets.push({
      id: `grass-${index}`,
      label: `Grass SVG — patch ${index + 1}`
    });
  }
  assets.push({
    id: "lilyPads",
    label: "Lily pads — complete assembly",
    group: true
  });
  for (const name of LILYPAD_EDITABLE_PARTS) {
    assets.push({ id: `lily-part-${name}`, label: `Lily SVG — ${name}` });
  }
  for (let index = 0; index < FOREGROUND_GRASS_PARTS.length; index++) {
    assets.push({
      id: `foreground-grass-${index}`,
      label: `Foreground grass — ${FOREGROUND_GRASS_PARTS[index].name}`
    });
  }
  return assets;
}

function rotatedRectangleBounds(x, y, w, h, angle, pivotX, pivotY) {
  const rotationCos = cos(angle);
  const rotationSin = sin(angle);
  const corners = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h }
  ].map((corner) => {
    const dx = corner.x - pivotX;
    const dy = corner.y - pivotY;
    return {
      x: pivotX + dx * rotationCos - dy * rotationSin,
      y: pivotY + dx * rotationSin + dy * rotationCos
    };
  });
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const left = min(xs);
  const right = max(xs);
  const top = min(ys);
  const bottom = max(ys);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function boundsFromPoints(points) {
  if (!points || points.length === 0) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = min(xs);
  const right = max(xs);
  const top = min(ys);
  const bottom = max(ys);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function rotatePointAround(pointX, pointY, pivotX, pivotY, angle) {
  const dx = pointX - pivotX;
  const dy = pointY - pivotY;
  return {
    x: pivotX + dx * cos(angle) - dy * sin(angle),
    y: pivotY + dx * sin(angle) + dy * cos(angle)
  };
}

function getTreePartPlacementBounds(index) {
  const part = TREE_PARTS[index];
  const placement = treePartPlacement[index];
  if (!part || !placement) return null;
  const transition = getTreePartTransition(part, treeTransition);
  const from = getTreePartState(part, transition.fromState);
  const to = getTreePartState(part, transition.toState);
  const arc = sin(PI * transition.progress);
  const centerX = lerp(
    from.x + from.w / 2,
    to.x + to.w / 2,
    transition.progress
  ) + arc * part.arc * 85 + placement.x;
  const centerY = lerp(
    from.y + from.h / 2,
    to.y + to.h / 2,
    transition.progress
  ) + arc * abs(part.arc) * 65 + placement.y;
  const partWidth = lerp(from.w, to.w, transition.progress) * placement.scale;
  const partHeight = lerp(from.h, to.h, transition.progress) * placement.scale;
  const unhealthyAmount = min(1, transition.fromState + transition.progress);
  const partAngle = lerp(0, part.droop, unhealthyAmount)
    + arc * part.arc + placement.rotation;
  const artworkScale = height * TREE.scale / 1571;
  const rootX = 1034;
  const rootY = 1321;
  const treeX = width * TREE.x;
  const treeY = height * TREE.y;
  const corners = [
    { x: centerX - partWidth / 2, y: centerY - partHeight / 2 },
    { x: centerX + partWidth / 2, y: centerY - partHeight / 2 },
    { x: centerX + partWidth / 2, y: centerY + partHeight / 2 },
    { x: centerX - partWidth / 2, y: centerY + partHeight / 2 }
  ].map((corner) => {
    const partPoint = rotatePointAround(
      corner.x, corner.y, centerX, centerY, partAngle
    );
    const rootPoint = rotatePointAround(
      partPoint.x, partPoint.y, rootX, rootY, TREE.rotation
    );
    return {
      x: treeX + rootPoint.x * artworkScale,
      y: treeY + rootPoint.y * artworkScale
    };
  });
  return boundsFromPoints(corners);
}

function getMossPartPlacementBounds(index) {
  const part = MOSS_PARTS[index];
  const placement = mossPartPlacement[index];
  if (!part || !placement) return null;
  const validStates = part.sizes
    .map((size, state) => ({ size, state }))
    .filter((record) => record.size && part.offsets[record.state]);
  const localPoints = [];
  for (const record of validStates) {
    const offset = part.offsets[record.state];
    const x = offset.x - part.pivot.x;
    const y = offset.y - part.pivot.y;
    const corners = [
      { x, y },
      { x: x + record.size.w, y },
      { x: x + record.size.w, y: y + record.size.h },
      { x, y: y + record.size.h }
    ];
    for (const corner of corners) {
      const scaled = {
        x: corner.x * placement.scale,
        y: corner.y * placement.scale
      };
      const rotated = rotatePointAround(
        scaled.x, scaled.y, 0, 0, placement.rotation
      );
      localPoints.push({
        x: part.pivot.x + placement.x + rotated.x,
        y: part.pivot.y + placement.y + rotated.y
      });
    }
  }

  const assemblyScaleX = width * MOSS_ASSEMBLY.width
    / MOSS_ASSEMBLY.masterWidth;
  const assemblyScaleY = height * MOSS_ASSEMBLY.height
    / MOSS_ASSEMBLY.masterHeight;
  const assemblyX = width * MOSS_ASSEMBLY.x;
  const assemblyY = height * MOSS_ASSEMBLY.y;
  return boundsFromPoints(localPoints.map((point) => {
    const scaledX = point.x * assemblyScaleX;
    const scaledY = point.y * assemblyScaleY;
    const rotated = rotatePointAround(
      scaledX, scaledY, 0, 0, MOSS_ASSEMBLY.rotation
    );
    return { x: assemblyX + rotated.x, y: assemblyY + rotated.y };
  }));
}

function getLilyPartPlacementBounds(name) {
  const placement = lilyPartPlacement[name];
  const artwork = lilyPadVegetationArtwork[0]
    && lilyPadVegetationArtwork[0][name];
  if (!placement || !artwork) return null;
  const part = LILYPAD_VEGETATION_STATES[0][name];
  let anchorX;
  let anchorY;
  let imageX;
  let imageY;

  if (name === "padsBack" || name === "padsFront") {
    anchorX = part.x + artwork.width / 2;
    anchorY = part.y + artwork.height / 2;
    imageX = -artwork.width / 2;
    imageY = -artwork.height / 2;
  } else {
    const plantName = name.startsWith("main") ? "main" : "small";
    const plant = LILYPAD_VEGETATION.plants[plantName];
    const isFlower = name.endsWith("Flower");
    const anchor = isFlower
      ? plant.flowerAnchor[0]
      : plant.stemBase[0];
    anchorX = plant.base.x + (isFlower ? plant.tipOffset.x : 0);
    anchorY = plant.base.y + (isFlower ? plant.tipOffset.y : 0);
    imageX = -anchor.x;
    imageY = -anchor.y;
  }

  const localCorners = [
    { x: imageX, y: imageY },
    { x: imageX + artwork.width, y: imageY },
    { x: imageX + artwork.width, y: imageY + artwork.height },
    { x: imageX, y: imageY + artwork.height }
  ].map((corner) => {
    const scaled = {
      x: corner.x * placement.scale,
      y: corner.y * placement.scale
    };
    const rotated = rotatePointAround(
      scaled.x, scaled.y, 0, 0, placement.rotation
    );
    return {
      x: anchorX + placement.x + rotated.x,
      y: anchorY + placement.y + rotated.y
    };
  });

  const vegetation = LILYPAD_VEGETATION;
  const stateScale = getLilyPadAssemblyScale();
  const artworkScale = width * vegetation.width / vegetation.masterWidth;
  const center = vegetation.radialCenter;
  const rootX = width * vegetation.x;
  const rootY = height * vegetation.y;
  return boundsFromPoints(localCorners.map((point) => {
    const statePoint = {
      x: center.x + (point.x - center.x) * stateScale,
      y: center.y + (point.y - center.y) * stateScale
    };
    const scaledX = statePoint.x * artworkScale;
    const scaledY = statePoint.y * artworkScale;
    const rotated = rotatePointAround(
      scaledX, scaledY, 0, 0, vegetation.rotation
    );
    return { x: rootX + rotated.x, y: rootY + rotated.y };
  }));
}

function getForegroundGrassPlacementBounds(index) {
  const part = FOREGROUND_GRASS_PARTS[index];
  if (!part) return null;
  const pivotX = width * part.x;
  const pivotY = height * part.y;
  const drawHeight = height * part.height;
  const points = [];

  for (const sourceSize of part.sizes) {
    if (!sourceSize) continue;
    const drawWidth = drawHeight * sourceSize.w / sourceSize.h;
    const left = -drawWidth * part.anchorX;
    const top = -drawHeight * part.anchorY;
    const corners = [
      { x: left, y: top },
      { x: left + drawWidth, y: top },
      { x: left + drawWidth, y: top + drawHeight },
      { x: left, y: top + drawHeight }
    ];
    for (const corner of corners) {
      const rotated = rotatePointAround(
        corner.x, corner.y, 0, 0, part.rotation
      );
      points.push({ x: pivotX + rotated.x, y: pivotY + rotated.y });
    }
  }
  return boundsFromPoints(points);
}

function getPlacementBounds(id) {
  if (id === "pond") return { x: 0, y: 0, w: width, h: height };

  if (id === "tree") {
    const h = height * TREE.scale;
    const w = h * (1577 / 1571);
    const x = width * TREE.x;
    const y = height * TREE.y;
    const artworkScale = h / 1571;
    return rotatedRectangleBounds(
      x,
      y,
      w,
      h,
      TREE.rotation,
      x + 1034 * artworkScale,
      y + 1321 * artworkScale
    );
  }

  if (id.startsWith("tree-part-")) {
    return getTreePartPlacementBounds(Number(id.split("-")[2]));
  }

  if (id === "fish") {
    const rotationCos = cos(FISH_WATER.rotation);
    const rotationSin = sin(FISH_WATER.rotation);
    const radiusX = view.scale * (
      abs(FISH_WATER.radiusX * rotationCos)
      + abs(FISH_WATER.radiusY * rotationSin)
      + FISH_WATER.width * 0.55
    );
    const radiusY = view.scale * (
      abs(FISH_WATER.radiusX * rotationSin)
      + abs(FISH_WATER.radiusY * rotationCos)
      + FISH_WATER.width * 0.30
    );
    const centerX = view.x + FISH_WATER.x * view.scale;
    const centerY = view.y + FISH_WATER.y * view.scale;
    return {
      x: centerX - radiusX,
      y: centerY - radiusY,
      w: radiusX * 2,
      h: radiusY * 2
    };
  }

  if (id === "moss") {
    const x = width * MOSS_ASSEMBLY.x;
    const y = height * MOSS_ASSEMBLY.y;
    const w = width * MOSS_ASSEMBLY.width;
    const h = height * MOSS_ASSEMBLY.height;
    return rotatedRectangleBounds(
      x, y, w, h, MOSS_ASSEMBLY.rotation, x, y
    );
  }


  if (id.startsWith("moss-part-")) {
    return getMossPartPlacementBounds(Number(id.split("-")[2]));
  }

  if (id.startsWith("foreground-grass-")) {
    return getForegroundGrassPlacementBounds(
      Number(id.slice("foreground-grass-".length))
    );
  }

  if (id.startsWith("grass-")) {
    const index = Number(id.split("-")[1]);
    const patch = GRASS_PATCHES[index];
    const w = width * patch.width;
    const h = w * (patch.sourceHeight / patch.sourceWidth);
    const pivotX = width * patch.x + w / 2;
    const pivotY = height * patch.y + h;
    return rotatedRectangleBounds(
      pivotX - w / 2,
      pivotY - h,
      w,
      h,
      patch.angle,
      pivotX,
      pivotY
    );
  }

  if (id === "lilyPads") {
    const x = width * LILYPAD_VEGETATION.x;
    const y = height * LILYPAD_VEGETATION.y;
    const w = width * LILYPAD_VEGETATION.width;
    const h = w * (620 / LILYPAD_VEGETATION.masterWidth);
    return rotatedRectangleBounds(
      x, y, w, h, LILYPAD_VEGETATION.rotation, x, y
    );
  }

  if (id.startsWith("lily-part-")) {
    return getLilyPartPlacementBounds(id.slice("lily-part-".length));
  }

  return null;
}

function getPlacementAssetAt(pointerX, pointerY) {
  const assets = getPlacementAssets();
  for (let index = assets.length - 1; index >= 0; index--) {
    const asset = assets[index];
    const bounds = getPlacementBounds(asset.id);
    if (!bounds) continue;
    if (pointerX >= bounds.x && pointerX <= bounds.x + bounds.w
      && pointerY >= bounds.y && pointerY <= bounds.y + bounds.h) {
      return asset.id;
    }
  }
  return null;
}

function markPlacementChanged(rebuildPond = false) {
  placementHasUnsavedChanges = true;
  if (rebuildPond) placementNeedsCacheRebuild = true;
}

function movePlacementAsset(id, dx, dy) {
  if (!id) return;
  if (id === "pond") {
    POOL_CAMERA.panX += dx / width;
    POOL_CAMERA.panY += dy / height;
    markPlacementChanged(true);
  } else if (id === "tree") {
    TREE.x += dx / width;
    TREE.y += dy / height;
    markPlacementChanged();
  } else if (id.startsWith("tree-part-")) {
    const placement = treePartPlacement[Number(id.split("-")[2])];
    const inverseCos = cos(-TREE.rotation);
    const inverseSin = sin(-TREE.rotation);
    const artworkScale = height * TREE.scale / 1571;
    placement.x += (dx * inverseCos - dy * inverseSin) / artworkScale;
    placement.y += (dx * inverseSin + dy * inverseCos) / artworkScale;
    markPlacementChanged();
  } else if (id === "fish") {
    const sourceDX = dx / view.scale;
    const sourceDY = dy / view.scale;
    FISH_WATER.x += sourceDX;
    FISH_WATER.y += sourceDY;
    for (const fish of fishPopulation) {
      fish.position.x += sourceDX;
      fish.position.y += sourceDY;
      fish.release.x += sourceDX;
      fish.release.y += sourceDY;
    }
    markPlacementChanged();
  } else if (id === "moss") {
    MOSS_ASSEMBLY.x += dx / width;
    MOSS_ASSEMBLY.y += dy / height;
    markPlacementChanged();
  } else if (id.startsWith("moss-part-")) {
    const placement = mossPartPlacement[Number(id.split("-")[2])];
    const inverseCos = cos(-MOSS_ASSEMBLY.rotation);
    const inverseSin = sin(-MOSS_ASSEMBLY.rotation);
    const localDX = dx * inverseCos - dy * inverseSin;
    const localDY = dx * inverseSin + dy * inverseCos;
    const scaleX = width * MOSS_ASSEMBLY.width / MOSS_ASSEMBLY.masterWidth;
    const scaleY = height * MOSS_ASSEMBLY.height / MOSS_ASSEMBLY.masterHeight;
    placement.x += localDX / scaleX;
    placement.y += localDY / scaleY;
    markPlacementChanged();
  } else if (id.startsWith("grass-")) {
    const patch = GRASS_PATCHES[Number(id.split("-")[1])];
    patch.x += dx / width;
    patch.y += dy / height;
    markPlacementChanged();
  } else if (id.startsWith("foreground-grass-")) {
    const part = FOREGROUND_GRASS_PARTS[
      Number(id.slice("foreground-grass-".length))
    ];
    part.x += dx / width;
    part.y += dy / height;
    markPlacementChanged();
  } else if (id === "lilyPads") {
    LILYPAD_VEGETATION.x += dx / width;
    LILYPAD_VEGETATION.y += dy / height;
    markPlacementChanged();
  } else if (id.startsWith("lily-part-")) {
    const name = id.slice("lily-part-".length);
    const placement = lilyPartPlacement[name];
    const inverseCos = cos(-LILYPAD_VEGETATION.rotation);
    const inverseSin = sin(-LILYPAD_VEGETATION.rotation);
    const localDX = dx * inverseCos - dy * inverseSin;
    const localDY = dx * inverseSin + dy * inverseCos;
    const artworkScale = width * LILYPAD_VEGETATION.width
      / LILYPAD_VEGETATION.masterWidth * getLilyPadAssemblyScale();
    placement.x += localDX / artworkScale;
    placement.y += localDY / artworkScale;
    markPlacementChanged();
  }
}

function scalePlacementAsset(id, factor) {
  if (!id || !Number.isFinite(factor)) return;
  factor = constrain(factor, 0.75, 1.33);
  if (id === "pond") {
    POOL_CAMERA.zoom = max(0.1, POOL_CAMERA.zoom * factor);
    markPlacementChanged(true);
  } else if (id === "tree") {
    TREE.scale = max(0.02, TREE.scale * factor);
    markPlacementChanged();
  } else if (id.startsWith("tree-part-")) {
    const placement = treePartPlacement[Number(id.split("-")[2])];
    placement.scale = max(0.02, placement.scale * factor);
    markPlacementChanged();
  } else if (id === "fish") {
    FISH_WATER.width = max(10, FISH_WATER.width * factor);
    FISH_WATER.radiusX = max(10, FISH_WATER.radiusX * factor);
    FISH_WATER.radiusY = max(10, FISH_WATER.radiusY * factor);
    for (const fish of fishPopulation) {
      fish.position.x = FISH_WATER.x
        + (fish.position.x - FISH_WATER.x) * factor;
      fish.position.y = FISH_WATER.y
        + (fish.position.y - FISH_WATER.y) * factor;
      fish.release.x = FISH_WATER.x
        + (fish.release.x - FISH_WATER.x) * factor;
      fish.release.y = FISH_WATER.y
        + (fish.release.y - FISH_WATER.y) * factor;
    }
    markPlacementChanged();
  } else if (id === "moss") {
    MOSS_ASSEMBLY.width = max(0.01, MOSS_ASSEMBLY.width * factor);
    MOSS_ASSEMBLY.height = max(0.01, MOSS_ASSEMBLY.height * factor);
    markPlacementChanged();
  } else if (id.startsWith("moss-part-")) {
    const placement = mossPartPlacement[Number(id.split("-")[2])];
    placement.scale = max(0.02, placement.scale * factor);
    markPlacementChanged();
  } else if (id.startsWith("grass-")) {
    const patch = GRASS_PATCHES[Number(id.split("-")[1])];
    patch.width = max(0.01, patch.width * factor);
    markPlacementChanged();
  } else if (id.startsWith("foreground-grass-")) {
    const part = FOREGROUND_GRASS_PARTS[
      Number(id.slice("foreground-grass-".length))
    ];
    part.height = max(0.01, part.height * factor);
    markPlacementChanged();
  } else if (id === "lilyPads") {
    LILYPAD_VEGETATION.width = max(0.01, LILYPAD_VEGETATION.width * factor);
    markPlacementChanged();
  } else if (id.startsWith("lily-part-")) {
    const name = id.slice("lily-part-".length);
    lilyPartPlacement[name].scale = max(
      0.02,
      lilyPartPlacement[name].scale * factor
    );
    markPlacementChanged();
  }
}

function rotatePlacementAsset(id, angle) {
  if (!id || id === "pond") return;
  if (id === "tree") TREE.rotation += angle;
  else if (id.startsWith("tree-part-")) {
    treePartPlacement[Number(id.split("-")[2])].rotation += angle;
  }
  else if (id === "fish") FISH_WATER.rotation += angle;
  else if (id === "moss") MOSS_ASSEMBLY.rotation += angle;
  else if (id.startsWith("moss-part-")) {
    mossPartPlacement[Number(id.split("-")[2])].rotation += angle;
  }
  else if (id.startsWith("grass-")) {
    GRASS_PATCHES[Number(id.split("-")[1])].angle += angle;
  } else if (id.startsWith("foreground-grass-")) {
    FOREGROUND_GRASS_PARTS[
      Number(id.slice("foreground-grass-".length))
    ].rotation += angle;
  } else if (id === "lilyPads") LILYPAD_VEGETATION.rotation += angle;
  else if (id.startsWith("lily-part-")) {
    lilyPartPlacement[id.slice("lily-part-".length)].rotation += angle;
  }
  markPlacementChanged();
}

function placementPointerPressed(pointerX, pointerY) {
  const panelWidth = min(410, width - 24);
  const panelHeight = placementSelectedId ? 280 : 238;
  if (pointerX >= 12 && pointerX <= 12 + panelWidth
    && pointerY >= 12 && pointerY <= 12 + panelHeight) {
    return false;
  }
  placementSelectedId = getPlacementAssetAt(pointerX, pointerY);
  placementLastPointer.x = pointerX;
  placementLastPointer.y = pointerY;
  return false;
}

function placementPointerDragged(pointerX, pointerY) {
  if (!placementSelectedId) return false;
  movePlacementAsset(
    placementSelectedId,
    pointerX - placementLastPointer.x,
    pointerY - placementLastPointer.y
  );
  placementLastPointer.x = pointerX;
  placementLastPointer.y = pointerY;
  return false;
}

function placementPointerReleased() {
  if (placementNeedsCacheRebuild) {
    rebuildCaches();
    placementNeedsCacheRebuild = false;
    placementLastCacheRebuildAt = millis();
  }
  return false;
}

function cyclePlacementSelection(direction = 1) {
  const assets = getPlacementAssets();
  let index = assets.findIndex((asset) => asset.id === placementSelectedId);
  index = (index + direction + assets.length) % assets.length;
  placementSelectedId = assets[index].id;
}

function getPlacementSummary(id) {
  const layout = getPlacementLayoutData();
  let data;
  if (id === "pond") data = layout.pond;
  else if (id === "fish") data = layout.fish;
  else if (id === "tree") data = layout.tree;
  else if (id && id.startsWith("tree-part-")) {
    data = layout.tree.parts[Number(id.split("-")[2])];
  }
  else if (id === "moss") data = layout.moss;
  else if (id && id.startsWith("moss-part-")) {
    data = layout.moss.parts[Number(id.split("-")[2])];
  }
  else if (id === "lilyPads") data = layout.lilyPads;
  else if (id && id.startsWith("lily-part-")) {
    data = layout.lilyPads.parts[id.slice("lily-part-".length)];
  }
  else if (id && id.startsWith("grass-")) {
    data = layout.grass[Number(id.split("-")[1])];
  }
  else if (id && id.startsWith("foreground-grass-")) {
    data = layout.foregroundGrass[
      Number(id.slice("foreground-grass-".length))
    ];
  }
  if (!data) return "";
  return Object.entries(data)
    .filter((entry) => typeof entry[1] === "number")
    .map(([name, value]) => `${name}: ${Number(value.toFixed(3))}`)
    .join("   ");
}

function drawPlacementUI() {
  const assets = getPlacementAssets();
  push();
  rectMode(CORNER);
  textAlign(LEFT, TOP);
  textSize(12);

  // Show every editable group, with a stronger outline for the selection.
  for (const asset of assets) {
    if (asset.id === "pond") continue;
    if (asset.group && asset.id !== placementSelectedId) continue;
    const bounds = getPlacementBounds(asset.id);
    if (!bounds) continue;
    const selected = asset.id === placementSelectedId;
    noFill();
    stroke(selected ? "#FFE65A" : "rgba(255,255,255,0.32)");
    strokeWeight(selected ? 2.5 : 1);
    rect(bounds.x, bounds.y, bounds.w, bounds.h);
    if (selected) {
      noStroke();
      fill("#FFE65A");
      circle(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2, 7);
      fill(0, 205);
      rect(bounds.x, max(0, bounds.y - 22), textWidth(asset.label) + 14, 22);
      fill("#FFE65A");
      text(asset.label, bounds.x + 7, max(2, bounds.y - 19));
    }
  }

  if (placementSelectedId === "pond") {
    noFill();
    stroke("#FFE65A");
    strokeWeight(3);
    rect(1.5, 1.5, width - 3, height - 3);
  }

  const selectedAsset = assets.find((asset) => asset.id === placementSelectedId);
  const panelWidth = min(410, width - 24);
  const panelHeight = selectedAsset ? 280 : 238;
  noStroke();
  fill(0, 205);
  rect(12, 12, panelWidth, panelHeight, 8);
  fill("#FFE65A");
  textSize(15);
  text(`PLACEMENT MODE${placementHasUnsavedChanges ? "  • UNSAVED" : ""}`, 24, 23);
  fill(255);
  textSize(12);
  text(
    "Click + drag = move\n"
      + "Wheel = scale   / = rotate   ? = reverse\n"
      + "[ and ] also rotate by 2 degrees\n"
      + "Arrow keys = nudge   Shift = 10 px\n"
      + "Tab / Shift+Tab = cycle assets\n"
      + "S = save in browser   E = export JSON\n"
      + "L = load saved   R = restore defaults\n"
      + "P = leave placement mode",
    24,
    51
  );

  if (selectedAsset) {
    fill("#FFE65A");
    textSize(13);
    text(`SELECTED: ${selectedAsset.label}`, 24, 188);
    fill(230);
    textSize(11);
    text(getPlacementSummary(selectedAsset.id), 24, 210, panelWidth - 24, 48);
  }
  if (placementNotice && millis() < placementNoticeUntil) {
    fill("#8DFFB2");
    textSize(12);
    text(placementNotice, 24, panelHeight - 25);
  }
  pop();
}

function togglePlacementMode() {
  placementMode = !placementMode;
  if (placementMode && pondMaskEditorMode) togglePondMaskEditor();
  cursor(placementMode ? "move" : ARROW);
  treePointerDown = false;
  treeDragging = false;
  activeTreePart = -1;
  activePollutableObject = "none";
  const rerollButton = document.getElementById("pond-reroll-lilypads");
  if (rerollButton) rerollButton.hidden = !placementMode;
  if (placementMode) {
    setPlacementNotice("Select an outlined assembly to begin");
  }
}
