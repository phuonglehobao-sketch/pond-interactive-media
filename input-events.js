// Shared mouse, touch, keyboard, and pollutable-object input routing.

const POND_CURSORS = {
  default: "auto",
  hand: 'url("Cursor%20state/hand%20hover.svg") 17 2, auto',
  // Keep the hotspot near the leading tip of the updated v2 artwork.
  knife: 'url("knife-icon-v2.svg") 9 6, pointer',
  drag: 'url("Cursor%20state/drag.svg") 15 15, grabbing',
  edit: "crosshair"
};
let cursorClientPoint = null;
let currentPondCursor = "default";

function initializePondCursor() {
  const canvas = document.querySelector("canvas");
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    if (!pondInteractionEnabled) {
      updatePondCursor(-1, -1);
      return;
    }
    cursorClientPoint = { x: event.offsetX, y: event.offsetY };
    // Computed once and reused by both calls below — this listener and p5's
    // own mouseMoved() (input-events.js) fire independently for the same
    // physical mouse movement, and each used to run the tree/moss/lily/
    // fish/water hit test on its own, several times per event.
    const target = getPollutableTargetAt(cursorClientPoint.x, cursorClientPoint.y);
    updatePondCursor(cursorClientPoint.x, cursorClientPoint.y, target);
    handlePondHoverAudio(target);
  });
  canvas.addEventListener("pointerleave", () => {
    cursorClientPoint = null;
    resetDialogueHoverEntry();
    handlePondHoverAudio(null);
    updatePondCursor(-1, -1);
  });
  window.addEventListener("blur", () => {
    cursorClientPoint = null;
    resetDialogueHoverEntry();
    handlePondHoverAudio(null);
    updatePondCursor(-1, -1);
  });
}

function updatePondCursor(pointerX, pointerY, knownTarget = null) {
  let cursor = "default";
  // A real tracked state (not a raw cursor() call from togglePondMaskEditor())
  // so it survives the very next pointermove instead of being silently
  // overwritten back to "default" the moment currentPondCursor last differed
  // from it — the same bookkeeping placementMode's own cursor relies on.
  if (pondMaskEditorMode) {
    cursor = "edit";
  } else if (pondInteractionEnabled && !placementMode
    && pointerX >= 0 && pointerX <= width
    && pointerY >= 0 && pointerY <= height) {
    const target = knownTarget || getPollutableTargetAt(pointerX, pointerY);
    // Killing itself is already gated on !isDialoguePlaying() (see fish.js:
    // endFishPress) — a kill mid-line would silently drop its own dialogue
    // trigger, since notifyDialogueInteraction no-ops while a line is on
    // screen. The knife cursor was still showing on fish hover regardless,
    // promising an action that wouldn't actually do anything if clicked;
    // falling back to "hand" here (the same cursor any other non-fish
    // pollutable object gets) keeps the cursor truthful about what's
    // actually clickable right now.
    cursor = target.object === "fish" && !isDialoguePlaying() ? "knife" : "hand";
    if (treeDragging || fishPress.dragging) cursor = "drag";
  }
  if (cursor !== currentPondCursor) {
    document.querySelector("canvas").style.cursor = POND_CURSORS[cursor];
    currentPondCursor = cursor;
  }
}

function refreshPondCursor() {
  if (!cursorClientPoint) return;
  updatePondCursor(cursorClientPoint.x, cursorClientPoint.y);
}

