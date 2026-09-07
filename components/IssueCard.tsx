'use client';

import React from 'react';
import { ExternalLink, GitPullRequest, MessageSquare, Tag, Terminal, CheckCircle2, Award } from 'lucide-react';
import { GitHubIssueItem } from '@/lib/github';

interface IssueCardProps {
  issue: GitHubIssueItem;
  onSelectToFix: (issue: GitHubIssueItem) => void;
}

export const IssueCard: React.FC<IssueCardProps> = ({ issue, onSelectToFix }) => {
  const isHighScore = (issue.score || 0) >= 75;
  const isMedScore = (issue.score || 0) >= 50 && (issue.score || 0) < 75;

  return (
    <div className="p-4 rounded-xl glass-panel border border-slate-800 hover:border-indigo-500/40 transition-all shadow-md hover:shadow-indigo-500/5 group flex flex-col justify-between gap-3 relative">
      <div>
        {/* Repository Header & Score Badges */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs font-mono font-medium text-cyan-400 bg-cyan-950/40 border border-cyan-500/30 px-2 py-0.5 rounded truncate max-w-[200px]">
            {issue.repo_full_name}
          </span>
          <div className="flex items-center gap-2 text-xs shrink-0">
            {issue.score !== undefined && (
              <span
                className={`flex items-center gap-1 font-mono text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                  isHighScore
                    ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                    : isMedScore
                    ? 'bg-amber-950/50 border-amber-500/40 text-amber-300'
                    : 'bg-slate-900 border-slate-700 text-slate-400'
                }`}
                title={issue.score_reasons ? issue.score_reasons.join(' • ') : `Score: ${issue.score}/100`}
              >
                <Award className="w-3 h-3" />
                <span>{issue.score}/100</span>
              </span>
            )}
            <span className="flex items-center gap-1 text-slate-400 text-xs">
              <MessageSquare className="w-3 h-3" /> {issue.comments_count}
            </span>
            <a
              href={issue.html_url}
              target="_blank"
              rel="noreferrer"
              className="text-slate-400 hover:text-white transition-colors"
              title="Open Issue on GitHub"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>

        {/* Issue Title */}
        <h4 className="font-semibold text-sm text-slate-100 group-hover:text-indigo-300 transition-colors line-clamp-2 mb-2">
          #{issue.number}: {issue.title}
        </h4>

        {/* Description snippet */}
        <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed mb-3">
          {issue.body}
        </p>

        {/* Tech Stack & Status Badges */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {/* Verified Unassigned badge */}
          <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-emerald-950/30 border border-emerald-500/30 text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
            Verified Open & Unassigned
          </span>

          {issue.tech_stack.map((tech, idx) => (
            <span
              key={idx}
              className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-slate-900 border border-slate-700/60 text-slate-300 flex items-center gap-1"
            >
              <Terminal className="w-2.5 h-2.5 text-indigo-400" />
              {tech}
            </span>
          ))}

          {issue.labels.slice(0, 2).map((label, idx) => (
            <span
              key={idx}
              className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-indigo-950/40 border border-indigo-500/30 text-indigo-300 flex items-center gap-1"
            >
              <Tag className="w-2.5 h-2.5 text-indigo-400" />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Action Button */}
      <button
        onClick={() => onSelectToFix(issue)}
        className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-indigo-600/20 hover:bg-indigo-600 border border-indigo-500/30 hover:border-indigo-500 text-indigo-300 hover:text-white text-xs font-semibold transition-all group/btn shadow-sm"
      >
        <GitPullRequest className="w-3.5 h-3.5 group-hover/btn:scale-110 transition-transform" />
        <span>Fix Code & Create PR</span>
      </button>
    </div>
  );
};
