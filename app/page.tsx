'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Header, AgentMode } from '@/components/Header';
import { Sidebar } from '@/components/Sidebar';
import { ChatMessage, ChatMessageData } from '@/components/ChatMessage';
import { PRPreviewModal } from '@/components/PRPreviewModal';
import { SettingsModal } from '@/components/SettingsModal';
import { BrowserAgentPanel } from '@/components/BrowserAgentPanel';
import { GitHubIssueItem, PRResult } from '@/lib/github';
import { KeyRotationStatus } from '@/lib/geminiRotator';
import { Send, Sparkles, RefreshCw, GitPullRequest, Code2, Bot, Terminal } from 'lucide-react';

const WELCOME_MESSAGE_CONTENT =
  '👋 **Hello! I am MergeMate**, your Autonomous GitHub Coding Agent.\n\nI can:\n1. **Target Specific Issues:** Paste any GitHub URL (e.g. `https://github.com/owner/repo/issues/123`) or shorthand `owner/repo#123` to immediately analyze, patch, verify, and submit a PR.\n2. **Explore & Discover:** Search open issues across React, TypeScript, Node.js, MongoDB, or specific organizations.\n3. **Autonomous Engineering Loop:** Explore the repository, formulate an engineering plan, run a bounded test/repair loop, and open verified cross-repository Pull Requests.';

// No real timestamp here — it's a static, non-time-based placeholder so the
// server-rendered HTML and the client's first render match exactly. The
// actual current time is filled in client-side after mount (see useEffect
// below) and freshly on each "new chat", never computed at module load.
function createWelcomeMessage(timestamp: string = ''): ChatMessageData {
  return {
    id: 'welcome',
    role: 'assistant',
    content: WELCOME_MESSAGE_CONTENT,
    timestamp,
  };
}

const WELCOME_MESSAGE: ChatMessageData = createWelcomeMessage();

