export interface RotationInput {
  playing: boolean;
  visible: boolean;
  blocked: boolean;
  locked: boolean;
  sessionId: number | null;
  scene: object;
}

interface Dependencies {
  now(): number;
  rotate(canCommit: () => boolean): Promise<boolean>;
  minimumDwellMs?: number;
  maximumDwellMs?: number;
  interactionIdleMs?: number;
}

/** Counts only visible playback; clocks and playback facts enter through one testable boundary. */
export function createSceneRotation(deps: Dependencies) {
  const minimum = deps.minimumDwellMs ?? 60_000;
  const maximum = deps.maximumDwellMs ?? 300_000;
  const idle = deps.interactionIdleMs ?? 3000;
  let input: RotationInput | null = null;
  let previousTime = deps.now(), interactedAt = -Infinity, dwell = 0;
  let lastSession: number | null = null;
  let pending = false, inFlight = false, disposed = false;
  let generation = 0;

  function advance() {
    const time = deps.now();
    if (input?.playing && input.visible && !input.locked) dwell += Math.max(0, time - previousTime);
    previousTime = time;
  }
  function tick() {
    if (disposed) return;
    advance();
    if (!input || !input.visible || !input.playing || input.locked || input.blocked || inFlight) return;
    if (dwell >= maximum) pending = true;
    if (!pending || dwell < minimum || deps.now() - interactedAt < idle) return;
    pending = false;
    inFlight = true;
    const attempt = generation;
    const canCommit = () => !disposed && attempt === generation && input !== null && input.playing
      && input.visible && !input.locked && !input.blocked && deps.now() - interactedAt >= idle;
    void deps.rotate(canCommit).then(applied => {
      if (attempt !== generation || disposed) return;
      if (applied) dwell = 0;
      else if (!canCommit()) pending = true;
      else dwell = 0; // Back off after a failed image load instead of retrying every second.
    }).catch(() => { if (attempt === generation) dwell = 0; }).finally(() => { inFlight = false; });
  }
  return {
    update(next: RotationInput) {
      if (disposed) return;
      advance();
      if (!input || input.scene !== next.scene || input.locked !== next.locked) { dwell = 0; pending = false; generation++; }
      if (input?.visible !== next.visible) { pending = false; generation++; }
      if (next.sessionId !== null && next.sessionId !== lastSession) {
        if (input && next.playing && next.visible && !next.locked && dwell >= minimum) pending = true;
        lastSession = next.sessionId;
      }
      input = next;
      tick();
    },
    interact() { interactedAt = deps.now(); },
    tick,
    dispose() { disposed = true; input = null; pending = false; },
  };
}

/** A shuffled bag covers the collection once before repeating; membership changes rebuild it. */
export function createSceneBag(random = Math.random) {
  let signature = '', bag: string[] = [];
  return {
    next(ids: string[], currentId: string): string | null {
      const unique = [...new Set(ids)];
      const key = [...unique].sort().join('|');
      if (signature !== key) { signature = key; bag = []; }
      if (unique.length < 2 && unique[0] === currentId) return null;
      if (!unique.length) return null;
      if (!bag.length) {
        bag = [...unique];
        for (let index = bag.length - 1; index > 0; index--) {
          const selected = Math.floor(random() * (index + 1));
          [bag[index], bag[selected]] = [bag[selected], bag[index]];
        }
      }
      if (bag[bag.length - 1] === currentId) {
        const different = bag.findIndex(id => id !== currentId);
        if (different >= 0) [bag[different], bag[bag.length - 1]] = [bag[bag.length - 1], bag[different]];
        else { bag = []; return this.next(unique, currentId); }
      }
      return bag.pop() ?? null;
    },
  };
}
