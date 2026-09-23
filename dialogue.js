// Dialogue state, conditional playback, persistence, and rendering.
// Implements the production-planning dialogue sheet: Stage 1 (Friendly,
// >70%), Stage 2 (Intimidated, 40-70%), Stage 3 (Hostile, 10-40%), and the
// Stage 4 (Distrust) idle-recovery overlay.

function loadDialogueHistory() {
  try {
    return JSON.parse(localStorage.getItem(DIALOGUE.storageKey)) || {};
  } catch (error) {
    console.warn("Could not load dialogue history", error);
    return {};
  }
}

function saveDialogueHistory() {
  try {
    localStorage.setItem(DIALOGUE.storageKey, JSON.stringify(dialogueHistory));
  } catch (error) {
    console.warn("Could not save dialogue history", error);
  }
}

function restoreSavedEcosystemHealth() {
  const savedHistory = loadDialogueHistory();
  if (!Number.isFinite(savedHistory.lastKnownHealth)) return false;
  ecosystemHealth = constrain(
    savedHistory.lastKnownHealth,
    ECOSYSTEM.minHealth,
    ECOSYSTEM.maxHealth
  );
  treeTransition = getTreeStateTarget();
  treeTransitionVelocity = 0;
  return true;
}

function isFriendlyDialogueStage() {
  return ecosystemHealth > TREE_HEALTH_BANDS.healthyAbove;
}

// Stage bands shared by every dialogue decision below.
function isHealthyBand(health) {
  return health > TREE_HEALTH_BANDS.healthyAbove;
}

function isUnhealthyBand(health) {
  return health >= TREE_HEALTH_BANDS.deadBelow
    && health <= TREE_HEALTH_BANDS.healthyAbove;
}

function isHostileBand(health) {
  return health >= 10 && health < TREE_HEALTH_BANDS.deadBelow;
}

// The full dead/hostile range, including the 0-10 floor isHostileBand
// excludes (that floor is meaningful for which interaction line plays, but
// not for "has recovery started" — a "hm." that can't fire until health has
// already trickled up to 10 defeats the point of a recovery-start line when
// healing began at 0%).
function isDeadBand(health) {
  return health < TREE_HEALTH_BANDS.deadBelow;
}

function getBandVoice(health) {
  if (isHealthyBand(health)) return "healthyDialogue";
  if (isUnhealthyBand(health)) return "unhealthyDialogue";
  return "deadDialogue";
}

function showDialogue(text, voice = "healthyDialogue") {
  if (!text || isDialoguePlaying()) return false;
  const now = millis();
  dialogue.active = true;
  dialogue.text = text;
  dialogue.voice = voice;
  playDialogueVoice(voice);
  dialogue.startedAt = now;
  dialogue.endsAt = now
    + text.length / DIALOGUE.charactersPerSecond * 1000
    + DIALOGUE.holdDuration;
  return true;
}

function isDialoguePlaying() {
  if (!dialogue.active) return false;
  if (millis() >= dialogue.endsAt) {
    dialogue.active = false;
    return false;
  }
  return true;
}

function playFirstDialogue(key, text, voice) {
  if (dialogueHistory[key] || !showDialogue(text, voice)) return false;
  dialogueHistory[key] = 1;
  saveDialogueHistory();
  return true;
}

function getDialogueTargetType(target) {
  if (!target || target.object === "none" || target.object === "water") {
    return "water";
  }
  if (target.object === "fish") return "fish";
  if (target.object === "tree") {
    const part = TREE_PARTS[target.part];
    return part && part.name.startsWith("leaf") ? "leaves" : "other";
  }
  if (target.object === "moss" || target.object === "lilyPad") {
    return "environment";
  }
  return "other";
}

function isDialogueEnvironment(type) {
  return type === "water" || type === "leaves" || type === "environment";
}

// Stage 4 (Distrust) becomes available once the pond has been driven into
// Stage 3 (Hostile, health < deadBelow) at least once; it is never active
// during Stage 1.
function ensureStage4Activation(health) {
  if (health > TREE_HEALTH_BANDS.deadBelow) return;
  dialogueRecovery.active = true;
  if (!dialogueHistory.stage4Unlocked) {
    dialogueHistory.stage4Unlocked = true;
    saveDialogueHistory();
  }
}

function resetDialogueHoverEntry() {
  dialogueHoverTarget = null;
}

function registerDialogueHoverEntry(target) {
  const type = getDialogueTargetType(target);
  const key = `${target.object}:${target.part}:${type}`;
  if (key === dialogueHoverTarget) return false;
  dialogueHoverTarget = key;
  return notifyDialogueInteraction("hover", target);
}

