// Centralized playback and category mixing for the project's existing audio.
const POND_AUDIO_MIX = Object.freeze({
  master: 1,
  music: 0.38,
  dialogue: 1.4,
  interaction: 1.1
});

const POND_AUDIO_TIMING = Object.freeze({
  ambienceRestartMs: 80,
  musicFollowRate: 24,
  hoverReleaseMs: 1000,
  hoverStopFadeSeconds: 1
});

const POND_EFFECT_POLICIES = Object.freeze({
  healthyDialogue: { cooldownMs: 180, blockWhilePlaying: true },
  unhealthyDialogue: { cooldownMs: 180, blockWhilePlaying: true },
  deadDialogue: { cooldownMs: 180, blockWhilePlaying: true },
  waterHover: { cooldownMs: 45, startOffset: 0.28 },
  waterClick: { cooldownMs: 35, startOffset: 0 },
  fishAttack: { cooldownMs: 45 },
  treeLeave: { cooldownMs: 60 }
});

const pondAudio = {
  unlocked: false,
  ambienceStarted: false,
  lastAmbiencePlayAt: -Infinity,
  ambience: {},
  effects: {},
  effectFiles: {},
  effectBuffers: {},
  effectBufferPromises: {},
  effectBufferFailures: {},
  effectsReady: null,
  effectNodes: {},
  effectSources: {},
  pendingEffects: {},
  effectStopTimers: {},
  hoverReleaseTimers: {},
  activeHoverEffects: {},
  ambienceNodes: {},
  context: null,
  buses: {},
  hoverTarget: "none",
  lastEffectAt: {}
};

function initializePondAudio() {
  const ambienceFiles = {
    healthy: "Ambience mix/healthy.m4a",
    unhealthy: "Ambience mix/unhealthy state.m4a",
    dead: "Ambience mix/dead.m4a"
  };
  const effectFiles = {
    healthyDialogue: "Dialougue sounds/dialougue sound 2 (healthy )    .wav",
    unhealthyDialogue: "Dialougue sounds/dialougue sound 2 (unhealthy)    .wav",
    deadDialogue: "Dialougue sounds/dialougue sound 3 (dead)    .wav",
    waterHover: "sfx/Water-splash-second-prolonged-ripple.wav",
    waterClick: "sfx/Click-water-souond.wav",
    fishAttack: "sfx/Water-splash-attack.wav",
    treeLeave: "sfx/leave-tree sfx.mp3"
  };
  pondAudio.effectFiles = effectFiles;
  for (const [name, file] of Object.entries(ambienceFiles)) {
    const sound = new Audio(file);
    sound.loop = true;
    sound.preload = "auto";
    sound.volume = 0;
    pondAudio.ambience[name] = sound;
    sound.load();
  }
  initializePondAudioMixer();
  applyPondAmbienceGains(true);
  if (pondAudio.context) {
    pondAudio.effectsReady = preloadPondEffectBuffers(effectFiles);
  } else {
    for (const name of Object.keys(effectFiles)) createPondEffectFallback(name);
  }
  const unlock = (event) => {
    if (pondAudio.unlocked) return;
    if (!pondExperienceStarted && event.target?.id !== "pond-start") return;
    pondAudio.unlocked = true;
    pondAudio.hoverTarget = "none";
    document.removeEventListener("pointerdown", unlock, true);
    document.removeEventListener("keydown", unlock, true);
    const resume = pondAudio.context && pondAudio.context.state !== "running"
      ? pondAudio.context.resume().catch(() => {})
      : Promise.resolve();
    // Start synchronized media during the gesture while Web Audio resumes.
    startPondAmbience();
    updatePondAudio();
    resume.then(() => {
      startPondAmbience();
      updatePondAudio();
    });
    if (isDialoguePlaying()) {
      playDialogueVoice(dialogue.voice);
    }
  };
  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("keydown", unlock, true);
}

function startPondAmbience() {
  if (!pondAudio.unlocked) return;
  const firstStart = !pondAudio.ambienceStarted;
  if (firstStart) applyPondAmbienceGains(true);
  pondAudio.ambienceStarted = true;
  pondAudio.lastAmbiencePlayAt = millis();
  for (const sound of Object.values(pondAudio.ambience)) {
    if (firstStart) sound.currentTime = 0;
    if (sound.paused) sound.play().catch(() => {});
  }
}

