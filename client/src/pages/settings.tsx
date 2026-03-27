import { useCallback, useState, type ReactNode } from "react";
import {
  SignInButton,
  SignedIn,
  SignedOut,
  useAuth,
  useUser,
} from "@clerk/clerk-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Link } from "wouter";
import { useCredits } from "@/hooks/useCredits";
import {
  SiGithub,
  SiSlack,
  SiDiscord,
  SiNotion,
} from "react-icons/si";
import { Code2, Link2 } from "lucide-react";

type ApiKeyRow = {
  id: number;
  keyPrefix: string;
  label: string;
  createdAt: string | null;
  lastUsedAt: string | null;
};

function IntegrationCard({
  name,
  description,
  status,
  docsUrl,
  icon,
}: {
  name: string;
  description: string;
  status: "available" | "coming-soon" | "planned";
  docsUrl?: string;
  icon: ReactNode;
}) {
  const badge =
    status === "available"
      ? "bg-emerald-100 text-emerald-900"
      : status === "coming-soon"
        ? "bg-amber-100 text-amber-900"
        : "bg-slate-100 text-slate-700";
  const label = status === "available" ? "Available" : status === "coming-soon" ? "Coming soon" : "Planned";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm flex gap-4">
      <div className="shrink-0 text-slate-700 text-2xl">{icon}</div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-slate-900">{name}</h3>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge}`}>{label}</span>
        </div>
        <p className="text-sm text-slate-600">{description}</p>
        {docsUrl ? (
          <a href={docsUrl} className="text-sm text-slate-900 underline underline-offset-2">
            View docs
          </a>
        ) : null}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { isSignedIn, isLoaded } = useAuth();
  const { user } = useUser();
  const { data: credits } = useCredits();
  const qc = useQueryClient();

  const keysQuery = useQuery({
    queryKey: ["/api/keys"],
    enabled: !!isSignedIn,
    queryFn: async (): Promise<ApiKeyRow[]> => {
      const res = await fetch("/api/keys", { credentials: "include" });
      if (res.status === 401) return [];
      if (!res.ok) throw new Error("Failed to load keys");
      return res.json();
    },
  });

  const [label, setLabel] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);

  const createKey = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/keys", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || "Default" }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(typeof b.error === "string" ? b.error : "Could not create key");
      }
      return res.json() as { key: string; prefix: string; label: string };
    },
    onSuccess: (data) => {
      setNewKey(data.key);
      setLabel("");
      void qc.invalidateQueries({ queryKey: ["/api/keys"] });
    },
  });

  const revokeKey = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/keys/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Revoke failed");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["/api/keys"] }),
  });

  const copyKey = useCallback(async () => {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
  }, [newKey]);

  return (
    <Layout variant="light">
      <div className="max-w-3xl mx-auto space-y-10 text-left">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Settings</h1>
          <p className="mt-2 text-slate-600">API keys, account, and integrations.</p>
        </div>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">API keys</h2>
          <SignedOut>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-700">
              <p className="font-medium text-slate-900">Sign in to create API keys</p>
              <p className="mt-2">Keys are tied to your account and power the GitHub Action and public API.</p>
              <SignInButton mode="modal">
                <Button className="mt-4">Sign in</Button>
              </SignInButton>
            </div>
          </SignedOut>
          <SignedIn>
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 shadow-sm">
              <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="key-label">Label</Label>
                  <Input
                    id="key-label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. CI / laptop"
                  />
                </div>
                <Button type="button" onClick={() => createKey.mutate()} disabled={createKey.isPending}>
                  Generate new key
                </Button>
              </div>
              {createKey.isError && (
                <p className="text-sm text-red-700">{(createKey.error as Error).message}</p>
              )}

              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Your keys</p>
                {keysQuery.isLoading ? (
                  <p className="mt-3 text-sm text-slate-600">Loading…</p>
                ) : keysQuery.data?.length ? (
                  <ul className="mt-3 divide-y divide-slate-100">
                    {keysQuery.data.map((k) => (
                      <li key={k.id} className="py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                        <div>
                          <span className="font-mono text-slate-900">{k.keyPrefix}…</span>
                          <span className="text-slate-500"> — {k.label}</span>
                          {k.lastUsedAt ? (
                            <span className="block text-xs text-slate-400">
                              Last used {new Date(k.lastUsedAt).toLocaleString()}
                            </span>
                          ) : (
                            <span className="block text-xs text-slate-400">Never used</span>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-red-700 border-red-200"
                          onClick={() => revokeKey.mutate(k.id)}
                          disabled={revokeKey.isPending}
                        >
                          Revoke
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-slate-600">No keys yet.</p>
                )}
              </div>
            </div>
          </SignedIn>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Account</h2>
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-sm text-slate-700 space-y-2">
            {!isLoaded ? (
              <p>Loading…</p>
            ) : isSignedIn ? (
              <>
                <p>
                  <span className="text-slate-500">Email:</span>{" "}
                  {user?.primaryEmailAddress?.emailAddress ?? "—"}
                </p>
                <p>
                  <span className="text-slate-500">Credits:</span>{" "}
                  <span className="tabular-nums">{credits?.creditsRemaining ?? "—"}</span>
                  {credits?.billingActive ? null : (
                    <span className="text-slate-500"> (unlimited until billing is live)</span>
                  )}
                </p>
                <p className="pt-2">
                  <Link href="/billing" className="text-slate-900 font-medium underline underline-offset-2">
                    Billing & plans
                  </Link>
                </p>
              </>
            ) : (
              <p>Sign in to manage your account.</p>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Integrations</h2>
          <div className="grid gap-4">
            <IntegrationCard
              name="GitHub Action"
              description="Analyze your repo on every push. See docs/INTEGRATIONS.md in this repository for setup."
              status="available"
              icon={<SiGithub />}
            />
            <IntegrationCard
              name="VS Code"
              description="Right-click any folder to analyze."
              status="coming-soon"
              icon={<Code2 className="w-7 h-7" />}
            />
            <IntegrationCard
              name="Slack"
              description="Get reports in your channel."
              status="coming-soon"
              icon={<SiSlack />}
            />
            <IntegrationCard
              name="Discord"
              description="Bot slash command for your server."
              status="coming-soon"
              icon={<SiDiscord />}
            />
            <IntegrationCard
              name="Notion"
              description="Ingest is available from the app; workspace automation is expanding."
              status="available"
              icon={<SiNotion />}
            />
            <IntegrationCard
              name="Zapier"
              description="Connect Debrief to any workflow."
              status="planned"
              icon={<Link2 className="w-7 h-7" />}
            />
          </div>
        </section>

        <Dialog open={!!newKey} onOpenChange={(o) => !o && setNewKey(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Copy your API key</DialogTitle>
              <DialogDescription>
                This is the only time the full key is shown. Store it in a password manager or secret store.
              </DialogDescription>
            </DialogHeader>
            {newKey && (
              <div className="space-y-3">
                <pre className="text-xs bg-slate-100 p-3 rounded-md overflow-x-auto break-all">{newKey}</pre>
                <DialogFooter className="gap-2 sm:gap-0">
                  <Button type="button" variant="secondary" onClick={() => copyKey()}>
                    Copy
                  </Button>
                  <Button type="button" onClick={() => setNewKey(null)}>
                    Done
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
