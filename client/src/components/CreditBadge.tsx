import { Link } from "wouter";
import { useCredits } from "@/hooks/useCredits";

export function CreditBadge({ isLight }: { isLight?: boolean }) {
  const { data } = useCredits();
  const unlimited = !data?.billingActive;

  if (unlimited) return null;

  const muted = isLight ? "text-slate-500 hover:text-slate-900" : "text-muted-foreground hover:text-foreground";

  return (
    <div className={`flex items-center gap-2 text-sm ${muted}`}>
      <span className="tabular-nums">⚡ {data?.creditsRemaining ?? "—"}</span>
      {data?.creditsRemaining === 0 && (
        <Link href="/billing" className="underline underline-offset-2 font-medium">
          Buy more
        </Link>
      )}
    </div>
  );
}