function initializePondAudioMixer() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    for (const sound of Object.values(pondAudio.effects)) sound.volume = 1;
    console.warn("Web Audio mixing is unavailable; using capped audio levels.");
    return;
  }

  const context = new AudioContextClass();
  const master = context.createGain();
  const music = context.createGain();
  const dialogue = context.createGain();
  const interaction = context.createGain();
  const limiter = context.createDynamicsCompressor();
  master.gain.value = POND_AUDIO_MIX.master;
  music.gain.value = POND_AUDIO_MIX.music;
  dialogue.gain.value = POND_AUDIO_MIX.dialogue;
  interaction.gain.value = POND_AUDIO_MIX.interaction;
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;
  music.connect(master);
  dialogue.connect(master);
  interaction.connect(master);
  master.connect(limiter);
  limiter.connect(context.destination);

  for (const [name, sound] of Object.entries(pondAudio.ambience)) {
    const trackGain = context.createGain();
    trackGain.gain.value = 0;
    context.createMediaElementSource(sound).connect(trackGain);
    trackGain.connect(music);
    pondAudio.ambienceNodes[name] = trackGain;
  }
  pondAudio.context = context;
  pondAudio.buses = { master, music, dialogue, interaction, limiter };
}

function getPondEffectBus(name) {
  return name.endsWith("Dialogue")
    ? pondAudio.buses.dialogue
    : pondAudio.buses.interaction;
}

function createPondEffectFallback(name) {
  if (pondAudio.effects[name]) return pondAudio.effects[name];
  const file = pondAudio.effectFiles[name];
  if (!file) return null;
  const sound = new Audio(file);
  sound.preload = "auto";
  sound.volume = 1;
  pondAudio.effects[name] = sound;
  if (pondAudio.context) {
    const effectGain = pondAudio.context.createGain();
    effectGain.gain.value = 1;
    pondAudio.context.createMediaElementSource(sound).connect(effectGain);
    effectGain.connect(getPondEffectBus(name));
    pondAudio.effectNodes[name] = effectGain;
  }
  sound.load();
  return sound;
}

function preloadPondEffectBuffers(effectFiles) {
  if (!pondAudio.context) return Promise.resolve([]);
  const requests = [];
  for (const [name, file] of Object.entries(effectFiles)) {
    const request = fetch(file)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => pondAudio.context.decodeAudioData(data))
      .then((buffer) => {
        pondAudio.effectBuffers[name] = buffer;
        return buffer;
      })
      .catch((error) => {
        pondAudio.effectBufferFailures[name] = true;
        createPondEffectFallback(name);
        console.warn(`Could not predecode ${file}; using media playback.`, error);
        throw error;
      });
    pondAudio.effectBufferPromises[name] = request;
    requests.push(request);
  }
  return Promise.allSettled(requests);
}

function isPondEffectPlaying(name) {
  const fallback = pondAudio.effects[name];
  return Boolean(pondAudio.effectSources[name]?.size)
    || Boolean(fallback && !fallback.paused);
}

function startPondBufferedEffect(name, buffer) {
  if (!pondAudio.context || !buffer) return false;
  const policy = POND_EFFECT_POLICIES[name] || { cooldownMs: 60 };
  if (policy.restart && isPondEffectPlaying(name)) {
    stopPondEffect(name, 0.015);
  }
  const source = pondAudio.context.createBufferSource();
  const gain = pondAudio.context.createGain();
  const sources = pondAudio.effectSources[name] || new Set();
  const entry = { source, gain };
  source.buffer = buffer;
  gain.gain.value = 1;
  source.connect(gain);
  gain.connect(getPondEffectBus(name));
  sources.add(entry);
  pondAudio.effectSources[name] = sources;
  source.addEventListener("ended", () => {
    sources.delete(entry);
    source.disconnect();
    gain.disconnect();
    if (sources.size === 0) delete pondAudio.effectSources[name];
  });
  source.start(0, Math.min(policy.startOffset || 0, buffer.duration));
  return true;
}

