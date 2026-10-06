"use client";
import Link from "next/link";
import { Check, Lock, X } from "lucide-react";
import { FREE_ISSUES_PER_MONTH } from "@/lib/pricing";

export function Paywall({ onClose, onContinue }: { onClose: () => void; onContinue: () => void }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="card animate-rise relative w-full max-w-md p-7" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 text-muted hover:text-ink" aria-label="Close"><X className="h-5 w-5" /></button>
        <p className="text-4xl">🚀</p>
        <h2 className="font-display mt-4 text-3xl font-extrabold leading-tight">You used your {FREE_ISSUES_PER_MONTH} free issues this month.</h2>
        <p className="mt-2 text-muted">You&apos;re clearly on a roll. Go unlimited and lock the early price before the next 100 spots go.</p>
        <ul className="mt-5 space-y-2 text-sm">
          {["Unlimited guided issues", "Interview prep for every PR", "Maintainer reply helper"].map((f) => (
            <li key={f} className="flex gap-2"><Check className="h-4 w-4 text-lime" />{f}</li>
          ))}
        </ul>
        <Link href="/#pricing" className="btn-lime mt-6 w-full py-3"><Lock className="h-4 w-4" /> Lock $8/mo forever</Link>
        <button onClick={onContinue} className="btn-quiet mt-2 w-full text-xs">Continue anyway (beta tester)</button>
      </div>
    </div>
  );
}
