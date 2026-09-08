/**
 * MergeMate Browser Agent — WebSocket Server
 * A standalone, persistent Node process (independent of Next.js's serverless
 * request/response lifecycle) that owns live browser sessions and relays CDP
 * screencast frames + activity timeline events to the frontend BrowserAgentPanel.
 *
 * Run locally with: npm run browser:server
 */

import { WebSocketServer, WebSocket } from 'ws';
import { browserController } from '../lib/browserAgent/browserController';
import { BrowserActionEvent } from '../lib/browserAgent/types';
import { ScreencastFrame } from '../lib/browserAgent/screencast';
import { runBrowserAgentTask } from '../lib/browserAgent/planningLoop';

const PORT = Number(process.env.BROWSER_WS_PORT) || 8787;

type ClientMessage =
  | { type: 'create_session'; sessionId?: string; headless?: boolean }
  | { type: 'subscribe'; sessionId: string }
  | { type: 'command'; sessionId: string; action: any }
  | { type: 'resolve_confirmation'; sessionId: string; requestId: string; approved: boolean }
  | { type: 'stop_session'; sessionId: string }
  | { type: 'run_task'; sessionId: string; task: string; maxSteps?: number }
  | { type: 'stop_task'; sessionId: string };

interface ClientState {
  ws: WebSocket;
  subscribedSessionIds: Set<string>;
}

const clients = new Set<ClientState>();

// sessionId -> unsubscribe functions for activity/frame relays, so we start each
// relay exactly once per session regardless of how many clients subscribe to it.
const sessionRelaysStarted = new Set<string>();

// sessionId -> cancellation flag for the one autonomous task (if any) running
// against that session. Only one task at a time per session — the planning
// loop and any manual action commands would otherwise fight over the same page.
const runningTasks = new Map<string, { cancelled: boolean }>();

function send(ws: WebSocket, payload: any): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastToSubscribers(sessionId: string, payload: any): void {
  clients.forEach((client) => {
    if (client.subscribedSessionIds.has(sessionId)) {
      send(client.ws, payload);
    }
  });
}

function ensureSessionRelays(sessionId: string): void {
  if (sessionRelaysStarted.has(sessionId)) return;
  sessionRelaysStarted.add(sessionId);

  browserController.onActivity(sessionId, (event: BrowserActionEvent) => {
    broadcastToSubscribers(sessionId, { type: 'activity_event', sessionId, event });

    if (event.type === 'confirmation_required') {
      broadcastToSubscribers(sessionId, {
        type: 'confirmation_required',
        sessionId,
        request: event.details?.requestId
          ? { id: event.details.requestId, sessionId, reason: event.message, proposedAction: event.details.proposedAction }
          : null,
      });
    }
  });

  browserController
    .startStream(sessionId, (frame: ScreencastFrame) => {
      broadcastToSubscribers(sessionId, {
        type: 'frame',
        sessionId,
        data: frame.data,
        width: frame.width,
        height: frame.height,
        timestamp: frame.timestamp,
      });
    })
    .catch((err: any) => {
      console.warn(`[BrowserWSServer] Failed to start screencast for ${sessionId}: ${err?.message}`);
    });
}

