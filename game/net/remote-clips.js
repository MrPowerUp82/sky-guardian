// Clip selection for remote heroes. No three.js here, so it is unit-tested in Node.

export const FALLBACK_CLIP = { superman: 'C003_Idle_01', flash: 'stand' };
const ONCE = /punch|attack|land|intro|leap|jumpup|jumpdown|stop|exit|start/i;

/** The clip to play: the one requested if the model has it, else the idle fallback, else any. */
export function resolveClipName(available, wanted, fallback) {
  if (wanted && available.has(wanted)) return wanted;
  if (available.has(fallback)) return fallback;
  return available.keys().next().value ?? '';
}

/** One-shot actions play once and hold their last frame; everything else loops. */
export const clipPlaysOnce = name => !!name && ONCE.test(name);
