'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Bot,
  User,
  Copy,
  Check,
  Search,
  GitPullRequest,
  Code,
  Sparkles,
  FolderTree,
  FileCode,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Clock,
} from 'lucide-react';
import { IssueCard } from './IssueCard';
import { PRLifecyclePanel } from './PRLifecyclePanel';
import { GitHubIssueItem, PRResult } from '@/lib/github';
import { AgentExecutionStep } from '@/lib/agentOrchestrator';
import { PRLifecycleRecord } from '@/lib/prLifecycleOrchestrator';

export interface ChatMessageData {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolExecutions?: {
    toolName: string;
    status: 'running' | 'completed' | 'error' | 'cancelled' | 'failed';
    data?: any;
  }[];
  agentExecutionSteps?: AgentExecutionStep[];
  prLifecycle?: PRLifecycleRecord;
}

interface ChatMessageProps {
  message: ChatMessageData;
  onSelectToFix: (issue: GitHubIssueItem) => void;
  onViewPRResult?: (result: PRResult) => void;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message, onSelectToFix, onViewPRResult }) => {
  const [copiedCode, setCopiedCode] = React.useState<string | null>(null);
  const isUser = message.role === 'user';

  const handleCopy = (codeText: string) => {
    navigator.clipboard.writeText(codeText);
    setCopiedCode(codeText);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div className={`py-4 px-4 sm:px-6 transition-colors ${isUser ? 'bg-transparent' : 'bg-slate-900/30 border-y border-slate-800/40'}`}>
      <div className="max-w-4xl mx-auto flex gap-4">
        {/* Avatar */}
        <div className="shrink-0">
          {isUser ? (
            <div className="w-8 h-8 rounded-lg bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-300">
              <User className="w-4 h-4" />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-cyan-500 p-[1px] shadow-md shadow-indigo-500/20">
              <div className="w-full h-full bg-slate-950 rounded-[7px] flex items-center justify-center text-cyan-400">
                <Bot className="w-4.5 h-4.5" />
              </div>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 space-y-3 min-w-0">
          {/* Header metadata */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-200">
              {isUser ? 'You' : 'MergeMate Autonomous Agent'}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              {message.timestamp}
            </span>
          </div>

          {/* Autonomous Agent Execution Step Timeline */}
          {message.agentExecutionSteps && message.agentExecutionSteps.length > 0 && (
            <div className="my-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                <span className="flex items-center gap-1.5 font-mono text-cyan-400">
                  <Sparkles className="w-3.5 h-3.5" /> Autonomous Execution Pipeline
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {message.agentExecutionSteps.filter(s => s.status === 'completed').length}/{message.agentExecutionSteps.length} Steps
                </span>
              </div>
              <div className="space-y-1.5 pt-1">
                {message.agentExecutionSteps.map((step, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-xs font-mono">
                    <span className="shrink-0 mt-0.5">
                      {step.status === 'completed' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : step.status === 'failed' ? (
                        <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-200">{step.title}</span>
                        <span className="text-[10px] text-slate-500">({step.timestamp})</span>
                      </div>
                      <p className="text-slate-400 text-[11px] truncate">{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tool Execution Badges */}
          {message.toolExecutions && message.toolExecutions.length > 0 && (
            <div className="space-y-2">
              {message.toolExecutions.map((tool, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-950/40 border border-indigo-500/30 text-xs text-indigo-300 font-mono"
                >
                  {tool.toolName === 'search_issues' && <Search className="w-3.5 h-3.5 text-cyan-400" />}
                  {tool.toolName === 'get_specific_issue' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                  {tool.toolName === 'get_repository_structure' && <FolderTree className="w-3.5 h-3.5 text-cyan-400" />}
                  {tool.toolName === 'get_file_content' && <FileCode className="w-3.5 h-3.5 text-indigo-400" />}
                  {tool.toolName === 'search_repository_code' && <Search className="w-3.5 h-3.5 text-amber-400" />}
                  {tool.toolName === 'execute_autonomous_task' && <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />}
                  {tool.toolName === 'get_issue_details' && <Code className="w-3.5 h-3.5 text-indigo-400" />}
                  {tool.toolName === 'create_pull_request' && <GitPullRequest className="w-3.5 h-3.5 text-emerald-400" />}
                  <span>
                    {tool.toolName === 'search_issues' && 'Discovered & verified open issues'}
                    {tool.toolName === 'get_specific_issue' && 'Verified specific GitHub issue state'}
                    {tool.toolName === 'get_repository_structure' && 'Explored repository tree and package dependencies'}
                    {tool.toolName === 'get_file_content' && 'Retrieved file contents from repository'}
                    {tool.toolName === 'search_repository_code' && 'Searched symbols in repository codebase'}
                    {tool.toolName === 'execute_autonomous_task' && 'Ran end-to-end autonomous engineering loop'}
                    {tool.toolName === 'get_issue_details' && 'Analyzed codebase file structure & issue details'}
                    {tool.toolName === 'create_pull_request' && 'Autonomously generated branch & created Pull Request'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Message Text Content */}
          <div className="prose prose-invert prose-sm max-w-none text-slate-200 leading-relaxed font-sans">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ node, inline, className, children, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || '');
                  const codeString = String(children).replace(/\n$/, '');

                  if (!inline) {
                    return (
                      <div className="relative my-3 rounded-xl overflow-hidden bg-slate-950 border border-slate-800 shadow-lg">
                        <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-[11px] text-slate-400 font-mono">
                          <span>{match ? match[1] : 'code'}</span>
                          <button
                            onClick={() => handleCopy(codeString)}
                            className="flex items-center gap-1 hover:text-white transition-colors"
                          >
                            {copiedCode === codeString ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                            <span>{copiedCode === codeString ? 'Copied' : 'Copy'}</span>
                          </button>
                        </div>
                        <pre className="p-3 text-xs font-mono overflow-x-auto text-slate-300">
                          <code>{children}</code>
                        </pre>
                      </div>
                    );
                  }

                  return (
                    <code className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-cyan-300 font-mono text-xs" {...props}>
                      {children}
                    </code>
                  );
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>

          {/* Embedded Issues List Cards */}
          {message.toolExecutions?.map((tool, idx) => {
            if (
              (tool.toolName === 'search_issues' || tool.toolName === 'get_specific_issue') &&
              Array.isArray(tool.data) &&
              tool.data.length > 0
            ) {
              return (
                <div key={idx} className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400 font-semibold uppercase tracking-wider">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> Verified Open Issues ({tool.data.length})
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {tool.data.map((issue: GitHubIssueItem) => (
                      <IssueCard key={issue.id} issue={issue} onSelectToFix={onSelectToFix} />
                    ))}
                  </div>
                </div>
              );
            }

            if (tool.toolName === 'create_pull_request' && tool.data && onViewPRResult) {
              const prRes = tool.data as PRResult;
              return (
                <div key={idx} className="mt-3 p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/30 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GitPullRequest className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-medium text-slate-200">
                      PR #{prRes.prNumber || 'Demo'}: {prRes.branchName}
                    </span>
                  </div>
                  <button
                    onClick={() => onViewPRResult(prRes)}
                    className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow transition-colors"
                  >
                    View PR Details & Diff
                  </button>
                </div>
              );
            }

            return null;
          })}

          {/* PR Lifecycle Live Panel */}
          {message.prLifecycle && (
            <PRLifecyclePanel lifecycle={message.prLifecycle} />
          )}
        </div>
      </div>
    </div>
  );
};
