import { SignInButton, useAuth } from "@clerk/clerk-react";

/** Nudge signed-out users to persist run history (requires Clerk). */
export function HistoryAuthNudge({ show }: { show: boolean }) {
  const pk = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (!pk || !show) return null;
  return <HistoryAuthNudgeInner />;
}

function HistoryAuthNudgeInner() {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded || isSignedIn) return null;

  return (
    <div className="auth-nudge rounded-lg border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 space-y-2">
      <p className="font-medium">Sign in to save your run history across sessions.</p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <SignInButton mode="modal">
          <button
            type="button"
            className="rounded-md bg-amber-900 px-3 py-1.5 text-white text-sm font-medium hover:bg-amber-800"
          >
            Sign in free
          </button>
        </SignInButton>
        <span className="text-amber-800/90">or continue without saving</span>
      </div>
    </div>
  );
}

