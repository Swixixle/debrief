import { SignInButton, SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";
import { cn } from "@/lib/utils";
import { clerkPublishableKey } from "@/lib/clerkEnv";

/** `headerTone` only affects Signed-out Sign in styling on light headers (billing/settings). */
export function ClerkNav({ headerTone = "default" }: { headerTone?: "default" | "light" }) {
  const pk = clerkPublishableKey();
  if (!pk) return null;

  const btn = cn(
    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
    headerTone === "light"
      ? "bg-slate-900 text-white hover:bg-slate-800"
      : "bg-primary text-primary-foreground hover:opacity-90",
  );

  return (
    <>
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
