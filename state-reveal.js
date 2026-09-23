// Reveal two opaque artwork states using the SAME raster-mask technique as
// the pond's own reveal (see pond-rendering.js: createPondRevealThresholds
// / updatePondRevealMask / compositePondStateWithInk): a cached, per-pixel,
// domain-warped multi-origin distance field gives every pixel its own
// threshold, and comparing that against the live progress each frame (with
// a soft edge, then upscaled with smoothing) produces the same naturally
// irregular, softly blurred boundary the pond has — instead of a vector
// clip. Every transitioning object gets its own small offscreen mask and
// compositing buffer ("channel"), keyed by a stable id, so this scales to
// many simultaneously-transitioning parts without touching the pond's own
// buffers at all.

let STATE_REVEAL_MASK_SCALE = 0.4;
const STATE_REVEAL_MIN_MASK = 8;

// Adaptive-performance hook: a coarser mask is a cheaper per-pixel paint loop
// and a smaller putImageData call for every one of the ~24 possible active
// reveal channels (tree/moss/lily/grass/fish). Raised well above the earlier
// 0.4/0.3/0.24 — blur alone couldn't fix how blobby/rasterized complex
// silhouettes (fish fins, flower petals) looked at that resolution, since a
// coarse sampling grid just can't carry that much silhouette detail no
// matter how it's smoothed afterward. Only the lowest tier keeps a
// noticeably reduced scale, since that's the one device class this can't be
// afforded on at all.
onPerfTierChange((tier) => {
  STATE_REVEAL_MASK_SCALE = tier === "low" ? 0.28 : tier === "medium" ? 0.55 : 0.85;
});
// Incoming reveals through a soft edge — the visible watercolor blend.
const STATE_REVEAL_EDGE = 0.035;
// Outgoing is only erased where the transition has genuinely finished (a
// near-binary edge), so the older artwork's own silhouette can't peek out
// through gaps in the newer artwork's transparency, while everywhere else
// it stays fully in place and blends naturally underneath.
const STATE_REVEAL_CORE_EDGE = 0.006;

// Same fix as the pond's own reveal (see pond-rendering.js:
// POND_REVEAL_MASK_BLUR_PX): a small blur applied to the mask itself, before
// it gets scaled up to the object's on-screen size, softens the low-res
// mask's own raster pattern — cheap, since each object's mask buffer is
// already only STATE_REVEAL_MASK_SCALE of its own (usually small) bounds.
// Kept light — treeTransition sits at a fractional value for most of normal
// play (idle recovery alone keeps it moving), so this mask/blur path is
// active almost continuously, not just during a dramatic transition; too
// strong here reads as the whole object being permanently soft rather than
// just its transition edge. Skipped entirely on the lowest performance tier.
let STATE_REVEAL_MASK_BLUR_PX = 0.28;
onPerfTierChange((tier) => {
  STATE_REVEAL_MASK_BLUR_PX = tier === "low" ? 0 : 0.28;
});

function stateRevealHash(seed, i, j, channel) {
  const value = Math.sin(
    seed * 12.9898 + i * 78.233 + j * 37.719 + channel * 94.673
  ) * 43758.5453123;
  return value - Math.floor(value);
}

const stateRevealChannels = {};

// Same reasoning as POND_REVEAL_MASK_UPDATE_INTERVAL_MS (pond-rendering.js):
// each channel's own paintStateRevealMask call is a per-pixel JS loop, and
// up to ~24 of these (every tree/moss/lily part, active fish, grass patch)
// can be running simultaneously any time treeTransition sits away from 0 —
// recovering or merely hovering both do that for as long as they last. None
// of these individually huge (maskWidth/Height is scaled to the object's
// own bounds), but multiplied across every simultaneously-active channel,
// every frame, this compounds fast. A plain millis()-based interval, not a
// frame-count skip (or frame-count-plus-max-staleness hybrid) — both were
// tried and both still read as a visible flicker, since either lets a
// channel's mask sit frozen for a stretch of real time while its own
// artwork/transition keeps animating underneath it, then snaps to a
// now-different state all at once. This plain interval never lets that gap
// open in the first place; its own tradeoff is providing no relief once a
// single frame already takes longer than the interval (see the pond's own
// comment for the same tradeoff, spelled out in full).
const STATE_REVEAL_MASK_UPDATE_INTERVAL_MS = { high: 16, medium: 33, low: 60 };

