import Link from "next/link";
import { Logo } from "./Logo";
import { MERGECITY_URL } from "@/lib/city-link";

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-line/60 bg-bg/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-1 text-sm text-muted md:flex">
          <Link href="/#how" className="btn-quiet">How it works</Link>
          <Link href="/#profile" className="btn-quiet">Profile</Link>
          <Link href="/#pricing" className="btn-quiet">Pricing</Link>
          <a href={MERGECITY_URL} className="btn-quiet">MergeCity ↗</a>
        </nav>
        <div className="flex items-center gap-2">
          <a href="/api/auth/login?next=%2Fapp" className="btn-quiet hidden sm:inline-flex">Log in</a>
          <Link href="/onboarding" className="btn-lime py-2">Start free</Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line/60">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-10 text-sm text-muted sm:flex-row sm:px-6">
        <Logo size={26} />
        <p>Built for devs who&apos;d rather ship than scroll. © {new Date().getFullYear()} MergeMate</p>
        <div className="flex gap-4">
          <a href={MERGECITY_URL} className="hover:text-ink">MergeCity</a>
          <Link href="/#pricing" className="hover:text-ink">Pricing</Link>
          <Link href="/app" className="hover:text-ink">App</Link>
        </div>
      </div>
    </footer>
  );
}
