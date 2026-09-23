// Debug-only vector/bezier controller for the pond reveal mask's
// distance-field origins (see pond-rendering.js: createPondRevealThresholds/
// buildDefaultPondMaskOrigins). Toggled with M, independent of placement mode
// (P) — the two are mutually exclusive, same as pressing one turns the other
// off. Each origin gets a draggable point (position) plus a small
// bezier-style handle whose distance from the point controls how tight or
// broad that origin's local reveal growth is; pulling the handle out softens
// it, pulling it in sharpens it.

const POND_MASK_HANDLE_MAX_DISTANCE = 0.32; // normalized, vs min(width,height)
const POND_MASK_MIN_GROWTH_RATE = 0.3;
const POND_MASK_MAX_GROWTH_RATE = 1.6;
const POND_MASK_ORIGIN_HIT_RADIUS = 16;
const POND_MASK_REBUILD_THROTTLE_MS = 60;

function initializePondMaskOrigins() {
  if (Array.isArray(pondMaskOrigins) && pondMaskOrigins.length === 16) return;
  pondMaskOrigins = buildDefaultPondMaskOrigins();
}

function rebuildPondMaskThresholdsNow() {
  if (!pondRevealMask) return;
  pondRevealThresholds = createPondRevealThresholds(
    pondRevealMask.width, pondRevealMask.height
  );
  pondMaskLastRebuildAt = millis();
  pondMaskThresholdsDirty = false;
}

// Recomputing the threshold field is the same per-pixel cost as one
// rebuildCaches() pass — fine on release, too much to pay every drag frame —
// so drags throttle it and a release always forces one final exact pass.
function maybeRebuildPondMaskThresholds() {
  pondMaskThresholdsDirty = true;
  if (millis() - pondMaskLastRebuildAt < POND_MASK_REBUILD_THROTTLE_MS) return;
  rebuildPondMaskThresholdsNow();
}

function getPondMaskOriginScreenPosition(origin) {
  return { x: origin.x * width, y: origin.y * height };
}

function getPondMaskHandleScreenPosition(origin) {
  const point = getPondMaskOriginScreenPosition(origin);
  const growthRate = origin.growthRate || POND_MASK_DEFAULT_GROWTH_RATE;
  const normalizedDistance = map(
    growthRate,
    POND_MASK_MAX_GROWTH_RATE, POND_MASK_MIN_GROWTH_RATE,
    0, POND_MASK_HANDLE_MAX_DISTANCE,
    true
  );
  const screenDistance = normalizedDistance * min(width, height);
  const angle = origin.handleAngle || 0;
  return {
    x: point.x + cos(angle) * screenDistance,
    y: point.y + sin(angle) * screenDistance
  };
}

function getPondMaskOriginAt(pointerX, pointerY) {
  for (let index = pondMaskOrigins.length - 1; index >= 0; index--) {
    const point = getPondMaskOriginScreenPosition(pondMaskOrigins[index]);
    if (dist(pointerX, pointerY, point.x, point.y) <= POND_MASK_ORIGIN_HIT_RADIUS) {
      return { index, part: "point" };
    }
  }
  // A separate pass so a point always wins over another origin's overlapping
  // handle, instead of whichever happens to be drawn last.
  for (let index = pondMaskOrigins.length - 1; index >= 0; index--) {
    const handle = getPondMaskHandleScreenPosition(pondMaskOrigins[index]);
    if (dist(pointerX, pointerY, handle.x, handle.y) <= POND_MASK_ORIGIN_HIT_RADIUS) {
      return { index, part: "handle" };
    }
  }
  return null;
}

function pondMaskEditorPointerPressed(pointerX, pointerY) {
  const panelWidth = min(380, width - 24);
  const panelHeight = pondMaskSelectedIndex >= 0 ? 260 : 200;
  if (pointerX >= 12 && pointerX <= 12 + panelWidth
    && pointerY >= 12 && pointerY <= 12 + panelHeight) {
    return false;
  }
  const hit = getPondMaskOriginAt(pointerX, pointerY);
  pondMaskSelectedIndex = hit ? hit.index : -1;
  pondMaskDragPart = hit ? hit.part : null;
  return false;
}

function pondMaskEditorPointerDragged(pointerX, pointerY) {
  if (pondMaskSelectedIndex < 0 || !pondMaskDragPart) return false;
  const origin = pondMaskOrigins[pondMaskSelectedIndex];
  if (!origin) return false;
  if (pondMaskDragPart === "point") {
    origin.x = constrain(pointerX / width, 0.02, 0.98);
    origin.y = constrain(pointerY / height, 0.02, 0.98);
  } else {
    const point = getPondMaskOriginScreenPosition(origin);
    const dx = pointerX - point.x;
    const dy = pointerY - point.y;
    const normalizedDistance = constrain(
      sqrt(dx * dx + dy * dy) / min(width, height),
      0,
      POND_MASK_HANDLE_MAX_DISTANCE
    );
    origin.handleAngle = atan2(dy, dx);
    origin.growthRate = map(
      normalizedDistance,
      0, POND_MASK_HANDLE_MAX_DISTANCE,
      POND_MASK_MAX_GROWTH_RATE, POND_MASK_MIN_GROWTH_RATE,
      true
    );
  }
  pondMaskHasUnsavedChanges = true;
  maybeRebuildPondMaskThresholds();
  return false;
}