async function handleMessage(client: ClientState, raw: string): Promise<void> {
  let message: ClientMessage;
  try {
    message = JSON.parse(raw);
  } catch {
    send(client.ws, { type: 'error', message: 'Malformed JSON message.' });
    return;
  }

  try {
    switch (message.type) {
      case 'create_session': {
        const { sessionId, status } = await browserController.startSession({
          sessionId: message.sessionId,
          headless: message.headless,
        });
        client.subscribedSessionIds.add(sessionId);
        ensureSessionRelays(sessionId);
        send(client.ws, { type: 'session_created', sessionId, status });
        send(client.ws, { type: 'activity_log', sessionId, events: browserController.getActivity(sessionId) });
        break;
      }

      case 'subscribe': {
        client.subscribedSessionIds.add(message.sessionId);
        ensureSessionRelays(message.sessionId);
        send(client.ws, { type: 'activity_log', sessionId: message.sessionId, events: browserController.getActivity(message.sessionId) });
        break;
      }

      case 'command': {
        const result = await browserController.runAction(message.sessionId, message.action);
        send(client.ws, { type: 'action_result', sessionId: message.sessionId, result });
        break;
      }

      case 'resolve_confirmation': {
        const resolved = browserController.resolveConfirmation(message.requestId, message.approved);
        send(client.ws, { type: 'confirmation_ack', sessionId: message.sessionId, requestId: message.requestId, resolved });
        break;
      }

      case 'stop_session': {
        const runningTask = runningTasks.get(message.sessionId);
        if (runningTask) runningTask.cancelled = true;
        await browserController.stopSession(message.sessionId);
        sessionRelaysStarted.delete(message.sessionId);
        broadcastToSubscribers(message.sessionId, { type: 'session_closed', sessionId: message.sessionId });
        break;
      }

      case 'run_task': {
        if (runningTasks.has(message.sessionId)) {
          send(client.ws, {
            type: 'error',
            sessionId: message.sessionId,
            message: 'A task is already running on this session. Stop it before starting another.',
          });
          break;
        }

        const taskState = { cancelled: false };
        runningTasks.set(message.sessionId, taskState);

        // Fire-and-forget: progress is observed entirely through the existing
        // activity_event/frame relay (task_started/plan/task_completed/
        // task_failed events), exactly like any other action on this session.
        runBrowserAgentTask(message.sessionId, message.task, {
          maxSteps: message.maxSteps,
          isCancelled: () => taskState.cancelled,
        })
          .catch((err: any) => {
            console.error(`[BrowserWSServer] Task crashed for session ${message.sessionId}:`, err?.message || err);
            broadcastToSubscribers(message.sessionId, {
              type: 'error',
              sessionId: message.sessionId,
              message: `Task crashed: ${err?.message || err}`,
            });
          })
          .finally(() => {
            runningTasks.delete(message.sessionId);
          });

        send(client.ws, { type: 'task_started_ack', sessionId: message.sessionId });
        break;
      }

      case 'stop_task': {
        const taskState = runningTasks.get(message.sessionId);
        if (taskState) taskState.cancelled = true;
        send(client.ws, { type: 'stop_task_ack', sessionId: message.sessionId, wasRunning: Boolean(taskState) });
        break;
      }

      default:
        send(client.ws, { type: 'error', message: `Unknown message type: ${(message as any).type}` });
    }
  } catch (err: any) {
    console.error('[BrowserWSServer] Error handling message:', err?.message || err);
    send(client.ws, {
      type: 'error',
      sessionId: (message as any).sessionId,
      message: err?.message || 'Internal browser agent error.',
    });
  }
}

function startServer(): void {
  const wss = new WebSocketServer({ port: PORT });

  wss.on('connection', (ws: WebSocket) => {
    const client: ClientState = { ws, subscribedSessionIds: new Set() };
    clients.add(client);
    console.log(`[BrowserWSServer] Client connected. Active clients: ${clients.size}`);

    ws.on('message', (data) => {
      handleMessage(client, data.toString());
    });

    ws.on('close', () => {
      clients.delete(client);
      console.log(`[BrowserWSServer] Client disconnected. Active clients: ${clients.size}`);
    });

    ws.on('error', (err) => {
      console.warn('[BrowserWSServer] Client socket error:', err?.message);
    });
  });

  wss.on('listening', () => {
    console.log(`[BrowserWSServer] MergeMate Browser Agent WebSocket server listening on ws://localhost:${PORT}`);
  });

  // Stop accepting new WebSocket connections on shutdown. The actual browser
  // session cleanup + process.exit is owned by browserSession's shutdown hook
  // (registered when browserController was constructed above) so cleanup always
  // finishes before the process terminates rather than racing two exit calls.
  const stopAcceptingConnections = () => {
    console.log('[BrowserWSServer] Shutting down, closing all browser sessions...');
    wss.close();
  };

  process.on('SIGINT', stopAcceptingConnections);
  process.on('SIGTERM', stopAcceptingConnections);
}

startServer();
