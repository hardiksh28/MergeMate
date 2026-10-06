import Link from "next/link";

/** The mark: two branches (your work + the project) merging into one. The open nodes double as eyes: your mate. */
export function LogoMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="10" fill="var(--lime)" />
      <path
        d="M9.5 10.5v1.8c0 3.6 6.5 3.2 6.5 7.2V24M22.5 10.5v1.8c0 3.6-6.5 3.2-6.5 7.2"
        fill="none"
        stroke="var(--lime-ink)"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <circle cx="9.5" cy="8.6" r="2.6" fill="var(--lime)" stroke="var(--lime-ink)" strokeWidth="2.3" />
      <circle cx="22.5" cy="8.6" r="2.6" fill="var(--lime)" stroke="var(--lime-ink)" strokeWidth="2.3" />
      <circle cx="16" cy="24.6" r="2.9" fill="var(--lime-ink)" />
    </svg>
  );
}

export function Logo({ href = "/", size = 30 }: { href?: string; size?: number }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-2" aria-label="MergeMate home">
      <LogoMark size={size} className="transition-transform duration-300 group-hover:-rotate-12" />
      <span className="font-display text-[1.35rem] font-extrabold leading-none">
        merge<span className="text-lime">mate</span>
      </span>
    </Link>
  );
}
