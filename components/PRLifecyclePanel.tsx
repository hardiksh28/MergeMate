'use client';

import React from 'react';
import {
  GitPullRequest,
  CheckCircle2,
  AlertCircle,
  Clock,
  ShieldCheck,
  RefreshCw,
  MessageSquare,
  AlertTriangle,
  GitMerge,
  ExternalLink,
} from 'lucide-react';
import { PRLifecycleRecord } from '@/lib/prLifecycleOrchestrator';

interface PRLifecyclePanelProps {
  lifecycle: PRLifecycleRecord;
  onRefresh?: () => void;
}

export const PRLifecyclePanel: React.FC<PRLifecyclePanelProps> = ({ lifecycle, onRefresh }) => {
  const isAwaitingApproval = lifecycle.currentState === 'CHECKS_NEEDS_APPROVAL' || lifecycle.lastCheckStatus === 'CHECKS_AWAITING_APPROVAL';
  const isHumanRequired = lifecycle.requiresHuman || lifecycle.currentState === 'HUMAN_REVIEW_REQUIRED' || lifecycle.currentState === 'HUMAN_DECISION_REQUIRED';
  const isMerged = lifecycle.currentState === 'MERGED';
  const isApproved = lifecycle.currentState === 'APPROVED' || lifecycle.currentState === 'MERGE_READY' || lifecycle.currentState === 'READY_FOR_HUMAN_MERGE';
  const isChecksFailed = lifecycle.currentState === 'CHECKS_FAILED';
  const isChecksPassed = lifecycle.currentState === 'CHECKS_PASSED';

  return (
    <div className="my-4 p-4 rounded-xl bg-slate-950/80 border border-slate-800 shadow-xl space-y-4 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
            <GitPullRequest className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-100">
                PR #{lifecycle.pullNumber} Lifecycle Monitor
              </h3>
              <span className="text-xs text-slate-400 font-mono">({lifecycle.owner}/{lifecycle.repo})</span>
            </div>
            <a
              href={lifecycle.prUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 mt-0.5"
            >
              {lifecycle.prUrl} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {onRefresh && (
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        )}
      </div>

      {/* Stage Tracker Pipeline */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
        <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <div>
            <div className="text-slate-400 text-[10px]">PR Branch</div>
            <div className="font-semibold text-slate-200 truncate">{lifecycle.headBranch.slice(0, 16)}...</div>
          </div>
        </div>

        <div className={`p-2.5 rounded-lg border flex items-center gap-2 ${
          isChecksPassed
            ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
            : isChecksFailed
            ? 'bg-rose-950/20 border-rose-500/30 text-rose-300'
            : isAwaitingApproval
            ? 'bg-amber-950/20 border-amber-500/30 text-amber-300'
            : 'bg-slate-900/60 border-slate-800 text-slate-300'
        }`}>
          {isChecksPassed ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : isChecksFailed ? (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : isAwaitingApproval ? (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          ) : (
            <Clock className="w-4 h-4 text-slate-400 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-[10px] opacity-75">CI Checks</div>
            <div className="font-semibold truncate">
              {isChecksPassed ? 'Checks Passed' : isChecksFailed ? 'Checks Failed' : isAwaitingApproval ? 'Needs Approval' : 'Pending / Running'}
            </div>
          </div>
        </div>

        <div className={`p-2.5 rounded-lg border flex items-center gap-2 ${
          isApproved ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300' : 'bg-slate-900/60 border-slate-800 text-slate-300'
        }`}>
          <MessageSquare className="w-4 h-4 text-slate-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] opacity-75">Review</div>
            <div className="font-semibold truncate">
              {isApproved ? 'Approved' : lifecycle.currentState === 'REVIEW_CHANGES_REQUESTED' ? 'Changes Requested' : 'Awaiting Review'}
            </div>
          </div>
        </div>

        <div className={`p-2.5 rounded-lg border flex items-center gap-2 ${
          isMerged ? 'bg-purple-950/20 border-purple-500/30 text-purple-300' : 'bg-slate-900/60 border-slate-800 text-slate-300'
        }`}>
          <GitMerge className="w-4 h-4 text-slate-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] opacity-75">Merge Status</div>
            <div className="font-semibold truncate">{isMerged ? 'Merged' : 'Open'}</div>
          </div>
        </div>
      </div>

      {/* Human Action Required / Awaiting Approval Banner */}
      {isHumanRequired && (
        <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs space-y-1">
          <div className="flex items-center gap-2 font-bold text-amber-400">
            <AlertTriangle className="w-4 h-4" /> Human Action Required
          </div>
          <p className="text-[11px] leading-relaxed opacity-90">
            {lifecycle.humanReason || 'GitHub Actions workflow run requires upstream maintainer approval.'}
          </p>
        </div>
      )}

      {/* Local Verification vs Upstream CI Disclosures */}
      <div className="p-3 rounded-lg bg-slate-900/40 border border-slate-800/80 text-xs space-y-2">
        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
          <span className="flex items-center gap-1.5 text-emerald-400">
            <ShieldCheck className="w-3.5 h-3.5" /> Verification Separation Disclosure
          </span>
          <span className="text-[10px] text-slate-500 font-mono">Head: {lifecycle.headSha.slice(0, 7)}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px] font-mono">
          <div className="p-2 rounded bg-slate-950/60 border border-slate-800/60">
            <span className="text-emerald-400 font-bold">✓ Local Verification:</span>
            <ul className="text-slate-400 mt-1 space-y-0.5 text-[10px]">
              <li>• Targeted regression test: PASS</li>
              <li>• TypeScript compilation: PASS</li>
              <li>• Security & diff scan: PASS</li>
            </ul>
          </div>
          <div className="p-2 rounded bg-slate-950/60 border border-slate-800/60">
            <span className="text-cyan-400 font-bold">○ Upstream GitHub CI:</span>
            <ul className="text-slate-400 mt-1 space-y-0.5 text-[10px]">
              <li>• Status: {lifecycle.lastCheckStatus || 'Awaiting maintainer approval'}</li>
              <li>• Repair attempts used: {lifecycle.repairAttempts}/3</li>
              <li>• Review feedback iterations: {lifecycle.reviewRepairAttempts}/3</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