function notifyDialogueInteraction(action, target, options = {}) {
  if (isDialoguePlaying()) return false;
  const health = Number.isFinite(options.health)
    ? options.health : ecosystemHealth;
  const type = getDialogueTargetType(target);
  const idleSeconds = (millis() - lastEcosystemInputAt) / 1000;
  const relevantAction = action === "hover" || action === "click"
    || action === "drag" || action === "fishKill" || action === "fishDragKill"
    || action === "fishDragDead" || action === "fishClickDead";
  ensureStage4Activation(health);

  // Stage 4: Distrust — once active, prior friendly/intimidated interaction
  // lines do not return; only the idle-recovery interruption lines can fire.
  if (dialogueRecovery.active && relevantAction) {
    const relevantTarget = isDialogueEnvironment(type) || type === "fish";
    if (relevantTarget && !dialogueRecovery.fired.damagedInterruption
      && isHostileBand(health)
      && idleSeconds >= 1 && idleSeconds < 8) {
      dialogueRecovery.fired.damagedInterruption = true;
      return showDialogue("tch. predictable", "deadDialogue");
    }
    if (relevantTarget && !dialogueRecovery.fired.partialInterruption
      && isUnhealthyBand(health)
      && idleSeconds >= 16 && idleSeconds < 24) {
      dialogueRecovery.fired.partialInterruption = true;
      return showDialogue(
        "you just couldn't help yourself now, could you?",
        "unhealthyDialogue"
      );
    }
    if (relevantTarget && !dialogueRecovery.fired.fullInterruption
      && isHealthyBand(health)
      && idleSeconds >= 35) {
      dialogueRecovery.fired.fullInterruption = true;
      return showDialogue("...some things never change.", "healthyDialogue");
    }
    // Stage 3's own hostile-band hover/drag lines are meant to keep
    // repeating on every attempt even once Stage 4 has unlocked — this
    // block's own comment only promises Stage 1/2's one-time lines stop
    // returning, not Stage 3's repeatable ones. Without this, the first
    // dip below 40% latched dialogueRecovery.active permanently (see
    // ensureStage4Activation — it's never reset except on page load), which
    // silently blocked every hostile-band environment line for the rest of
    // the session behind this unconditional return. Everything else (fish
    // actions, non-hostile bands) still stops here exactly as before.
    const hostileEnvironmentInteraction = isHostileBand(health)
      && (action === "hover" || action === "drag")
      && isDialogueEnvironment(type);
    if (!hostileEnvironmentInteraction) return false;
  }

  // Fish kills escalate through their own count, independent of the exact
  // health band — the sheet lists the second kill as valid at both >70%
  // and 40-70%.
  if (action === "fishKill") {
    const killCount = dialogueHistory.fishKillCount || 0;
    dialogueHistory.fishKillCount = killCount + 1;
    saveDialogueHistory();
    if (killCount === 0) return showDialogue("...hey.", "unhealthyDialogue");
    if (killCount === 1) {
      return showDialogue("....that's the second one.", "unhealthyDialogue");
    }
    return false;
  }

  // Stage 3: dragging a living fish (which now kills it once the pond isn't
  // fully healthy) fires its own one-time line.
  if (action === "fishDragKill") {
    return playFirstDialogue(
      "fishDragKill", "is this funny to you?", "unhealthyDialogue"
    );
  }

  // Stage 3: dragging an already-dead fish's corpse around.
  if (action === "fishDragDead") {
    if (!dialogueHistory.fishDragKill || isHealthyBand(health)) return false;
    return showDialogue(
      "like a child, moving her favorite dolls around, eh?", "deadDialogue"
    );
  }

  // Stage 3: clicking an already-dead fish, hostile band only.
  if (action === "fishClickDead") {
    if (!isHostileBand(health)) return false;
    return showDialogue("you seem curious, how amusing", "deadDialogue");
  }

  // Stage 2: Intimidated (40-70%).
  if (isUnhealthyBand(health)) {
    if ((action === "hover" || action === "click")
      && isDialogueEnvironment(type)) {
      if (!dialogueHistory.stage2Warning) {
        return playFirstDialogue(
          "stage2Warning",
          "look around you. you might not want to do that",
          "unhealthyDialogue"
        );
      }
      const repeatCount = (dialogueHistory.stage2EnvRepeatCount || 0) + 1;
      dialogueHistory.stage2EnvRepeatCount = repeatCount;
      saveDialogueHistory();
      if (repeatCount >= 3) {
        return playFirstDialogue(
          "stage2WorkingTerms",
          "i guess you like working in your own terms.",
          "unhealthyDialogue"
        );
      }
      return false;
    }
    if (action === "drag" && isDialogueEnvironment(type)) {
      if (!dialogueHistory.stage2Drag) {
        return playFirstDialogue("stage2Drag", "quit it.", "unhealthyDialogue");
      }
      return showDialogue(
        "you are enjoying this way too much", "unhealthyDialogue"
      );
    }
    return false;
  }

  // Stage 3: Hostile (10-40%) — environment hover/drag repeat every time.
  if (isHostileBand(health)) {
    if (action === "hover" && isDialogueEnvironment(type)) {
      return showDialogue(
        "your definition of fun is rather concerning", "deadDialogue"
      );
    }
    if (action === "drag" && isDialogueEnvironment(type)) {
      return showDialogue(
        "death is entertaining for those alive, i presume", "deadDialogue"
      );
    }
    return false;
  }

  // Stage 1: Friendly (>70%).
  if (isHealthyBand(health)) {
    if (action === "hover" && type === "leaves") {
      return playFirstDialogue(
        "leafHover",
        "this is the best time of the year to see this place",
        "healthyDialogue"
      );
    }
    if (action === "click" && isDialogueEnvironment(type)) {
      return playFirstDialogue(
        "objectClick",
        "watch out, the roads are slippery",
        "healthyDialogue"
      );
    }
  }
  return false;
}

