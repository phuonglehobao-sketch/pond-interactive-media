// Adaptive performance tiering. Loads first (before p5, tree.js and every
// other local script get a chance to run), so it has no dependency on p5 or
// any other global defined later — everything here is plain JS. Other files
// read the current tier via getPerfTier() or react to changes via
// onPerfTierChange() to trade visual quality for frame time on hardware that
// can't sustain the default settings, without ever affecting devices that can.

const PERF_TIERS = ["high", "medium", "low"];

const PERF_MONITOR = {
  sampleCount: 45,
  samples: new Float32Array(45),
  sampleIndex: 0,
  samplesFilled: 0,
  downgradeCooldownMs: 4000,
  lastDowngradeAt: -Infinity,
  // Average ms/frame sustained across the full sample window before the
  // current tier downgrades to the next one.
  thresholds: { high: 26, medium: 33 }
};

// Recovery is the mirror of PERF_MONITOR, but deliberately slower to react
// in both dimensions — a much longer sample window (180 vs. 45 frames) and a
// much longer cooldown between attempts (15s vs. 4s). Downgrading has to be
// quick, since a struggling frame is actively unpleasant right now; going
// back up doesn't carry that urgency, and getting it wrong is more
// disruptive than getting a downgrade wrong — an upgrade means a visible
// quality jump plus the same cache/canvas rebuild a downgrade triggers, so a
// few good seconds (a tab regaining focus, a momentary lull) shouldn't be
// enough to earn it.
//
// thresholds are keyed by the tier being upgraded INTO, and sit well below
// PERF_MONITOR.thresholds for that same tier (16 vs. high's 26, 22 vs.
// medium's 33) rather than just under it — that gap is what stops a fresh
// upgrade from immediately tripping the downgrade check again and flapping
// between the two every cooldown period.
const PERF_RECOVERY = {
  sampleCount: 180,
  samples: new Float32Array(180),
  sampleIndex: 0,
  samplesFilled: 0,
  upgradeCooldownMs: 15000,
  lastUpgradeAt: -Infinity,
  thresholds: { high: 16, medium: 22 }
};

const perfTierListeners = [];
// Starts at "high" — this file necessarily loads and runs before every other
// script, so nothing has had a chance to call onPerfTierChange() yet, and
// applying the real starting tier right here would fire into an empty
// listener array and silently never reach anyone. applyInitialPerfTier()
// (called from app.js's setup(), after every script's top-level code —
// including every registration — has already run) applies it for real. This
// placeholder value itself never matters beyond that: nothing reads or
// renders through it before applyInitialPerfTier() overwrites it.
let perfTier = "high";

function getPerfTier() {
  return perfTier;
}

function onPerfTierChange(callback) {
  if (typeof callback === "function") perfTierListeners.push(callback);
}

// Any tier change — up or down, including the very first hardware-based
// guess — invalidates both rolling windows below: their samples span
// whatever the tier was before the change, so averaging across the
// transition would be meaningless, and it resets each side's own cooldown
// clock so a change in one direction can't immediately be undone by the
// other before new, post-change samples have actually had a chance to
// accumulate.
function setPerfTier(nextTier) {
  if (nextTier === perfTier) return;
  const previousTier = perfTier;
  perfTier = nextTier;
  const now = performance.now();
  PERF_MONITOR.sampleIndex = 0;
  PERF_MONITOR.samplesFilled = 0;
  PERF_MONITOR.lastDowngradeAt = now;
  PERF_RECOVERY.sampleIndex = 0;
  PERF_RECOVERY.samplesFilled = 0;
  PERF_RECOVERY.lastUpgradeAt = now;
  for (const listener of perfTierListeners) listener(perfTier, previousTier);
}

// Always starts at "low" rather than guessing from hardware signals
// (navigator.hardwareConcurrency/deviceMemory used to drive this, and were
// weak proxies for actual canvas fill-rate/GPU performance anyway — plenty
// of multi-core machines still struggled with this scene's full-quality
// first render). A wrong optimistic guess meant paying for high-tier
// rendering for several real seconds before the downgrade monitor's sample
// window could even finish filling, let alone act — a rough first
// impression on exactly the hardware this system exists to protect.
// Starting at "low" costs nothing close to that symmetrically: PERF_RECOVERY
// (see updatePerformanceMonitor) climbs back to medium, then high, once
// frame time proves — over a long, deliberately cautious window, not a
// lucky first second — that the device can actually sustain it. A genuinely
// capable device still ends up at full quality; it just earns it live
// instead of being guessed into it upfront.
function applyInitialPerfTier() {
  setPerfTier("low");
}

function downgradePerfTier() {
  const index = PERF_TIERS.indexOf(perfTier);
  if (index >= PERF_TIERS.length - 1) return;
  setPerfTier(PERF_TIERS[index + 1]);
}

function upgradePerfTier() {
  const index = PERF_TIERS.indexOf(perfTier);
  if (index <= 0) return;
  setPerfTier(PERF_TIERS[index - 1]);
}

// Called once per frame from app.js's draw(), only once the experience is
// actually looping — reads p5's global `deltaTime`. Runs both the downgrade
// and recovery checks every frame (each gated by its own cooldown below);
// a downgrade this frame returns early so the same frame's sample isn't
// also fed into a recovery window that setPerfTier() just reset.
function updatePerformanceMonitor() {
  const now = performance.now();

  if (perfTier !== "low"
    && now - PERF_MONITOR.lastDowngradeAt >= PERF_MONITOR.downgradeCooldownMs) {
    PERF_MONITOR.samples[PERF_MONITOR.sampleIndex] = deltaTime;
    PERF_MONITOR.sampleIndex =
      (PERF_MONITOR.sampleIndex + 1) % PERF_MONITOR.sampleCount;
    PERF_MONITOR.samplesFilled = Math.min(
      PERF_MONITOR.samplesFilled + 1,
      PERF_MONITOR.sampleCount
    );
    if (PERF_MONITOR.samplesFilled >= PERF_MONITOR.sampleCount) {
      let total = 0;
      for (let i = 0; i < PERF_MONITOR.sampleCount; i++) total += PERF_MONITOR.samples[i];
      const average = total / PERF_MONITOR.sampleCount;
      if (average > PERF_MONITOR.thresholds[perfTier]) {
        downgradePerfTier();
        return;
      }
    }
  }

  if (perfTier !== "high"
    && now - PERF_RECOVERY.lastUpgradeAt >= PERF_RECOVERY.upgradeCooldownMs) {
    PERF_RECOVERY.samples[PERF_RECOVERY.sampleIndex] = deltaTime;
    PERF_RECOVERY.sampleIndex =
      (PERF_RECOVERY.sampleIndex + 1) % PERF_RECOVERY.sampleCount;
    PERF_RECOVERY.samplesFilled = Math.min(
      PERF_RECOVERY.samplesFilled + 1,
      PERF_RECOVERY.sampleCount
    );
    if (PERF_RECOVERY.samplesFilled >= PERF_RECOVERY.sampleCount) {
      let total = 0;
      for (let i = 0; i < PERF_RECOVERY.sampleCount; i++) total += PERF_RECOVERY.samples[i];
      const average = total / PERF_RECOVERY.sampleCount;
      const targetTier = PERF_TIERS[PERF_TIERS.indexOf(perfTier) - 1];
      if (average < PERF_RECOVERY.thresholds[targetTier]) upgradePerfTier();
    }
  }
}