function pondMaskEditorPointerReleased() {
  if (pondMaskThresholdsDirty) rebuildPondMaskThresholdsNow();
  return false;
}

function pondMaskEditorWheel(event) {
  if (pondMaskSelectedIndex < 0) return;
  const origin = pondMaskOrigins[pondMaskSelectedIndex];
  if (!origin) return;
  origin.start = constrain(origin.start - event.delta * 0.0004, 0, 1);
  pondMaskHasUnsavedChanges = true;
  maybeRebuildPondMaskThresholds();
}

function setPondMaskNotice(message) {
  pondMaskNotice = message;
  pondMaskNoticeUntil = millis() + 2200;
}

function savePondMaskOrigins() {
  try {
    localStorage.setItem(POND_MASK_STORAGE_KEY, JSON.stringify(pondMaskOrigins));
    pondMaskHasUnsavedChanges = false;
    setPondMaskNotice("Saved in this browser");
  } catch (error) {
    console.warn("Could not save pond mask origins", error);
    setPondMaskNotice("Browser save failed — use E to export JSON");
  }
}

function loadPondMaskOrigins(showNotice = true) {
  try {
    const saved = localStorage.getItem(POND_MASK_STORAGE_KEY);
    if (!saved) return false;
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed) || parsed.length !== 16) return false;
    pondMaskOrigins = parsed;
    pondMaskHasUnsavedChanges = false;
    if (showNotice) setPondMaskNotice("Saved mask loaded");
    return true;
  } catch (error) {
    console.warn("Could not load pond mask origins", error);
    if (showNotice) setPondMaskNotice("Saved mask could not be loaded");
    return false;
  }
}

function exportPondMaskOrigins() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    origins: pondMaskOrigins
  };
  console.log("===== POND MASK ORIGINS =====");
  console.log(JSON.stringify(payload, null, 2));
  saveJSON(payload, "pond-mask-origins.json");
  setPondMaskNotice("Exported pond-mask-origins.json");
}

function resetPondMaskOrigins() {
  pondMaskOrigins = buildDefaultPondMaskOrigins();
  pondMaskHasUnsavedChanges = true;
  rebuildPondMaskThresholdsNow();
  setPondMaskNotice("Defaults restored — press S to save");
}

function drawPondMaskEditorUI() {
  push();
  noFill();
  for (let index = 0; index < pondMaskOrigins.length; index++) {
    const origin = pondMaskOrigins[index];
    const point = getPondMaskOriginScreenPosition(origin);
    const handle = getPondMaskHandleScreenPosition(origin);
    const selected = index === pondMaskSelectedIndex;
    stroke(selected ? "#FFE65A" : "rgba(255,255,255,0.45)");
    strokeWeight(selected ? 2 : 1);
    line(point.x, point.y, handle.x, handle.y);
    noStroke();
    fill(selected ? "#FFE65A" : "rgba(120,220,255,0.85)");
    circle(point.x, point.y, selected ? 14 : 10);
    fill(selected ? "#FFE65A" : "rgba(255,255,255,0.7)");
    circle(handle.x, handle.y, 7);
  }
  pop();

  push();
  rectMode(CORNER);
  textAlign(LEFT, TOP);
  const panelWidth = min(380, width - 24);
  const panelHeight = pondMaskSelectedIndex >= 0 ? 260 : 200;
  noStroke();
  fill(0, 205);
  rect(12, 12, panelWidth, panelHeight, 8);
  fill("#FFE65A");
  textSize(15);
  text(
    `POND MASK EDITOR${pondMaskHasUnsavedChanges ? "  • UNSAVED" : ""}`,
    24, 23
  );
  fill(255);
  textSize(12);
  text(
    "Drag a dot = move that origin\n"
      + "Drag its small handle = reshape local growth\n"
      + "  (pull out = softer/broader, pull in = tighter)\n"
      + "Wheel on a selected origin = adjust start delay\n"
      + "S = save in browser   E = export JSON\n"
      + "L = load saved   R = restore defaults\n"
      + "M = leave mask editor",
    24,
    51
  );
  if (pondMaskSelectedIndex >= 0) {
    const origin = pondMaskOrigins[pondMaskSelectedIndex];
    fill("#FFE65A");
    textSize(13);
    text(
      `SELECTED ORIGIN ${pondMaskSelectedIndex + 1} / ${pondMaskOrigins.length}`,
      24, 168
    );
    fill(230);
    textSize(11);
    text(
      `x: ${origin.x.toFixed(3)}   y: ${origin.y.toFixed(3)}\n`
        + `start: ${origin.start.toFixed(3)}   `
        + `growthRate: ${origin.growthRate.toFixed(3)}`,
      24, 190
    );
  }
  if (pondMaskNotice && millis() < pondMaskNoticeUntil) {
    fill("#8DFFB2");
    textSize(12);
    text(pondMaskNotice, 24, panelHeight - 25);
  }
  pop();
}

function togglePondMaskEditor() {
  pondMaskEditorMode = !pondMaskEditorMode;
  if (pondMaskEditorMode && placementMode) togglePlacementMode();
  cursor(pondMaskEditorMode ? "crosshair" : ARROW);
  treePointerDown = false;
  treeDragging = false;
  activePollutableObject = "none";
  if (pondMaskEditorMode) {
    initializePondMaskOrigins();
    pondMaskSelectedIndex = -1;
    pondMaskDragPart = null;
    setPondMaskNotice("Drag a dot to reshape the pond mask");
  }
}