function playPondEffectFallback(name) {
  const sound = createPondEffectFallback(name);
  if (!sound) return false;
  const policy = POND_EFFECT_POLICIES[name] || {};
  const effectNode = pondAudio.effectNodes[name];
  if (effectNode && pondAudio.context) {
    effectNode.gain.cancelScheduledValues(pondAudio.context.currentTime);
    effectNode.gain.setValueAtTime(1, pondAudio.context.currentTime);
  } else {
    sound.volume = 1;
  }
  sound.currentTime = policy.startOffset || 0;
  sound.play().catch(() => {});
  return true;
}

function playPondEffect(name) {
  if (!pondAudio.unlocked) return false;
  const policy = POND_EFFECT_POLICIES[name] || { cooldownMs: 60 };
  if (!pondAudio.effectFiles[name]) return false;
  const now = millis();
  if ((policy.blockWhilePlaying && isPondEffectPlaying(name))
    || now - (pondAudio.lastEffectAt[name] ?? -Infinity)
      < policy.cooldownMs) {
    return false;
  }
  pondAudio.lastEffectAt[name] = now;
  if (pondAudio.effectStopTimers[name]) {
    clearTimeout(pondAudio.effectStopTimers[name]);
    delete pondAudio.effectStopTimers[name];
  }
  const buffer = pondAudio.effectBuffers[name];
  if (buffer && pondAudio.context) {
    if (pondAudio.context.state !== "running") {
      pondAudio.context.resume().catch(() => {});
    }
    return startPondBufferedEffect(name, buffer);
  }
  const pending = pondAudio.effectBufferPromises[name];
  if (pending && !pondAudio.effectBufferFailures[name]) {
    const token = (pondAudio.pendingEffects[name] || 0) + 1;
    pondAudio.pendingEffects[name] = token;
    pending.then((decodedBuffer) => {
      if (!pondAudio.unlocked || pondAudio.pendingEffects[name] !== token) return;
      delete pondAudio.pendingEffects[name];
      if (name.endsWith("Dialogue")
        && (!isDialoguePlaying() || dialogue.voice !== name)) return;
      startPondBufferedEffect(name, decodedBuffer);
    }).catch(() => {
      if (pondAudio.pendingEffects[name] !== token) return;
      delete pondAudio.pendingEffects[name];
      if (pondAudio.unlocked) playPondEffectFallback(name);
    });
    return true;
  }
  return playPondEffectFallback(name);
}

function stopPondEffect(name, fadeSeconds = 0.08) {
  pondAudio.pendingEffects[name] = (pondAudio.pendingEffects[name] || 0) + 1;
  const sources = pondAudio.effectSources[name];
  if (sources?.size && pondAudio.context) {
    const now = pondAudio.context.currentTime;
    for (const entry of Array.from(sources)) {
      entry.gain.gain.cancelScheduledValues(now);
      entry.gain.gain.setValueAtTime(entry.gain.gain.value, now);
      entry.gain.gain.linearRampToValueAtTime(0, now + fadeSeconds);
      try {
        entry.source.stop(now + fadeSeconds);
      } catch (error) {
        // The source has already reached its natural end.
      }
    }
  }
  const sound = pondAudio.effects[name];
  if (!sound) return;
  if (pondAudio.effectStopTimers[name]) {
    clearTimeout(pondAudio.effectStopTimers[name]);
    delete pondAudio.effectStopTimers[name];
  }
  const effectNode = pondAudio.effectNodes[name];
  if (sound.paused) {
    sound.currentTime = 0;
    return;
  }

  const finish = () => {
    sound.pause();
    sound.currentTime = 0;
    delete pondAudio.effectStopTimers[name];
  };
  if (!effectNode || !pondAudio.context || fadeSeconds <= 0) {
    finish();
    return;
  }

  const now = pondAudio.context.currentTime;
  effectNode.gain.cancelScheduledValues(now);
  effectNode.gain.setValueAtTime(effectNode.gain.value, now);
  effectNode.gain.linearRampToValueAtTime(0, now + fadeSeconds);
  pondAudio.effectStopTimers[name] = setTimeout(
    finish,
    fadeSeconds * 1000 + 20
  );
}

