'use client';

import React from 'react';
import { X, ExternalLink, GitPullRequest, CheckCircle2, Copy, Code, ArrowRight } from 'lucide-react';
import { PRResult } from '@/lib/github';

interface PRPreviewModalProps {
  prResult: PRResult | null;
  onClose: () => void;
}

export const PRPreviewModal: React.FC<PRPreviewModalProps> = ({ prResult, onClose }) => {
  const [copied, setCopied] = React.useState(false);
  const [descCopied, setDescCopied] = React.useState(false);

  if (!prResult) return null;

  const handleCopyDiff = () => {
    if (prResult.diffPreview) {
      navigator.clipboard.writeText(prResult.diffPreview);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCopyDescription = () => {
    if (prResult.prBody) {
      navigator.clipboard.writeText(prResult.prBody);
      setDescCopied(true);
      setTimeout(() => setDescCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-2xl glass-panel border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h3 className="font-bold text-slate-100 text-base flex items-center gap-2">
                {prResult.readyForManualSubmit ? 'Ready for Your Review' : 'Pull Request Created'}
                {prResult.simulated && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                    Demo Mode
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-400">
                Branch: <code className="font-mono text-cyan-400">{prResult.branchName}</code>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Status Message */}
          <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 text-xs text-slate-300 leading-relaxed">
            {prResult.readyForManualSubmit
              ? 'MergeMate forked the repo, pushed a branch, and wrote the code fix + PR description below. It never submits the PR itself — open the link and click "Create pull request" on GitHub when you\'re happy with it.'
              : prResult.message}
          </div>

          {/* PR Description */}
          {prResult.prBody && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5 uppercase tracking-wider">
                  <GitPullRequest className="w-3.5 h-3.5 text-indigo-400" />
                  PR Description (auto-written)
                </span>
                <button
                  onClick={handleCopyDescription}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
                >
                  <Copy className="w-3 h-3" />
                  {descCopied ? 'Copied!' : 'Copy Description'}
                </button>
              </div>
              <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300 overflow-x-auto max-h-40 leading-relaxed whitespace-pre-wrap">
                <code>{prResult.prBody}</code>
              </pre>
            </div>
          )}

          {/* Code Diff Box */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5 uppercase tracking-wider">
                <Code className="w-3.5 h-3.5 text-indigo-400" />
                Generated Code Diff
              </span>
              <button
                onClick={handleCopyDiff}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
              >
                <Copy className="w-3 h-3" />
                {copied ? 'Copied!' : 'Copy Patch'}
              </button>
            </div>
            <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300 overflow-x-auto max-h-60 leading-relaxed">
              <code>{prResult.diffPreview || 'No diff available.'}</code>
            </pre>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
          >
            Close
          </button>

          {(prResult.compareUrl || prResult.prUrl) && (
            <a
              href={prResult.compareUrl || prResult.prUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 transition-all"
            >
              <span>{prResult.readyForManualSubmit ? 'Open Pull Request on GitHub' : 'View Pull Request on GitHub'}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
};