// Reload and "leave window & return" share one lifetime counter: the first
// occurrence ever (regardless of which stage it happens in) uses that
// stage's first-time line, and every occurrence after that uses the
// matching stage's repeated line. Only Stage 1 escalates further to a
// distinct third-time line.
function selectReloadReturnText(eventName, health, count) {
  if (isHealthyBand(health)) {
    if (count === 0) {
      return eventName === "reload"
        ? "hm? welcome back"
        : "oh, you were gone for a while.";
    }
    if (count === 1) return "you busy, my friend?";
    return "what else are you looking for?";
  }
  if (isUnhealthyBand(health)) {
    return count === 0
      ? "...not an option, my friend"
      : "you seem unconvinced. entertain yourself, then.";
  }
  if (isHostileBand(health)) {
    return count === 0
      ? "oh, suddenly you seem so interested in backing out"
      : "if only life is that easy, eh?";
  }
  return null;
}

function playConditionalDialogue(eventName, options = {}) {
  if (isDialoguePlaying()) return false;
  const health = Number.isFinite(options.health)
    ? options.health : ecosystemHealth;
  const count = dialogueHistory.reloadReturnCount || 0;
  const text = selectReloadReturnText(eventName, health, count);
  if (!text || !showDialogue(text, getBandVoice(health))) return false;
  dialogueHistory.reloadReturnCount = count + 1;
  saveDialogueHistory();
  return true;
}

// Gated on the CURRENT band, not a fixed clock — the previous fixed windows
// (8-16s, 16-24s, 24-35s, 35s+) silently assumed recovery always takes the
// full ~38s (i.e. health started near 0). Starting only just below the
// Stage-4 threshold (barely under 40) reaches 100 in well under 16 seconds,
// racing straight through those windows while their band condition wasn't
// true yet or already stopped being true — skipping most of the sequence.
// minIdleSeconds is now just "how long to keep settled in this band before
// it feels earned," not a slot in a shared timeline; nothing here assumes
// how long the whole recovery takes.
function tryRecoveryDialogue(key, minIdleSeconds, condition, text, voice) {
  if (dialogueRecovery.fired[key]) return false;
  const idleSeconds = (millis() - lastEcosystemInputAt) / 1000;
  if (idleSeconds < minIdleSeconds) return false;
  if (!condition()) return false;
  // Only consume this line's one shot once it actually plays — otherwise a
  // still-playing prior line silently eats this one forever instead of
  // retrying once the previous one finishes.
  if (isDialoguePlaying()) return false;
  dialogueRecovery.fired[key] = true;
  return showDialogue(text, voice);
}

