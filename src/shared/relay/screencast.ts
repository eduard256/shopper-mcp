import type { Page } from 'patchright';

// Coordinates are fractions (0..1) of the shown image; deltas are in page pixels.
export type InputEvent =
  | { t: 'down' | 'move' | 'up'; x: number; y: number }
  | { t: 'wheel'; x: number; y: number; dx: number; dy: number }
  | { t: 'text'; text: string }
  | { t: 'key'; key: string };

export interface Screencast {
  input(events: InputEvent[]): Promise<void>;
  stop(): Promise<void>;
}

const keys: Record<string, { code: number; text?: string }> = {
  Enter: { code: 13, text: '\r' },
  Backspace: { code: 8 },
  Tab: { code: 9 },
  Escape: { code: 27 },
  Delete: { code: 46 },
  ArrowLeft: { code: 37 },
  ArrowUp: { code: 38 },
  ArrowRight: { code: 39 },
  ArrowDown: { code: 40 },
};

type MouseType = 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel';

export async function startScreencast(page: Page, onFrame: (frame: string) => void): Promise<Screencast> {
  const cdp = await page.context().newCDPSession(page);
  let size = { width: 1280, height: 800 };
  let pressed = false;

  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    size = { width: metadata.deviceWidth, height: metadata.deviceHeight };
    onFrame(JSON.stringify({ img: data, w: size.width, h: size.height }));
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
  });
  await page.bringToFront().catch(() => undefined);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 1280 });

  const mouse = (type: MouseType, x: number, y: number, extra: Record<string, unknown> = {}) =>
    cdp.send('Input.dispatchMouseEvent', { type, x, y, ...extra });

  async function dispatch(event: InputEvent): Promise<void> {
    if (event.t === 'text') {
      await cdp.send('Input.insertText', { text: event.text });
      return;
    }
    if (event.t === 'key') {
      const key = keys[event.key];
      if (!key) return;
      const base = { key: event.key, code: event.key, windowsVirtualKeyCode: key.code };
      await cdp.send('Input.dispatchKeyEvent', { type: key.text ? 'keyDown' : 'rawKeyDown', text: key.text, ...base });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      return;
    }
    const x = event.x * size.width;
    const y = event.y * size.height;
    if (event.t === 'wheel') {
      await mouse('mouseWheel', x, y, { deltaX: event.dx, deltaY: event.dy });
    } else if (event.t === 'down') {
      pressed = true;
      await mouse('mousePressed', x, y, { button: 'left', buttons: 1, clickCount: 1 });
    } else if (event.t === 'up') {
      pressed = false;
      await mouse('mouseReleased', x, y, { button: 'left', buttons: 0, clickCount: 1 });
    } else {
      await mouse('mouseMoved', x, y, pressed ? { button: 'left', buttons: 1 } : {});
    }
  }

  return {
    async input(events) {
      for (const event of events) await dispatch(event);
    },
    async stop() {
      await cdp.send('Page.stopScreencast').catch(() => undefined);
      await cdp.detach().catch(() => undefined);
    },
  };
}
