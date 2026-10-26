export interface Pause {
  until: number;
  reason: string;
  relay?: string;
}

interface Lane {
  tail: Promise<unknown>;
  lastAt: number;
  pause?: Pause;
}

const lanes = new Map<string, Lane>();

function lane(id: string): Lane {
  let found = lanes.get(id);
  if (!found) {
    found = { tail: Promise.resolve(), lastAt: 0 };
    lanes.set(id, found);
  }
  return found;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Requests to one site run one at a time, with a random gap after the previous one.
export function enqueue<T>(id: string, [min, max]: [number, number], task: () => Promise<T>): Promise<T> {
  const current = lane(id);
  const run = current.tail.then(async () => {
    const wait = current.lastAt + min + Math.random() * (max - min) - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await task();
    } finally {
      current.lastAt = Date.now();
    }
  });
  current.tail = run.catch(() => undefined);
  return run;
}

export function getPause(id: string): Pause | null {
  const pause = lane(id).pause;
  return pause && pause.until > Date.now() ? pause : null;
}

export function setPause(id: string, pause: Pause): void {
  lane(id).pause = pause;
}

export function clearPause(id: string): void {
  lane(id).pause = undefined;
}

export function describePause(id: string, pause: Pause): string {
  const seconds = Math.ceil((pause.until - Date.now()) / 1000);
  const relay = pause.relay ? ` Give the user this link to solve it: ${pause.relay}` : '';
  return `${id} paused for ${seconds} s (${pause.reason}).${relay}`;
}
