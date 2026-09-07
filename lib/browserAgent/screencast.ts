/**
 * MergeMate Browser Agent — Live Screencast
 * Streams real browser frames to the frontend using the Chrome DevTools
 * Protocol's Page.startScreencast, not a screenshot polling loop. Acknowledges
 * every frame per the CDP contract, tolerates page navigation/detach, and never
 * assumes a fixed viewport size — each frame reports its own width/height.
 */

import { Page, CDPSession } from 'playwright';
import { pushActivityEvent } from './activityLog';

export interface ScreencastFrame {
  sessionId: string;
  data: string; // base64 JPEG
  width: number;
  height: number;
  timestamp: number;
}

export interface ScreencastHandle {
  cdpSession: CDPSession;
  stop: () => Promise<void>;
}

const MAX_WIDTH = 1280;
const MAX_HEIGHT = 800;

/**
 * Starts a CDP screencast on the given page and invokes onFrame for every
 * frame received, acknowledging each one so the browser keeps streaming.
 */
export async function startScreencast(
  page: Page,
  sessionId: string,
  onFrame: (frame: ScreencastFrame) => void
): Promise<ScreencastHandle> {
  const cdpSession = await page.context().newCDPSession(page);

  let stopped = false;

  const onScreencastFrame = (payload: any) => {
    if (stopped) return;

    const metadata = payload.metadata || {};
    const frame: ScreencastFrame = {
      sessionId,
      data: payload.data,
      width: Math.round(metadata.deviceWidth || metadata.cssViewportWidth || 0),
      height: Math.round(metadata.deviceHeight || metadata.cssViewportHeight || 0),
      timestamp: metadata.timestamp ? metadata.timestamp * 1000 : Date.now(),
    };

    onFrame(frame);

    // CDP requires every screencast frame to be acknowledged or the browser
    // will eventually stop sending new ones (dropped-frame / backpressure guard).
    cdpSession
      .send('Page.screencastFrameAck', { sessionId: payload.sessionId })
      .catch(() => {
        // Session may have already detached (page navigated/closed); safe to ignore.
      });
  };

  const onVisibilityChanged = () => {
    // No-op: MergeMate keeps the tab logically "visible" for streaming purposes.
  };

  cdpSession.on('Page.screencastFrame', onScreencastFrame);
  cdpSession.on('Page.screencastVisibilityChanged', onVisibilityChanged);

  await cdpSession.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 80,
    maxWidth: MAX_WIDTH,
    maxHeight: MAX_HEIGHT,
    everyNthFrame: 1,
  });

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try {
      await cdpSession.send('Page.stopScreencast');
    } catch {
      // Ignore — page/context may already be gone.
    }
    cdpSession.off('Page.screencastFrame', onScreencastFrame);
    cdpSession.off('Page.screencastVisibilityChanged', onVisibilityChanged);
    try {
      await cdpSession.detach();
    } catch {
      // Ignore — detach on an already-closed target throws harmlessly.
    }
  };

  page.once('close', () => {
    if (!stopped) {
      pushActivityEvent(sessionId, 'error', 'Page closed while streaming; stopping screencast.', { status: 'skipped' });
      stop();
    }
  });

  return { cdpSession, stop };
}
