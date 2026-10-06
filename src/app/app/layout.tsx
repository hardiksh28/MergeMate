"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Building2, GitPullRequest, LayoutDashboard, Settings, User, Sparkles } from "lucide-react";
import { Logo } from "@/components/Logo";
import { signInHref, useLocal, useSession, type Profile } from "@/lib/client";
import { GithubIcon } from "@/components/ui";
import { FREE_ISSUES_PER_MONTH } from "@/lib/pricing";
import { CityCard, cityHref } from "@/components/CityCard";

export default function AppLayout({ children }: LayoutProps<"/app">) {
  const [profile, , ready] = useLocal<Profile | null>("profile", null);
  const [usageState] = useLocal<{ month: string; ids: string[] }>("usage", { month: "", ids: [] });
  const path = usePathname();
  const session = useSession();
  const router = useRouter();

  useEffect(() => {
    if (ready && !profile && !path.startsWith("/app/settings")) router.replace("/onboarding");
  }, [ready, profile, path, router]);

  const used = usageState.month === new Date().toISOString().slice(0, 7) ? usageState.ids.length : 0;
  const nav = [
    { href: "/app", label: "Matches", icon: LayoutDashboard, active: path === "/app" || path.startsWith("/app/issue") },
    { href: "/app/prs", label: "My PRs", icon: GitPullRequest, active: path.startsWith("/app/prs") },
    { href: profile ? `/u/${profile.username}` : "/onboarding", label: "Profile", icon: User, active: false },
    { href: cityHref(), label: "MergeCity", icon: Building2, active: false, external: true },
    { href: "/app/settings", label: "Settings", icon: Settings, active: path.startsWith("/app/settings") },
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line/70 bg-surface/40 p-4 md:flex">
        <div className="px-2 py-2"><Logo href="/app" size={28} /></div>
        <nav className="mt-8 space-y-1">
          {nav.map((n) => (
            <Link
              key={n.label}
              href={n.href}
              {...("external" in n ? { target: "_blank", rel: "noreferrer" } : {})}
              className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition ${n.active ? "bg-lime text-lime-ink" : "text-muted hover:bg-surface-2 hover:text-ink"}`}
            >
              <n.icon className="h-4 w-4" /> {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          {session.ready && session.configured && !session.user && (
            <a href={signInHref(path)} className="block rounded-2xl border border-lime/40 bg-lime/[0.06] p-4 transition hover:bg-lime/10">
              <p className="flex items-center gap-2 text-sm font-semibold"><GithubIcon /> Sign in with GitHub</p>
              <p className="mt-1 text-xs text-muted">Open PRs in one click and start your MergeMate streak.</p>
            </a>
          )}
          {profile && <CityCard username={profile.username} />}
          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <p className="label">Free issues</p>
            <div className="mt-2 flex gap-1.5">
              {Array.from({ length: FREE_ISSUES_PER_MONTH }, (_, i) => (
                <span key={i} className={`h-2 flex-1 rounded-full ${i < used ? "bg-lime" : "bg-surface-3"}`} />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">{Math.max(0, FREE_ISSUES_PER_MONTH - used)} left this month</p>
            <Link href="/#pricing" className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-lime">
              <Sparkles className="h-3.5 w-3.5" /> Go unlimited
            </Link>
          </div>
          {profile && (
            <div className="flex items-center gap-3 rounded-2xl px-2 py-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={profile.avatar} alt="" className="h-8 w-8 rounded-xl" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{profile.name || profile.username}</p>
                <p className="truncate text-xs text-muted">@{profile.username}</p>
              </div>
            </div>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line/60 bg-bg/80 px-4 backdrop-blur md:hidden">
          <Logo href="/app" size={26} />
          <span className="chip">{Math.max(0, FREE_ISSUES_PER_MONTH - used)} free left</span>
        </header>
        {children}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-bg/90 backdrop-blur md:hidden">
        {nav.map((n) => (
          <Link key={n.label} href={n.href} {...("external" in n ? { target: "_blank", rel: "noreferrer" } : {})} className={`flex flex-col items-center gap-1 py-3 text-[11px] ${n.active ? "text-lime" : "text-muted"}`}>
            <n.icon className="h-5 w-5" /> {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
