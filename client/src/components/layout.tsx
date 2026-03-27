import { Link, useLocation } from "wouter";
import { Terminal, Github } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect } from "react";
import { CreditBadge } from "@/components/CreditBadge";
import { ClerkNav } from "@/components/ClerkNav";

export function Layout({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "light";
}) {
  const [location] = useLocation();
  const isLight = variant === "light";

  useEffect(() => {
    document.title = "Debrief";
  }, []);

  return (
    <div
      className={cn(
        "min-h-screen flex flex-col font-sans",
        isLight ? "bg-white text-slate-900 selection:bg-slate-200" : "bg-background text-foreground selection:bg-primary/30",
      )}
    >
      <header
        className={cn(
          "sticky top-0 z-50 border-b backdrop-blur-md",
          isLight ? "border-slate-200 bg-white/90" : "border-border/40 bg-background/80",
        )}
      >
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div
              className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center border transition-all duration-300",
                isLight
                  ? "bg-slate-900 text-white border-slate-800 group-hover:bg-slate-800"
                  : "bg-primary/10 text-primary border-primary/20 group-hover:border-primary/50 group-hover:bg-primary/20 group-hover:shadow-[0_0_20px_-5px_rgba(var(--primary),0.5)]",
              )}
            >
              <Terminal className="w-5 h-5" />
            </div>
            <div className="flex flex-col">
              <span
                className={cn(
                  "font-display font-bold text-lg leading-none tracking-tight",
                  isLight ? "text-slate-900" : "text-foreground",
                )}
              >
                Debrief
              </span>
              <span
                className={cn(
                  "text-[10px] uppercase tracking-widest font-mono",
                  isLight ? "text-slate-500" : "text-muted-foreground",
                )}
              >
                Evidence-backed briefs
              </span>
            </div>
          </Link>

          <nav className="flex items-center gap-1 md:gap-2">
            <NavLink href="/" active={location === "/"} isLight={isLight}>
              New debrief
            </NavLink>
            <NavLink href="/projects" active={location.startsWith("/projects")} isLight={isLight}>
              Archives
            </NavLink>
            <NavLink href="/ci" active={location.startsWith("/ci")} isLight={isLight}>
              CI Feed
            </NavLink>
            <NavLink href="/billing" active={location.startsWith("/billing")} isLight={isLight}>
              Billing
            </NavLink>
            <div className={cn("hidden sm:flex items-center", isLight ? "text-slate-600" : "text-muted-foreground")}>
              <CreditBadge isLight={isLight} />
            </div>
            <ClerkNav isLight={isLight} />
            <div className={cn("w-px h-6 mx-2", isLight ? "bg-slate-200" : "bg-border")} />
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className={cn(
                "p-2 transition-colors",
                isLight ? "text-slate-500 hover:text-slate-900" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Github className="w-5 h-5" />
            </a>
          </nav>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-8 md:py-12 relative">
        {!isLight && (
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent pointer-events-none -z-10 h-[600px]" />
        )}
        {children}
      </main>

      <footer className={cn("py-8 mt-auto border-t", isLight ? "border-slate-200" : "border-border/40")}>
        <div
          className={cn(
            "container mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-4 text-sm",
            isLight ? "text-slate-600" : "text-muted-foreground",
          )}
        >
          <p className="font-mono text-xs">
            {isLight ? <span className="text-slate-900 font-medium">DEBRIEF</span> : <span className="text-primary">SYSTEM:</span>}
            {!isLight && " ONLINE"}
            {isLight && " — Ready"}
          </p>
          <p>© 2025 Debrief. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

function NavLink({
  href,
  active,
  children,
  isLight,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
  isLight: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
        isLight
          ? active
            ? "bg-slate-900 text-white"
            : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
          : active
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:text-foreground hover:bg-white/5",
      )}
    >
      {children}
    </Link>
  );
}