function beginPollutableInteraction(pointerX, pointerY, inputType, knownTarget = null) {
  if (!pondInteractionEnabled) return;
  treePointerX = pointerX;
  treePointerY = pointerY;
  const target = knownTarget || getPollutableTargetAt(pointerX, pointerY);
  if (target.object === "fish") {
    beginFishPress(target.part, pointerX, pointerY, inputType);
    return;
  }
  if (target.object !== "none") {
    treePointerDown = true;
    treeDragging = false;
    activePollutableObject = target.object;
    activeTreePart = target.part;
    treePressX = pointerX;
    treePressY = pointerY;
    if (target.object === "tree") {
      triggerTreeVibration(target.part, TREE_INTERACTION.clickShake);
      treeDragRelease.part = -1;
    } else if (target.object === "lilyPad") {
      // A scattered individual pad (see LILYPAD_SCATTER) gets its own
      // push-away, independent of the main assembly's clusters, so
      // clicking one specific stray pad doesn't yank the whole main group.
      const scatterIndex = getLilyPadScatterExtraAt(pointerX, pointerY);
      if (scatterIndex !== -1) {
        pushLilyPadScatterExtraAwayFromPointer(scatterIndex, pointerX, pointerY, 1.6);
      } else {
        pushLilyPadAwayFromPointer(pointerX, pointerY, 1.6);
      }
      lilyPadDragRelease.startedAt = -Infinity;
    } else if (target.object === "moss") {
      disturbMossAtPointer(
        pointerX,
        pointerY,
        MOSS_INTERACTION.clickResponseMultiplier
      );
    }
    if (target.object === "moss" || target.object === "lilyPad"
      || target.object === "water") {
      playPondEffect("waterClick");
    }

    // Damage first, dialogue second — a click can be the one that drives
    // ecosystemHealth across a band boundary (e.g. from >70 into the
    // unhealthy band), and the dialogue check needs to see that new value.
    // Checking before applying the damage made the click that actually
    // crosses into a worse band still get judged against the old, better
    // band, so its stage's first-time line (e.g. "look around you...")
    // missed its one chance to fire on that very interaction.
    applyEcosystemDamage(ECOSYSTEM.clickDamage, inputType, target);
    notifyDialogueInteraction("click", target);
    clickTransitionBoostUntil = millis()
      + TREE_TRANSITION.hoverDuration * 1000;
  } else {
    notifyDialogueInteraction("click", target);
    stopPondEffect("waterHover", 0.04);
    pondAudio.hoverTarget = "none";
    playPondEffect("waterClick");
  }
}

function continuePollutableInteraction(pointerX, pointerY) {
  if (!pondInteractionEnabled) return;
  treePointerX = pointerX;
  treePointerY = pointerY;
  if (updateFishPress(pointerX, pointerY)) {
    return;
  }
  if (!treePointerDown) return;

  if (!treeDragging) {
    const dragDistance = dist(pointerX, pointerY, treePressX, treePressY);
    if (dragDistance >= ECOSYSTEM.dragThreshold) {
      treeDragging = true;
      notifyDialogueInteraction("drag", {
        object: activePollutableObject,
        part: activeTreePart
      });
    }
  }

  if (treeDragging) {
    lastEcosystemInputAt = millis();
    activeInputType = "drag";
  }
}

function endPollutableInteraction(pointerX, pointerY) {
  if (!pondInteractionEnabled) return;
  treePointerX = pointerX;
  treePointerY = pointerY;
  if (endFishPress()) {
    return;
  }
  if (treeDragging && activePollutableObject === "tree"
    && activeTreePart !== -1) {
    const artworkScale = height * TREE.scale / 1571;
    treeDragRelease = {
      part: activeTreePart,
      x: (pointerX - treePressX) / artworkScale,
      y: (pointerY - treePressY) / artworkScale,
      startedAt: millis()
    };
  } else if (treeDragging && activePollutableObject === "lilyPad") {
    lilyPadDragRelease = {
      x: pointerX - treePressX,
      y: pointerY - treePressY,
      startedAt: millis()
    };
  }
  treePointerDown = false;
  treeDragging = false;
  activeTreePart = -1;
  activePollutableObject = "none";
}

function mouseMoved() {
  if (!pondInteractionEnabled) return false;
  if (placementMode || pondMaskEditorMode) return false;
  if (millis() < suppressMouseUntil) return false;
  mouseHoverEnabled = true;
  // Gates continuous hover damage in updateEcosystemHealth — see
  // lastPointerMoveAt's own comment (sketch.js).
  lastPointerMoveAt = millis();
  // One hit test shared by both calls below, instead of each running its
  // own — see the pointermove listener's own comment above. Also cached for
  // updateEcosystemHealth's continuous hover check — see cachedHoverTarget.
  const target = getPollutableTargetAt(mouseX, mouseY);
  cachedHoverTarget = target;
  maybeAddWaterHoverRipple(mouseX, mouseY, false, target);
  updatePollutableHover(mouseX, mouseY, true, target);
}

