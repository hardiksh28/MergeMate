'use client';

import React, { useState } from 'react';
import { X, Key, Github, RefreshCw, CheckCircle2, ShieldAlert, Sparkles } from 'lucide-react';
import { KeyRotationStatus } from '@/lib/geminiRotator';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  rotatorStatus: KeyRotationStatus | null;
  githubToken: string;
  onSaveGithubToken: (token: string) => void;
  geminiKeys: string[];
  onSaveGeminiKeys: (keys: string[]) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  rotatorStatus,
  githubToken,
  onSaveGithubToken,
  geminiKeys,
  onSaveGeminiKeys,
}) => {
  const [tokenInput, setTokenInput] = useState(githubToken);
  const [key1, setKey1] = useState(geminiKeys[0] || '');
  const [key2, setKey2] = useState(geminiKeys[1] || '');
  const [key3, setKey3] = useState(geminiKeys[2] || '');
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSave = () => {
    onSaveGithubToken(tokenInput.trim());
    const validKeys = [key1.trim(), key2.trim(), key3.trim()].filter(Boolean);
    onSaveGeminiKeys(validKeys);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-lg glass-panel border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
              <Key className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h3 className="font-bold text-slate-100 text-sm">
                MergeMate Engine & Key Rotator Settings
              </h3>
              <p className="text-xs text-slate-400">
                Configure GitHub Access & Gemini Rotation Pool
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4">
          {/* GitHub Token */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
              <Github className="w-3.5 h-3.5 text-slate-400" />
              GitHub Personal Access Token (PAT)
            </label>
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              className="w-full px-3 py-2 rounded-xl glass-input text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Requires <code className="text-indigo-300 font-mono">public_repo</code> scope to open Pull Requests. If left blank, MergeMate uses process.env or Demo mode.
            </p>
          </div>

          {/* Gemini Key Rotation Pool */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
                Gemini Key Rotator Pool (429 Fallbacks)
              </label>
              <span className="text-[11px] font-mono text-cyan-400 bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-500/30">
                {rotatorStatus?.totalKeys || 0} active keys
              </span>
            </div>

            <div className="space-y-2">
              <input
                type="password"
                value={key1}
                onChange={(e) => setKey1(e.target.value)}
                placeholder="GEMINI_KEY_1 (Primary Key)"
                className="w-full px-3 py-2 rounded-xl glass-input text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
              />
              <input
                type="password"
                value={key2}
                onChange={(e) => setKey2(e.target.value)}
                placeholder="GEMINI_KEY_2 (Fallback Key 1)"
                className="w-full px-3 py-2 rounded-xl glass-input text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
              />
              <input
                type="password"
                value={key3}
                onChange={(e) => setKey3(e.target.value)}
                placeholder="GEMINI_KEY_3 (Fallback Key 2)"
                className="w-full px-3 py-2 rounded-xl glass-input text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
              />
            </div>
            <p className="text-[11px] text-slate-400">
              When a HTTP 429 rate limit is encountered, MergeMate auto-increments to the next API key instantly.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between">
          {savedSuccess ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
              <CheckCircle2 className="w-4 h-4" /> Settings Saved!
            </span>
          ) : (
            <span className="text-xs text-slate-500">Changes apply to current session</span>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/20 transition-all flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Save Credentials</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
