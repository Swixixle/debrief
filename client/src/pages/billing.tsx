import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useCredits } from "@/hooks/useCredits";
import { useAuth } from "@clerk/clerk-react";

type Product = {
  priceId: string;
  amount: number | null;
  currency: string;
  interval: string | null;
  credits: number | null;
};

export default function BillingPage() {
  const { data: credits } = useCredits();
  const { isSignedIn } = useAuth();

  const { data: catalog } = useQuery({
    queryKey: ["/api/billing/products"],
    queryFn: async () => {
      const res = await fetch("/api/billing/products");
      if (!res.ok) return { active: false, products: [] as Product[] };
      return res.json() as { active: boolean; products: Product[] };
    },
  });

  const billingLive = !!catalog?.active;
  const productsFromStripe = catalog?.products?.length;

  const tiers = [
    { name: "Starter", credits: "10 runs", price: "$—", env: "STRIPE_PRICE_STARTER" },
    { name: "Builder", credits: "50 runs", price: "$—", env: "STRIPE_PRICE_BUILDER" },
    { name: "Studio", credits: "200 runs", price: "$—", env: "STRIPE_PRICE_STUDIO" },
    { name: "Unlimited", credits: "per month", price: "$—/mo", env: "STRIPE_PRICE_UNLIMITED" },
  ];

  const startCheckout = async (priceId: string) => {
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priceId }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      alert(typeof b.error === "string" ? b.error : "Checkout unavailable");
      return;
    }
    const { url } = (await res.json()) as { url?: string };
    if (url) window.location.href = url;
  };

  return (
    <Layout variant="light">
      <div className="max-w-4xl mx-auto text-left space-y-8">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Billing</h1>
          <p className="mt-2 text-slate-600">
            {billingLive
              ? "Choose a plan. You are only charged when billing is active."
              : "Pricing launching soon — everything below is a preview."}
          </p>
        </div>

        {!billingLive && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <p className="font-medium">Pricing launching soon</p>
            <p className="mt-1 text-amber-900/90">
              Credit enforcement stays off until your team flips <code className="font-mono">DEBRIEF_BILLING_ACTIVE=1</code>.
              Your balance shows as unlimited in the UI until then.
            </p>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-sm text-slate-700">
          <p>
            <span className="text-slate-500">Current balance:</span>{" "}
            <span className="tabular-nums font-medium text-slate-900">
              {credits?.creditsRemaining ?? "—"}
            </span>
          </p>
          {!credits?.billingActive && (
            <p className="mt-2 text-slate-500">Billing flag off — runs do not consume credits yet.</p>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {(productsFromStripe
            ? catalog!.products.map((p) => ({
                name: p.priceId,
                sub: p.credits != null ? `${p.credits} credits` : p.interval ? `/${p.interval}` : "",
                price:
                  p.amount != null
                    ? `${(p.amount / 100).toFixed(0)} ${p.currency?.toUpperCase()}`
                    : "$—",
                priceId: p.priceId,
              }))
            : tiers.map((t) => ({
                name: t.name,
                sub: t.credits,
                price: t.price,
                priceId: "",
              }))
          ).map((card) => (
            <div
              key={card.name + card.price}
              className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm flex flex-col gap-4"
            >
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{card.name}</h2>
                <p className="text-sm text-slate-600">{card.sub}</p>
                <p className="mt-3 text-2xl font-semibold text-slate-900">{card.price}</p>
              </div>
              <Button
                type="button"
                disabled={!billingLive || !isSignedIn || !card.priceId}
                className="mt-auto"
                onClick={() => card.priceId && startCheckout(card.priceId)}
              >
                {!isSignedIn ? "Sign in to buy" : !billingLive ? "Not available yet" : "Buy"}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}