function mousePressed() {
  if (!pondInteractionEnabled) return false;
  if (pondMaskEditorMode) return pondMaskEditorPointerPressed(mouseX, mouseY);
  if (placementMode) return placementPointerPressed(mouseX, mouseY);
  if (millis() < suppressMouseUntil) return false;
  mouseHoverEnabled = true;
  const target = getPollutableTargetAt(mouseX, mouseY);
  maybeAddWaterHoverRipple(mouseX, mouseY, true, target);
  updatePollutableHover(mouseX, mouseY, false, target);
  beginPollutableInteraction(mouseX, mouseY, "click", target);
}

function mouseDragged() {
  if (!pondInteractionEnabled) return false;
  if (pondMaskEditorMode) return pondMaskEditorPointerDragged(mouseX, mouseY);
  if (placementMode) return placementPointerDragged(mouseX, mouseY);
  if (millis() < suppressMouseUntil) return false;
  const target = getPollutableTargetAt(mouseX, mouseY);
  maybeAddWaterHoverRipple(mouseX, mouseY, false, target);
  continuePollutableInteraction(mouseX, mouseY);
  updatePondCursor(mouseX, mouseY, target);
}

function mouseReleased() {
  if (!pondInteractionEnabled) return false;
  if (pondMaskEditorMode) return pondMaskEditorPointerReleased();
  if (placementMode) return placementPointerReleased();
  if (millis() < suppressMouseUntil) return false;
  endPollutableInteraction(mouseX, mouseY);
  updatePondCursor(mouseX, mouseY);
}

function mouseWheel(event) {
  if (!pondInteractionEnabled) return;
  if (pondMaskEditorMode) {
    pondMaskEditorWheel(event);
    return false;
  }
  if (!placementMode || !placementSelectedId) return;
  scalePlacementAsset(placementSelectedId, exp(-event.delta * 0.001));
  return false;
}