export default function Home() {
  const [messages, setMessages] = useState<ChatMessageData[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [selectedTech, setSelectedTech] = useState<string[]>(['React', 'TypeScript', 'Node.js', 'MongoDB']);
  const [agentMode, setAgentMode] = useState<AgentMode>('coding');
  
  // Credentials & Settings state
  const [githubToken, setGithubToken] = useState<string>('');
  const [geminiKeys, setGeminiKeys] = useState<string[]>([]);
  const [rotatorStatus, setRotatorStatus] = useState<KeyRotationStatus | null>(null);
  
  // Modals state
  const [prModalResult, setPrModalResult] = useState<PRResult | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch initial rotator status
  useEffect(() => {
    fetch('/api/chat')
      .then((res) => res.json())
      .then((data) => {
        if (data.rotator) {
          setRotatorStatus(data.rotator);
        }
      })
      .catch(() => {});
  }, []);

  // Fill in the welcome message's real timestamp after mount — computing it
  // at module load would run once on the server and again on the client,
  // producing different wall-clock times and a hydration mismatch.
  useEffect(() => {
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setMessages((prev) =>
      prev.map((m) => (m.id === 'welcome' ? { ...m, timestamp: now } : m))
    );
  }, []);

  // Auto-scroll to bottom of chat
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, loadingStep]);

  // Handle tech stack toggle
  const handleToggleTech = (tech: string) => {
    setSelectedTech((prev) =>
      prev.includes(tech) ? prev.filter((t) => t !== tech) : [...prev, tech]
    );
  };

  // Handle starting a new chat session
  const handleNewChat = () => {
    setMessages([createWelcomeMessage(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))]);
    setInput('');
  };

  // Send message handler
  const sendMessage = async (textToSend?: string) => {
    const messageContent = (textToSend || input).trim();
    if (!messageContent || isLoading) return;

    const userMessage: ChatMessageData = {
      id: Date.now().toString(),
      role: 'user',
      content: messageContent,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setLoadingStep('Understanding task & exploring repository...');

    // Seed a live assistant message now — its step timeline fills in as
    // MergeMate actually does the work, instead of appearing all at once
    // after the whole pipeline finishes.
    const assistantId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        agentExecutionSteps: [],
      },
    ]);

    try {
      const apiMessages = [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          userToken: githubToken,
          userKeys: geminiKeys,
        }),
      });

      if (!res.body) throw new Error('No response stream from server.');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalEvent: any = null;
      let errorEvent: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: any;
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }

          if (evt.type === 'step') {
            setLoadingStep(evt.step?.title || loadingStep);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, agentExecutionSteps: [...(m.agentExecutionSteps || []), evt.step] }
                  : m
              )
            );
          } else if (evt.type === 'final') {
            finalEvent = evt;
          } else if (evt.type === 'error') {
            errorEvent = evt.error;
          }
        }
      }

      if (errorEvent) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `⚠️ **Engine Error**: ${errorEvent}. Please verify your Gemini API key in settings.` }
              : m
          )
        );
      } else if (finalEvent) {
        if (finalEvent.rotationStatus) {
          setRotatorStatus(finalEvent.rotationStatus);
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: finalEvent.text || 'I have completed the requested GitHub task.',
                  toolExecutions: finalEvent.toolExecutions,
                  agentExecutionSteps: finalEvent.agentExecutionSteps || m.agentExecutionSteps,
                }
              : m
          )
        );

        // If a branch/patch was staged for PR, pop the manual-submit modal
        const prTool = finalEvent.toolExecutions?.find((t: any) => t.toolName === 'create_pull_request');
        if (prTool && prTool.data && prTool.data.success) {
          setPrModalResult(prTool.data);
        }
      }
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: `⚠️ Failed to connect to MergeMate API: ${err?.message || 'Network Error'}` }
            : m
        )
      );
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  // Trigger automated fix when user clicks "Fix Code & Create PR" on an issue card
  const handleSelectToFix = (issue: GitHubIssueItem) => {
    const promptText = `Fix ${issue.repo_full_name}#${issue.number} ("${issue.title}"). Explore the repository, formulate an engineering plan, write the verified code fix, run tests, and create a Pull Request.`;
    sendMessage(promptText);
  };

  // Keyboard shortcut: Shift+Enter or Enter to send
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#080c14] bg-mesh overflow-hidden">
      {/* Top Header */}
      <Header
        rotatorStatus={rotatorStatus}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onNewChat={handleNewChat}
        activeMode={agentMode}
        onChangeMode={setAgentMode}
      />

      {agentMode === 'browser' ? (
        <BrowserAgentPanel />
      ) : (
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left Sidebar */}
        <Sidebar
          onNewChat={handleNewChat}
          onSelectPrompt={(p) => sendMessage(p)}
          selectedTech={selectedTech}
          onToggleTech={handleToggleTech}
        />

        {/* Main Chat Thread Area */}
        <main className="flex-1 flex flex-col justify-between overflow-hidden relative">
          {/* Scrollable Message Thread */}
          <div className="flex-1 overflow-y-auto pb-6">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                onSelectToFix={handleSelectToFix}
                onViewPRResult={(res) => setPrModalResult(res)}
              />
            ))}

            {/* Live Loading Indicator */}
            {isLoading && (
              <div className="py-4 px-6 bg-slate-900/30 border-y border-slate-800/40 animate-pulse">
                <div className="max-w-4xl mx-auto flex gap-4 items-center">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-cyan-400">
                    <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-cyan-300">
                      {loadingStep || 'MergeMate Autonomous Agent is executing...'}
                    </span>
                    <span className="flex gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" />
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:0.2s]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:0.4s]" />
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Sticky Bottom Input Bar */}
          <div className="p-4 glass-panel border-t border-slate-800/80 bg-slate-950/80">
            <div className="max-w-4xl mx-auto space-y-2">
              {/* Quick Tech Tag Badges */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs text-slate-400">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 shrink-0">
                  Target Stack:
                </span>
                {selectedTech.map((tech) => (
                  <span
                    key={tech}
                    className="px-2 py-0.5 rounded-md bg-indigo-950/40 border border-indigo-500/30 text-indigo-300 font-mono text-[11px] shrink-0"
                  >
                    {tech}
                  </span>
                ))}
              </div>

              {/* Text Input Box */}
              <div className="relative flex items-end glass-input rounded-2xl p-2 transition-all">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Give MergeMate an instruction or paste a GitHub URL (e.g. 'Fix https://github.com/facebook/react/issues/8931' or 'Find React bugs')..."
                  rows={2}
                  className="w-full bg-transparent px-3 py-1.5 text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none resize-none leading-relaxed"
                />

                <button
                  onClick={() => sendMessage()}
                  disabled={!input.trim() || isLoading}
                  className="p-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-lg shadow-indigo-600/20 transition-all shrink-0 ml-2"
                  title="Send message"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>

              {/* Disclaimer */}
              <p className="text-[11px] text-center text-slate-500">
                MergeMate Autonomous Coding Agent uses Google Gemini for codebase reasoning and Octokit for GitHub Pull Requests.
              </p>
            </div>
          </div>
        </main>
      </div>
      )}

      {/* PR Result Modal */}
      <PRPreviewModal
        prResult={prModalResult}
        onClose={() => setPrModalResult(null)}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        rotatorStatus={rotatorStatus}
        githubToken={githubToken}
        onSaveGithubToken={setGithubToken}
        geminiKeys={geminiKeys}
        onSaveGeminiKeys={setGeminiKeys}
      />
    </div>
  );
}