function playDialogueVoice(name) {
  const dialogueNames = [
    "healthyDialogue", "unhealthyDialogue", "deadDialogue"
  ];
  if (dialogueNames.some(isPondEffectPlaying)) {
    return false;
  }
  return playPondEffect(name);
}

function sustainPondHoverEffect(name) {
  if (pondAudio.hoverReleaseTimers[name]) {
    clearTimeout(pondAudio.hoverReleaseTimers[name]);
  }
  if (!pondAudio.activeHoverEffects[name]) {
    const started = isPondEffectPlaying(name) || playPondEffect(name);
    if (started) pondAudio.activeHoverEffects[name] = true;
  }
  pondAudio.hoverReleaseTimers[name] = setTimeout(() => {
    delete pondAudio.hoverReleaseTimers[name];
    delete pondAudio.activeHoverEffects[name];
    stopPondEffect(name, POND_AUDIO_TIMING.hoverStopFadeSeconds);
  }, POND_AUDIO_TIMING.hoverReleaseMs);
}

function handlePondHoverAudio(target) {
  const next = !target
    ? "none"
    : target.object === "none" ? "water" : target.object;
  if (next === "tree") sustainPondHoverEffect("treeLeave");
  else if (next !== "none") sustainPondHoverEffect("waterHover");
  pondAudio.hoverTarget = next;
}

function stopPondWaterAudio(includeHover = false) {
  if (includeHover) {
    if (pondAudio.hoverReleaseTimers.waterHover) {
      clearTimeout(pondAudio.hoverReleaseTimers.waterHover);
      delete pondAudio.hoverReleaseTimers.waterHover;
    }
    delete pondAudio.activeHoverEffects.waterHover;
    stopPondEffect("waterHover", POND_AUDIO_TIMING.hoverStopFadeSeconds);
    if (pondAudio.hoverTarget === "water") pondAudio.hoverTarget = "none";
  }
}

function getPondAmbienceGains(health) {
  const transitionAmount = (breakpoint) => {
    const progress = Math.max(0, Math.min(1,
      (breakpoint + 10 - health) / 10
    ));
    return progress * progress * (3 - 2 * progress);
  };
  const toUnhealthy = transitionAmount(TREE_HEALTH_BANDS.healthyAbove);
  const toDead = transitionAmount(TREE_HEALTH_BANDS.deadBelow);
  return {
    healthy: 1 - toUnhealthy,
    unhealthy: toUnhealthy - toDead,
    dead: toDead
  };
}

function applyPondAmbienceGains(immediate = false) {
  const gains = getPondAmbienceGains(ecosystemHealth);
  const follow = immediate ? 1 : 1 - Math.exp(
    -Math.min(deltaTime / 1000, 0.1) * POND_AUDIO_TIMING.musicFollowRate
  );
  const usesTrackNodes = Boolean(pondAudio.context && pondAudio.buses.music);
  const musicScale = usesTrackNodes ? 1 : POND_AUDIO_MIX.music;
  for (const [name, sound] of Object.entries(pondAudio.ambience)) {
    const targetVolume = musicScale * gains[name];
    const trackGain = pondAudio.ambienceNodes[name];
    if (trackGain && pondAudio.context) {
      const currentVolume = trackGain.gain.value;
      const nextVolume = immediate
        ? targetVolume
        : currentVolume + (targetVolume - currentVolume) * follow;
      trackGain.gain.value = Math.abs(nextVolume - targetVolume) < 0.0001
        ? targetVolume
        : nextVolume;
      sound.volume = 1;
    } else {
      sound.volume += (targetVolume - sound.volume) * follow;
      if (immediate || Math.abs(sound.volume - targetVolume) < 0.0001) {
        sound.volume = targetVolume;
      }
    }
  }
}

function updatePondAudio() {
  if (!pondAudio.unlocked) return;
  // Retry regardless of AudioContext readiness — a track can still be
  // stalled/paused even if the context itself already reports "running",
  // and waiting on that state was letting a stalled dead-state track (for
  // example) go silent for the rest of the session after some reloads.
  if (Object.values(pondAudio.ambience).some((sound) => sound.paused)
    && millis() - pondAudio.lastAmbiencePlayAt
      >= POND_AUDIO_TIMING.ambienceRestartMs) {
    startPondAmbience();
  }
  applyPondAmbienceGains();
}