function keyPressed(event) {
  // Debug only — clears every saved localStorage key this project writes
  // and reloads. Checked before the pondInteractionEnabled guard below (and
  // every other shortcut in this function is gated behind it) because this
  // is the escape hatch for a stuck/bad state — pondInteractionEnabled
  // starts false and only flips true once the intro cover screen's Start
  // button is clicked (see app.js), so gating this behind it too meant the
  // reset silently did nothing whenever it was needed most. Shift+Backspace/
  // Delete rather than a bare letter since, unlike P/M below, this one is
  // destructive and not meant to be reachable by an accidental keystroke.
  // Checks both keyCodes since "Backspace" and "Delete" are genuinely
  // different keys/codes (8 vs 46) depending on keyboard/OS — a Mac laptop's
  // "delete" key sends BACKSPACE (8), while a full keyboard's dedicated
  // Delete key (or Mac Fn+Delete) sends DELETE (46), so binding only one
  // left the other silently doing nothing.
  if ((keyCode === BACKSPACE || keyCode === DELETE) && keyIsDown(SHIFT)) {
    hardResetPondState();
    return false;
  }
  if (!pondInteractionEnabled) return;
  if (key === "p" || key === "P") {
    togglePlacementMode();
    return false;
  }
  if (key === "m" || key === "M") {
    togglePondMaskEditor();
    return false;
  }
  if (key === "h" || key === "H") {
    // Also gates drawFpsCounter() (see app.js) — one toggle for both debug
    // overlays, so a demo can hide either at once with a single keypress.
    debugHealthStatVisible = !debugHealthStatVisible;
    return false;
  }
  if (pondMaskEditorMode) {
    if (key === "s" || key === "S") {
      savePondMaskOrigins();
      return false;
    }
    if (key === "e" || key === "E") {
      exportPondMaskOrigins();
      return false;
    }
    if (key === "l" || key === "L") {
      if (loadPondMaskOrigins()) rebuildPondMaskThresholdsNow();
      return false;
    }
    if (key === "r" || key === "R") {
      resetPondMaskOrigins();
      return false;
    }
    if (keyCode === ESCAPE) {
      pondMaskSelectedIndex = -1;
      pondMaskDragPart = null;
      return false;
    }
    return;
  }
  if (!placementMode) return;

  if (keyCode === TAB) {
    cyclePlacementSelection(keyIsDown(SHIFT) ? -1 : 1);
    return false;
  }
  if (key === "s" || key === "S") {
    savePlacementLayout();
    return false;
  }
  if (key === "e" || key === "E") {
    exportPlacementLayout();
    return false;
  }
  if (key === "l" || key === "L") {
    if (loadPlacementLayout()) rebuildCaches();
    return false;
  }
  if (key === "r" || key === "R") {
    resetPlacementLayout();
    return false;
  }
  if (keyCode === ESCAPE) {
    placementSelectedId = null;
    return false;
  }
  if (!placementSelectedId) return;

  const nudge = keyIsDown(SHIFT) ? 10 : 1;
  const slashPressed = key === "/" || key === "?" || keyCode === 191
    || (event && event.code === "Slash");
  if (slashPressed) {
    const reverseRotation = key === "?" || (event && event.shiftKey);
    rotatePlacementAsset(
      placementSelectedId,
      radians(reverseRotation ? -2 : 2)
    );
  }
  else if (keyCode === LEFT_ARROW) movePlacementAsset(placementSelectedId, -nudge, 0);
  else if (keyCode === RIGHT_ARROW) movePlacementAsset(placementSelectedId, nudge, 0);
  else if (keyCode === UP_ARROW) movePlacementAsset(placementSelectedId, 0, -nudge);
  else if (keyCode === DOWN_ARROW) movePlacementAsset(placementSelectedId, 0, nudge);
  else if (key === "[") rotatePlacementAsset(placementSelectedId, -radians(2));
  else if (key === "]") rotatePlacementAsset(placementSelectedId, radians(2));
  else return;
  return false;
}

function touchStarted() {
  if (!pondInteractionEnabled) return false;
  if (touches.length === 0) return false;
  if (pondMaskEditorMode) {
    return pondMaskEditorPointerPressed(touches[0].x, touches[0].y);
  }
  if (placementMode) {
    return placementPointerPressed(touches[0].x, touches[0].y);
  }
  touchInputActive = true;
  mouseHoverEnabled = false;
  suppressMouseUntil = millis() + 800;
  const target = getPollutableTargetAt(touches[0].x, touches[0].y);
  maybeAddWaterHoverRipple(touches[0].x, touches[0].y, true, target);
  beginPollutableInteraction(touches[0].x, touches[0].y, "touch", target);
  return false;
}
   
function touchMoved() {
  if (!pondInteractionEnabled) return false;
  if (pondMaskEditorMode && touches.length > 0) {
    return pondMaskEditorPointerDragged(touches[0].x, touches[0].y);
  }
  if (placementMode && touches.length > 0) {
    return placementPointerDragged(touches[0].x, touches[0].y);
  }
  if (touches.length > 0) {
    continuePollutableInteraction(touches[0].x, touches[0].y);
  }
  return false;
}

function touchEnded() {
  if (!pondInteractionEnabled) return false;
  if (pondMaskEditorMode) return pondMaskEditorPointerReleased();
  if (placementMode) return placementPointerReleased();
  endPollutableInteraction(treePointerX, treePointerY);
  stopPondWaterAudio(true);
  touchInputActive = false;
  mouseHoverEnabled = false;
  suppressMouseUntil = millis() + 800;
  return false;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight, true);
  rebuildCaches();
  if (!pondExperienceStarted) redraw();
  refreshPondCursor();
}
