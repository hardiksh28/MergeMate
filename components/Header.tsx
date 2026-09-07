'use client';

import React from 'react';
import { GitPullRequest, RefreshCw, Key, Github, Sparkles, ShieldCheck } from 'lucide-react';
import { KeyRotationStatus } from '@/lib/geminiRotator';

interface HeaderProps {
  rotatorStatus: KeyRotationStatus | null;
  onOpenSettings: () => void;
  onNewChat: () => void;
}

export const Header: React.FC<HeaderProps> = ({ rotatorStatus, onOpenSettings, onNewChat }) => {
  return (
    <header className="sticky top-0 z-30 w-full glass-panel border-b border-slate-800/80 px-4 py-3 flex items-center justify-between">
      {/* Brand Identity */}
      <div className="flex items-center gap-3">
        <div className="relative group cursor-pointer" onClick={onNewChat}>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 p-[1.5px] shadow-lg shadow-indigo-500/20">
            <div className="w-full h-full bg-slate-950 rounded-[10.5px] flex items-center justify-center">
              <GitPullRequest className="w-5 h-5 text-cyan-400 group-hover:scale-110 transition-transform duration-200" />
            </div>
          </div>
          <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-500 border-2 border-slate-950 rounded-full animate-pulse" />
        </div>

        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-lg text-white tracking-tight flex items-center gap-1.5">
              MergeMate <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">AI Agent</span>
            </h1>
          </div>
          <p className="text-xs text-slate-400 font-medium">
            Autonomous GitHub Issue Finder & PR Contributor
          </p>
        </div>
      </div>

      {/* Control Status Pills */}
      <div className="flex items-center gap-2.5">
        {/* Gemini Rotator Pill */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 text-xs">
          <div className="flex items-center gap-1.5 text-slate-300">
            <RefreshCw className="w-3.5 h-3.5 text-indigo-400 animate-spin-slow" />
            <span>Key Rotator:</span>
          </div>
          {rotatorStatus && rotatorStatus.totalKeys > 0 ? (
            <span className="flex items-center gap-1 font-mono text-cyan-400 font-medium bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-500/30">
              <Sparkles className="w-3 h-3 text-cyan-400" />
              {rotatorStatus.totalKeys} Keys Active ({rotatorStatus.activeKeyMasked})
            </span>
          ) : (
            <span className="text-amber-400 font-medium bg-amber-950/30 px-2 py-0.5 rounded border border-amber-500/20">
              Env Keys Active
            </span>
          )}
        </div>

        {/* Settings Drawer Button */}
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:text-indigo-200 transition-colors text-xs font-semibold"
          title="Configure GitHub Token & Gemini API Keys"
        >
          <Key className="w-3.5 h-3.5" />
          <span>API Keys</span>
        </button>

        {/* GitHub Repository Icon */}
        <a
          href="https://github.com"
          target="_blank"
          rel="noreferrer"
          className="p-2 rounded-lg bg-slate-900/90 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-colors"
          title="Open GitHub"
        >
          <Github className="w-4 h-4" />
        </a>
      </div>
    </header>
  );
};
