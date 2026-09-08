'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play,
  Square,
  Wifi,
  WifiOff,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Clock,
  ShieldAlert,
  Monitor,
  Send,
  Globe,
  Sparkles,
  StopCircle,
} from 'lucide-react';
import { BrowserActionEvent, BrowserActionType } from '@/lib/browserAgent/types';

const WS_URL = process.env.NEXT_PUBLIC_BROWSER_WS_URL || 'ws://localhost:8787';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface PendingConfirmation {
  id: string;
  sessionId: string;
  reason: string;
  proposedAction: { action: string; target?: string; url?: string };
}

const ACTION_TYPES: BrowserActionType[] = ['click', 'type', 'select', 'scroll', 'wait', 'screenshot', 'inspect'];

function eventStatusIcon(event: BrowserActionEvent) {
  if (event.type === 'confirmation_required') return <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
  if (event.type === 'plan') return <Sparkles className="w-3.5 h-3.5 text-violet-400 shrink-0" />;
  if (event.status === 'completed') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
  if (event.status === 'failed') return <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />;
  if (event.status === 'in_progress') return <ArrowRight className="w-3.5 h-3.5 text-cyan-400 shrink-0" />;
  return <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />;
}

export const BrowserAgentPanel: React.FC = () => {
  const wsRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameImageRef = useRef<HTMLImageElement>(new Image());
  const timelineEndRef = useRef<HTMLDivElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [events, setEvents] = useState<BrowserActionEvent[]>([]);
  const [hasFrame, setHasFrame] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);

  const [urlInput, setUrlInput] = useState('https://example.com');
  const [actionType, setActionType] = useState<BrowserActionType>('click');
  const [targetInput, setTargetInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [directionInput, setDirectionInput] = useState<'up' | 'down' | 'left' | 'right'>('down');
  const [taskInput, setTaskInput] = useState('');
  const [isTaskRunning, setIsTaskRunning] = useState(false);
  const [activeTask, setActiveTask] = useState('');

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const drawFrame = useCallback((base64: string, width: number, height: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !width || !height) return;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = frameImageRef.current;
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height);
    };
    img.src = `data:image/jpeg;base64,${base64}`;
  }, []);

  // WebSocket lifecycle: connects to the standalone browser-agent server
  // (npm run browser:server) and reconnects with backoff on drop.
  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let attempt = 0;

    const connect = () => {
      if (cancelled) return;
      setConnectionStatus('connecting');

      let ws: WebSocket;
      try {
        ws = new WebSocket(WS_URL);
      } catch {
        setConnectionStatus('disconnected');
        reconnectTimer = setTimeout(connect, 5000);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setConnectionStatus('connected');
      };

      ws.onmessage = (evt) => {
        let msg: any;
        try {
          msg = JSON.parse(evt.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case 'session_created':
            // Update the ref synchronously so the activity_log/frame messages
            // that immediately follow aren't dropped while waiting for the
            // sessionId state update to commit and the syncing effect to run.
            sessionIdRef.current = msg.sessionId;
            setSessionId(msg.sessionId);
            setIsStarting(false);
            break;
          case 'activity_log':
            if (msg.sessionId === sessionIdRef.current) setEvents(msg.events || []);
            break;
          case 'activity_event':
            if (msg.sessionId === sessionIdRef.current) {
              setEvents((prev) => [...prev, msg.event]);
              const eventType = msg.event?.type;
              if (eventType === 'task_started') setIsTaskRunning(true);
              if (eventType === 'task_completed' || eventType === 'task_failed') {
                setIsTaskRunning(false);
                setActiveTask('');
              }
            }
            break;
          case 'frame':
            if (msg.sessionId === sessionIdRef.current && msg.width && msg.height) {
              setHasFrame(true);
              drawFrame(msg.data, msg.width, msg.height);
            }
            break;
          case 'confirmation_required':
            if (msg.sessionId === sessionIdRef.current && msg.request) {
              setPendingConfirmation(msg.request);
            }
            break;
          case 'confirmation_ack':
            setPendingConfirmation((prev) => (prev && prev.id === msg.requestId ? null : prev));
            break;
          case 'action_result':
            setIsStarting(false);
            break;
          case 'session_closed':
            if (msg.sessionId === sessionIdRef.current) {
              sessionIdRef.current = null;
              setSessionId(null);
              setHasFrame(false);
              setPendingConfirmation(null);
              setIsTaskRunning(false);
              setActiveTask('');
            }
            break;
          case 'error':
            console.warn('[BrowserAgentPanel] Server reported an error:', msg.message);
            setIsStarting(false);
            break;
          default:
            break;
        }
      };

      ws.onclose = () => {
        // A superseded socket's close event can fire after a newer one has
        // already taken over wsRef.current — only react if this is still it.
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        if (cancelled) return;
        setConnectionStatus('disconnected');
        attempt += 1;
        const delay = Math.min(1000 * 2 ** attempt, 10000);
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [drawFrame]);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  const sendMessage = (payload: any) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  const handleStartSession = () => {
    setIsStarting(true);
    setEvents([]);
    sendMessage({ type: 'create_session' });
  };

  const handleStopSession = () => {
    if (!sessionId) return;
    sendMessage({ type: 'stop_session', sessionId });
  };

  const handleNavigate = () => {
    if (!sessionId || !urlInput.trim()) return;
    const url = /^https?:\/\//i.test(urlInput.trim()) ? urlInput.trim() : `https://${urlInput.trim()}`;
    sendMessage({ type: 'command', sessionId, action: { action: 'navigate', url } });
  };

  const handleRunAction = () => {
    if (!sessionId) return;
    const action: Record<string, any> = { action: actionType };
    if (actionType === 'click' || actionType === 'type' || actionType === 'select') action.target = targetInput;
    if (actionType === 'type') action.text = textInput;
    if (actionType === 'select') action.value = textInput;
    if (actionType === 'scroll') action.direction = directionInput;
    if (actionType === 'wait') {
      if (targetInput) action.target = targetInput;
      action.timeoutMs = 5000;
    }
    sendMessage({ type: 'command', sessionId, action });
  };

  const handleRunTask = () => {
    if (!sessionId || !taskInput.trim() || isTaskRunning) return;
    setIsTaskRunning(true);
    setActiveTask(taskInput.trim());
    sendMessage({ type: 'run_task', sessionId, task: taskInput.trim() });
    // Clear right away so leftover text can't get spliced into the next task
    // if the user starts typing again before noticing this one is done.
    setTaskInput('');
  };

  const handleStopTask = () => {
    if (!sessionId) return;
    sendMessage({ type: 'stop_task', sessionId });
  };

  const handleConfirmationResponse = (approved: boolean) => {
    if (!pendingConfirmation || !sessionId) return;
    sendMessage({ type: 'resolve_confirmation', sessionId, requestId: pendingConfirmation.id, approved });
    setPendingConfirmation(null);
  };

  const needsTarget = actionType === 'click' || actionType === 'type' || actionType === 'select' || actionType === 'wait';
  const needsText = actionType === 'type' || actionType === 'select';

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Control Bar */}
      <div className="glass-panel border-b border-slate-800/80 px-4 py-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 pr-3 border-r border-slate-800">
          {connectionStatus === 'connected' ? (
            <span className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-400">
              <Wifi className="w-3.5 h-3.5" /> Agent Server
            </span>
          ) : connectionStatus === 'connecting' ? (
            <span className="flex items-center gap-1.5 text-[11px] font-mono text-amber-400">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Connecting
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[11px] font-mono text-rose-400">
              <WifiOff className="w-3.5 h-3.5" /> Server Offline
            </span>
          )}
        </div>

        {!sessionId ? (
          <button
            onClick={handleStartSession}
            disabled={connectionStatus !== 'connected' || isStarting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition-all"
          >
            {isStarting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            <span>Start Isolated Browser</span>
          </button>
        ) : (
          <>
            <span className="text-[11px] font-mono text-slate-400 bg-slate-900/80 border border-slate-800 px-2 py-1 rounded">
              {sessionId}
            </span>
            <button
              onClick={handleStopSession}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300 text-xs font-semibold transition-all"
            >
              <Square className="w-3.5 h-3.5" />
              <span>Stop Session</span>
            </button>

            <div className="flex items-center gap-1.5 flex-1 min-w-[220px]">
              <Globe className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleNavigate()}
                placeholder="https://example.com"
                className="flex-1 min-w-0 bg-slate-900/80 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60"
              />
              <button
                onClick={handleNavigate}
                disabled={isTaskRunning}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 text-xs font-medium transition-colors shrink-0"
              >
                Go
              </button>
            </div>
          </>
        )}
      </div>

      {/* AI Planning Loop: natural-language task bar */}
      {sessionId && (
        <div className="glass-panel border-b border-slate-800/60 px-4 py-2.5 flex flex-wrap items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-400 shrink-0" />
          <input
            value={isTaskRunning ? activeTask : taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRunTask()}
            disabled={isTaskRunning}
            placeholder='Describe a goal, e.g. "Fill in the form and submit it"'
            className="flex-1 min-w-[220px] bg-slate-900/80 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500/60 disabled:opacity-60"
          />
          {isTaskRunning ? (
            <button
              onClick={handleStopTask}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300 text-xs font-semibold transition-all shrink-0"
            >
              <StopCircle className="w-3.5 h-3.5 animate-pulse" />
              Stop Task
            </button>
          ) : (
            <button
              onClick={handleRunTask}
              disabled={!taskInput.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-500 hover:from-violet-500 hover:to-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-md shadow-violet-600/20 transition-all shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Run Task
            </button>
          )}
        </div>
      )}

      {/* Manual Structured Action Bar */}
      {sessionId && (
        <div className={`glass-panel border-b border-slate-800/60 px-4 py-2.5 flex flex-wrap items-center gap-2 text-xs ${isTaskRunning ? 'opacity-40 pointer-events-none' : ''}`}>
          <select
            value={actionType}
            onChange={(e) => setActionType(e.target.value as BrowserActionType)}
            disabled={isTaskRunning}
            className="bg-slate-900/80 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500/60"
          >
            {ACTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>

          {needsTarget && (
            <input
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
              placeholder={actionType === 'wait' ? 'text to wait for (optional)' : 'target (accessible name / text)'}
              className="bg-slate-900/80 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 w-52"
            />
          )}

          {needsText && (
            <input
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder={actionType === 'select' ? 'option value/label' : 'text to type'}
              className="bg-slate-900/80 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60 w-48"
            />
          )}

          {actionType === 'scroll' && (
            <select
              value={directionInput}
              onChange={(e) => setDirectionInput(e.target.value as any)}
              className="bg-slate-900/80 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500/60"
            >
              <option value="up">up</option>
              <option value="down">down</option>
              <option value="left">left</option>
              <option value="right">right</option>
            </select>
          )}

          <button
            onClick={handleRunAction}
            disabled={isTaskRunning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-3.5 h-3.5" />
            Run Action
          </button>
        </div>
      )}

      {/* Confirmation Gate Banner */}
      {pendingConfirmation && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between gap-3">
          <div className="flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-amber-400">Confirmation Required</p>
              <p className="opacity-90 leading-relaxed">{pendingConfirmation.reason}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleConfirmationResponse(true)}
              className="px-3 py-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-white text-xs font-semibold transition-colors"
            >
              Approve
            </button>
            <button
              onClick={() => handleConfirmationResponse(false)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
            >
              Deny
            </button>
          </div>
        </div>
      )}

      {/* Live View + Activity Timeline */}
      <div className="flex flex-1 overflow-hidden gap-0">
        {/* Live Browser Stream */}
        <div className="flex-1 flex items-center justify-center bg-slate-950/60 overflow-auto p-4">
          {sessionId ? (
            <div className="max-w-full max-h-full rounded-xl overflow-hidden border border-slate-800 shadow-2xl bg-black relative">
              <canvas ref={canvasRef} className="max-w-full max-h-[calc(100vh-220px)] block" />
              {!hasFrame && (
                <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-xs gap-2 bg-slate-950/80">
                  <RefreshCw className="w-4 h-4 animate-spin" /> Waiting for first frame...
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-slate-500 text-sm text-center max-w-sm">
              <Monitor className="w-10 h-10 text-slate-700" />
              <p>Start an isolated Chromium session to see a live browser stream here.</p>
              <p className="text-[11px] text-slate-600">
                Requires the browser-agent server running (<code className="text-cyan-500">npm run browser:server</code>).
              </p>
            </div>
          )}
        </div>

        {/* Activity Timeline */}
        <div className="w-80 shrink-0 glass-panel border-l border-slate-800/80 flex flex-col overflow-hidden hidden lg:flex">
          <div className="px-4 py-3 border-b border-slate-800/60 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Activity Timeline</span>
            <span className="text-[10px] text-slate-500 font-mono">{events.length} events</span>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {events.length === 0 && (
              <p className="text-[11px] text-slate-600 text-center mt-6">No activity yet.</p>
            )}
            {events.map((event) => (
              <div key={event.id} className="flex items-start gap-2 text-xs font-mono">
                <span className="mt-0.5">{eventStatusIcon(event)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-slate-300 leading-snug break-words">{event.message}</p>
                  <span className="text-[10px] text-slate-600">
                    {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
              </div>
            ))}
            <div ref={timelineEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