function getStateRevealChannel(id) {
  let channel = stateRevealChannels[id];
  if (!channel) {
    channel = {
      seed: null,
      maskWidth: 0,
      maskHeight: 0,
      thresholds: null,
      mask: null,
      maskPixels: null,
      diffusion: null,
      diffusionWidth: 0,
      diffusionHeight: 0,
      maskBlurred: null,
      lastMaskUpdateAt: -Infinity
    };
    stateRevealChannels[id] = channel;
  }
  return channel;
}

// Builds a directional arrival field from deterministic crawling paths,
// rather than createPondRevealThresholds' nearest-origin distance field: a
// radial field (even domain-warped) can only ever make expanding islands.
// Each branch establishes a connected trunk first, then sends out uneven
// side tendrils; a pixel's threshold is the arrival time of the closest
// path (segment distance, not point distance), with a small width falloff,
// so the mask advances along channels instead of inflating separate fuzzy
// blobs. Origins/paths are derived from the object's own seed instead of
// the pond's fixed list, so each part/fish/patch gets its own stable,
// irregular growth pattern.
// branchCount/sideCount/steps were cut roughly 3-4x below their original
// values (which produced ~400+ path segments per channel — every one of the
// ~24 possible reveal channels loops over all of them for every mask pixel
// on its first build, which made the whole scene visibly laggy). The
// trunk-and-branch character is still intact at this count, just less
// intricate.
function createStateRevealThresholds(maskWidth, maskHeight, seed) {
  const thresholds = new Float32Array(maskWidth * maskHeight);
  const aspect = maskWidth / Math.max(maskHeight, 1);
  const paths = [];
  const branchCount = 2 + Math.floor(stateRevealHash(seed, 0, 0, 90) * 2);
  const clamp01 = (value) => Math.max(0, Math.min(1, value));

  const addPath = (startX, startY, angle, length, width, startTime, salt) => {
    const points = [];
    let x = startX;
    let y = startY;
    let heading = angle;
    const steps = 10 + Math.floor(length * 6);
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      points.push({
        x: clamp01(x),
        y: clamp01(y),
        t: startTime + t * length,
        width: width * (0.72 + 0.28 * Math.sin(t * Math.PI))
      });
      heading += (stateRevealHash(seed, salt, step, 101) - 0.5) * 0.22;
      x += Math.cos(heading) * (0.022 + width * 0.006);
      y += Math.sin(heading) * (0.022 + width * 0.006) / aspect;
    }
    paths.push(points);
  };

  for (let branch = 0; branch < branchCount; branch++) {
    const sourceX = 0.08 + stateRevealHash(seed, branch, 0, 91) * 0.84;
    const sourceY = 0.08 + stateRevealHash(seed, branch, 0, 92) * 0.84;
    const targetX = 0.5 + (stateRevealHash(seed, branch, 0, 94) - 0.5) * 0.25;
    const targetY = 0.5 + (stateRevealHash(seed, branch, 0, 95) - 0.5) * 0.25;
    const angle = Math.atan2(targetY - sourceY, targetX - sourceX)
      + (stateRevealHash(seed, branch, 0, 96) - 0.5) * 0.9;
    const trunkLength = 0.68 + stateRevealHash(seed, branch, 0, 97) * 0.28;
    const width = 0.018 + stateRevealHash(seed, branch, 0, 98) * 0.018;
    const startTime = stateRevealHash(seed, branch, 0, 93) * 0.18;
    addPath(sourceX, sourceY, angle, trunkLength, width, startTime, 110 + branch * 17);

    const sideCount = 1 + Math.floor(stateRevealHash(seed, branch, 0, 99) * 2);
    for (let side = 0; side < sideCount; side++) {
      const attach = 0.28 + stateRevealHash(seed, branch, side, 100) * 0.52;
      const attachX = sourceX + Math.cos(angle) * trunkLength * attach;
      const attachY = sourceY + Math.sin(angle) * trunkLength * attach / aspect;
      const sideAngle = angle
        + (stateRevealHash(seed, branch, side, 102) < 0.5 ? -1 : 1)
        * (0.55 + stateRevealHash(seed, branch, side, 103) * 0.7);
      addPath(
        attachX, attachY, sideAngle,
        0.34 + stateRevealHash(seed, branch, side, 104) * 0.34,
        width * (0.45 + stateRevealHash(seed, branch, side, 105) * 0.3),
        startTime + attach * 0.42,
        300 + branch * 23 + side * 7
      );
    }
  }

  for (let y = 0; y < maskHeight; y++) {
    const ny = y / Math.max(maskHeight - 1, 1);
    for (let x = 0; x < maskWidth; x++) {
      const nx = x / Math.max(maskWidth - 1, 1);
      let arrival = 1.4;
      for (const path of paths) {
        for (let point = 1; point < path.length; point++) {
          const a = path[point - 1];
          const b = path[point];
          const abX = (b.x - a.x) * aspect;
          const abY = b.y - a.y;
          const apX = (nx - a.x) * aspect;
          const apY = ny - a.y;
          const lengthSq = abX * abX + abY * abY || 1;
          const segmentT = Math.max(0, Math.min(1,
            (apX * abX + apY * abY) / lengthSq
          ));
          const closestX = a.x + (b.x - a.x) * segmentT;
          const closestY = a.y + (b.y - a.y) * segmentT;
          const distance = Math.hypot((nx - closestX) * aspect, ny - closestY);
          const widthAtPoint = a.width + (b.width - a.width) * segmentT;
          const pathArrival = a.t + (b.t - a.t) * segmentT
            + Math.max(0, distance - widthAtPoint) * 0.72;
          arrival = Math.min(arrival, pathArrival);
        }
      }
      const texture = Math.sin(nx * 37.7 + ny * 19.1 + seed) * 0.006
        + Math.sin(nx * 13.9 - ny * 31.7 + seed * 0.55) * 0.004;
      const index = y * maskWidth + x;
      thresholds[index] = Math.max(0.01, Math.min(0.99, arrival + texture));
    }
  }
  return thresholds;
}

