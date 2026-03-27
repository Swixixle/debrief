import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { clerkPublishableKey } from "@/lib/clerkEnv";

export function ClerkNav({ isLight }: { isLight: boolean }) {
  const pk = clerkPublishableKey();
  if (!pk) return null;

  const btn = cn(
    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
    isLight ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-primary text-primary-foreground hover:opacity-90",
  );

  return (
    <>
      <Link
        href="/settings"
        className={cn(
          "px-3 py-2 rounded-md text-sm font-medium",
          isLight ? "text-slate-700 hover:bg-slate-100" : "text-foreground/90 hover:bg-muted",
        )}
      >
        Settings
      </Link>
      <SignedOut>
        <SignInButton mode="modal">
          <button type="button" className={btn}>
            Sign in
          </button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <UserButton afterSignOutUrl="/" />
      </SignedIn>
    </>
  );
}
