'use client';

import React from 'react';
import { PlusCircle, Code2, Sparkles, Building2, Flame, Layers, Terminal, Link2, Bug } from 'lucide-react';

interface SidebarProps {
  onNewChat: () => void;
  onSelectPrompt: (promptText: string) => void;
  selectedTech: string[];
  onToggleTech: (tech: string) => void;
}

const PRESET_PROMPTS = [
  {
    icon: Link2,
    title: 'Fix Specific Issue URL',
    query: 'Fix https://github.com/vercel/next.js/issues/4892 and create a PR.',
  },
  {
    icon: Bug,
    title: 'Solvable TypeScript Bugs',
    query: 'Find a solvable TypeScript bug in a popular open-source repository and implement the fix.',
  },
  {
    icon: Building2,
    title: 'Top Orgs (Vercel / Meta)',
    query: 'Find verified open React and TypeScript issues in Vercel or Facebook repositories.',
  },
  {
    icon: Layers,
    title: 'Full Stack Node & Mongo',
    query: 'Find Node.js and MongoDB backend issues labeled help wanted and solve them.',
  },
  {
    icon: Flame,
    title: 'Beginner-Friendly Issues',
    query: 'Find beginner-friendly good first issues with React and TypeScript.',
  },
];

const TECH_STACKS = [
  { name: 'React', color: 'text-cyan-400 bg-cyan-950/40 border-cyan-500/30' },
  { name: 'TypeScript', color: 'text-blue-400 bg-blue-950/40 border-blue-500/30' },
  { name: 'Node.js', color: 'text-emerald-400 bg-emerald-950/40 border-emerald-500/30' },
  { name: 'MongoDB', color: 'text-green-400 bg-green-950/40 border-green-500/30' },
];

export const Sidebar: React.FC<SidebarProps> = ({
  onNewChat,
  onSelectPrompt,
  selectedTech,
  onToggleTech,
}) => {
  return (
    <aside className="w-72 shrink-0 glass-panel border-r border-slate-800/80 flex flex-col justify-between hidden md:flex h-[calc(100vh-61px)] p-4 overflow-y-auto">
      <div className="space-y-6">
        {/* New Chat Button */}
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-medium shadow-md shadow-indigo-600/20 transition-all group"
        >
          <PlusCircle className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" />
          <span>Start New Session</span>
        </button>

        {/* Tech Stack Filters */}
        <div>
          <div className="flex items-center gap-1.5 mb-2.5 px-1 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            <Terminal className="w-3.5 h-3.5 text-indigo-400" />
            <span>Target Tech Stacks</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {TECH_STACKS.map((tech) => {
              const isSelected = selectedTech.includes(tech.name);
              return (
                <button
                  key={tech.name}
                  onClick={() => onToggleTech(tech.name)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all text-left flex items-center justify-between ${
                    isSelected
                      ? tech.color
                      : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <span>{tech.name}</span>
                  {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Suggested Prompts */}
        <div>
          <div className="flex items-center gap-1.5 mb-2.5 px-1 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Autonomous Tasks</span>
          </div>
          <div className="space-y-2">
            {PRESET_PROMPTS.map((prompt, index) => {
              const Icon = prompt.icon;
              return (
                <button
                  key={index}
                  onClick={() => onSelectPrompt(prompt.query)}
                  className="w-full p-2.5 rounded-xl bg-slate-900/40 hover:bg-indigo-950/30 border border-slate-800/80 hover:border-indigo-500/40 text-left transition-all group"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="w-3.5 h-3.5 text-indigo-400 group-hover:text-cyan-400 transition-colors" />
                    <span className="text-xs font-semibold text-slate-200 group-hover:text-white">
                      {prompt.title}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                    {prompt.query}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer Info Box */}
      <div className="mt-4 p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400 space-y-1">
        <div className="flex items-center justify-between font-medium text-slate-300">
          <span>Agent State Machine</span>
          <span className="flex items-center gap-1 text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Active
          </span>
        </div>
        <p className="text-[11px] text-slate-500 leading-tight">
          Bounded test & repair loop enabled. Secret security scanner active.
        </p>
      </div>
    </aside>
  );
};