// (Re)builds a channel's buffers whenever its object's on-screen size (or
// seed) changes, exactly like rebuildCaches() does for the pond's own
// buffers on resize — everything else reuses the same cached buffers.
function ensureStateRevealChannel(channel, bounds, seed) {
  const diffusionW = Math.max(1, Math.ceil(bounds.w));
  const diffusionH = Math.max(1, Math.ceil(bounds.h));
  if (!channel.diffusion
    || channel.diffusionWidth !== diffusionW
    || channel.diffusionHeight !== diffusionH) {
    if (channel.diffusion) channel.diffusion.remove();
    channel.diffusion = createBuffer(diffusionW, diffusionH);
    channel.diffusionWidth = diffusionW;
    channel.diffusionHeight = diffusionH;
  }

  const maskW = Math.max(
    STATE_REVEAL_MIN_MASK, Math.ceil(diffusionW * STATE_REVEAL_MASK_SCALE)
  );
  const maskH = Math.max(
    STATE_REVEAL_MIN_MASK, Math.ceil(diffusionH * STATE_REVEAL_MASK_SCALE)
  );
  if (!channel.mask
    || channel.maskWidth !== maskW
    || channel.maskHeight !== maskH
    || channel.seed !== seed) {
    if (channel.mask) channel.mask.remove();
    if (channel.maskBlurred) channel.maskBlurred.remove();
    channel.mask = createBuffer(maskW, maskH, 1);
    channel.maskBlurred = createBuffer(maskW, maskH, 1);
    channel.maskPixels = channel.mask.drawingContext.createImageData(
      maskW, maskH
    );
    channel.thresholds = createStateRevealThresholds(maskW, maskH, seed);
    channel.maskWidth = maskW;
    channel.maskHeight = maskH;
    channel.seed = seed;
    // Freshly (re)created buffers start blank — force the very next
    // drawStateReveal call to actually repaint instead of possibly skipping
    // it under STATE_REVEAL_MASK_UPDATE_INTERVAL_MS's throttle.
    channel.lastMaskUpdateAt = -Infinity;
  }
}