function updateDialogueNarrative() {
  ensureStage4Activation(ecosystemHealth);
  if (dialogueRecovery.inputAt !== lastEcosystemInputAt) {
    dialogueRecovery.inputAt = lastEcosystemInputAt;
    dialogueRecovery.fired = {};
  }
  if (!dialogueRecovery.active) return;
  // isDeadBand, not isHostileBand — this sequence tracks "has recovery
  // started," which should hold from the moment health is anywhere below
  // deadBelow, not wait for it to already have climbed up into
  // isHostileBand's narrower 10-40 floor first.
  tryRecoveryDialogue(
    "damaged", 6,
    () => isDeadBand(ecosystemHealth),
    "hm.", "deadDialogue"
  );
  // Chained off "damaged" as idle-time offsets (6s + 8s, then + 16s more),
  // not as separate independent windows — same tryRecoveryDialogue
  // mechanism, just threading a short follow-up exchange through the
  // dead band instead of one isolated line.
  tryRecoveryDialogue(
    "damagedFollowup1", 14,
    () => isDeadBand(ecosystemHealth),
    "what's wrong? don't like what you see?", "deadDialogue"
  );
  tryRecoveryDialogue(
    "damagedFollowup2", 30,
    () => isDeadBand(ecosystemHealth),
    "getting impatient, are we?", "deadDialogue"
  );
  tryRecoveryDialogue(
    "partialEarly", 6,
    () => isUnhealthyBand(ecosystemHealth),
    "oh, now you stop fiddling around.", "unhealthyDialogue"
  );
  // Requires a much longer dwell in the unhealthy band specifically — "your
  // patience has been remarkable" only makes sense once you've actually
  // been waiting a good while, not the instant you enter that band.
  tryRecoveryDialogue(
    "partialLate", 20,
    () => isUnhealthyBand(ecosystemHealth),
    "your patience has been remarkable", "unhealthyDialogue"
  );
  // Gated much tighter than isHealthyBand (>70) — this line is meant to land
  // once the pond is essentially all the way back, not the moment it merely
  // crosses into the healthy band.
  tryRecoveryDialogue(
    "full", 8,
    () => ecosystemHealth >= 98,
    "well wont you look at that, beatiful aint it?", "healthyDialogue"
  );
}

function initializeDialogue() {
  dialogueHistory = loadDialogueHistory();
  dialogueRecovery.active = false;
  dialogueRecovery.inputAt = lastEcosystemInputAt;
  dialogueRecovery.fired = {};
  const visitCount = dialogueHistory.visitCount || 0;
  dialogueHistory.visitCount = visitCount + 1;
  saveDialogueHistory();
  if (visitCount === 0) {
    showDialogue(
      "welcome, it has been a while since we have guests",
      "healthyDialogue"
    );
  } else {
    playConditionalDialogue("reload", {
      health: Number.isFinite(dialogueHistory.lastKnownHealth)
        ? dialogueHistory.lastKnownHealth : ecosystemHealth
    });
  }
}

function handleDialoguePageHide() {
  dialogueHistory.lastKnownHealth = ecosystemHealth;
  saveDialogueHistory();
}

function handleDialogueVisibility() {
  if (document.hidden) {
    dialogueWasHiddenAt = millis();
    return;
  }
  if (dialogueWasHiddenAt > -Infinity
    && millis() - dialogueWasHiddenAt > 400) {
    playConditionalDialogue("return");
  }
  dialogueWasHiddenAt = -Infinity;
}

function drawDialogue() {
  if (!isDialoguePlaying()) return;
  const visibleCharacters = min(
    dialogue.text.length,
    floor((millis() - dialogue.startedAt) / 1000 * DIALOGUE.charactersPerSecond)
  );
  const textToDraw = dialogue.text.slice(0, visibleCharacters);
  const remaining = dialogue.endsAt - millis();
  const alpha = remaining < 300 ? map(remaining, 0, 300, 0, 255) : 255;
  const fontSize = constrain(
    width * DIALOGUE.fontSize,
    DIALOGUE.minFontSize,
    DIALOGUE.maxFontSize
  );

  push();
  textAlign(CENTER, CENTER);
  textSize(fontSize);
  if (dialogueFont) textFont(dialogueFont);
  const context = drawingContext;
  context.save();
  context.globalAlpha = alpha / 255;
  context.shadowColor = "rgba(0, 0, 0, 0.92)";
  context.shadowBlur = DIALOGUE.shadowBlur;
  context.shadowOffsetY = fontSize * 0.2;
  noStroke();
  fill(255);
  // The shadow's own alpha (0.92) is already near its ceiling, so it can't
  // be pushed further directly — most of an 80px-blur halo actually sits far
  // below that, in the soft outer falloff, not at the near-opaque core.
  // Drawing the shadowed text twice compounds that falloff into a genuinely
  // darker halo across its whole spread (the solid white text on top is
  // unaffected by drawing it twice — full opacity either way), which is
  // what "2x darker" actually means once the alpha channel alone is maxed
  // out.
  const wrapWidth = width * 0.84;
  // Wrap by width only — no height limit — so a sentence that wraps to a
  // second or third line stays fully visible instead of being clipped.
  text(textToDraw, width * 0.08, height * 0.8, wrapWidth);
  text(textToDraw, width * 0.08, height * 0.8, wrapWidth);
  context.restore();
  pop();
}