function paintStateRevealMask(channel, progress, edge) {
  const pixels = channel.maskPixels.data;
  const thresholds = channel.thresholds;
  // Eased, not raw — createStateRevealThresholds' path-based field has some
  // thresholds starting very close to 0 (a path can begin at startTime≈0),
  // so raw progress ticking up from 0 already exceeds several of them
  // immediately: a wedge-shaped chunk pops in at a visible size the instant
  // a transition starts, instead of genuinely growing from nothing. This
  // smoothstep suppresses small progress much further than it suppresses
  // progress near 1, so the reveal now visibly eases open and closed rather
  // than reading as an abrupt on/off toggle.
  const easedProgress = progress * progress * (3 - 2 * progress);
  for (let index = 0; index < thresholds.length; index++) {
    const reveal = Math.max(0, Math.min(
      1, (easedProgress - thresholds[index] + edge) / (edge * 2)
    )) * 255;
    pixels[index * 4 + 3] = reveal;
  }
  channel.mask.drawingContext.putImageData(channel.maskPixels, 0, 0);

  channel.maskBlurred.clear();
  const blurContext = channel.maskBlurred.drawingContext;
  blurContext.filter = STATE_REVEAL_MASK_BLUR_PX > 0
    ? `blur(${STATE_REVEAL_MASK_BLUR_PX}px)`
    : "none";
  blurContext.drawImage(channel.mask.canvas, 0, 0);
  blurContext.filter = "none";
}

// drawArtwork(g) draws into whichever target g is: the global p5 instance
// (window, when drawing straight to the main canvas needs no masking) or
// this channel's offscreen buffer (when it does). g exposes the exact same
// drawing API either way, so callers just need to call g.image(...) etc.
// instead of the bare global versions.
function drawStateReveal(
  channelId, progress, bounds, seed, incoming, drawArtwork, softOutgoingEdge = false
) {
  if (!drawArtwork) return;
  if (progress <= 0.001) {
    if (!incoming) drawArtwork(window);
    return;
  }
  if (progress >= 0.999) {
    if (incoming) drawArtwork(window);
    return;
  }

  // Tried a hard midpoint swap here on the lowest tier instead of the
  // masked composite below (skip the buffer entirely, just pop between the
  // two states) — cheaper, but it replaced the soft watercolor blend with a
  // visible pop/appear-disappear, which reads as broken rather than as a
  // legitimate quality tradeoff. Reverted: the blended mask transition
  // itself is not negotiable, on any tier, the same way the pond's own
  // reveal (pond-rendering.js: compositePondStateWithInk) never drops its
  // masked blend either. This file's cheapening for low is the same one the
  // pond uses — a coarser mask (STATE_REVEAL_MASK_SCALE, mirroring
  // INK_POLLUTION.resolution) and no extra blur pass
  // (STATE_REVEAL_MASK_BLUR_PX), both set by the onPerfTierChange handlers
  // above — not skipping the masked composite itself.
  const channel = getStateRevealChannel(channelId);
  ensureStateRevealChannel(channel, bounds, seed);

  // The buffer's own (0, 0) is bounds' top-left corner — drawArtwork still
  // uses the exact same local coordinates it would when drawing straight
  // to the main canvas (which already has bounds.x/y correctly positioned
  // via the caller's active transform), so this translate is the only
  // adjustment needed to make the two paths equivalent.
  channel.diffusion.clear();
  channel.diffusion.push();
  channel.diffusion.translate(-bounds.x, -bounds.y);
  drawArtwork(channel.diffusion);
  channel.diffusion.pop();

  // softOutgoingEdge is for an outgoing-only fade with no incoming layer to
  // protect against silhouette peek-through (e.g. a grass patch with no
  // wilted art of its own, just dissolving to nothing) — the narrow core
  // edge would otherwise stay fully visible then vanish in a binary pop
  // instead of actually fading.
  // Throttled per channel (see STATE_REVEAL_MASK_UPDATE_INTERVAL_MS) — the
  // mask only needs to be this fresh, not frame-fresh; channel.diffusion
  // above still gets the current-frame artwork every call regardless, only
  // the (expensive, per-pixel) mask repaint itself is capped.
  const now = millis();
  if (now - channel.lastMaskUpdateAt
    >= STATE_REVEAL_MASK_UPDATE_INTERVAL_MS[getPerfTier()]) {
    paintStateRevealMask(
      channel, progress,
      incoming || softOutgoingEdge ? STATE_REVEAL_EDGE : STATE_REVEAL_CORE_EDGE
    );
    channel.lastMaskUpdateAt = now;
  }

  const context = channel.diffusion.drawingContext;
  context.save();
  context.globalCompositeOperation = incoming
    ? "destination-in"
    : "destination-out";
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    channel.maskBlurred.canvas, 0, 0, channel.diffusionWidth, channel.diffusionHeight
  );
  context.restore();

  push();
  imageMode(CORNER);
  image(channel.diffusion, bounds.x, bounds.y, bounds.w, bounds.h);
  pop();
}
