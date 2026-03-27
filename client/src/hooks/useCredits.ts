import { useQuery } from "@tanstack/react-query";

export type CreditsPayload = {
  creditsRemaining: number;
  tier?: string;
  billingActive: boolean;
};

export function useCredits() {
  return useQuery({
    queryKey: ["/api/billing/credits"],
    queryFn: async (): Promise<CreditsPayload> => {
      const res = await fetch("/api/billing/credits", { credentials: "include" });
      if (!res.ok) {
        return { creditsRemaining: 999_999, billingActive: false };
      }
      return (await res.json()) as CreditsPayload;
    },
    staleTime: 60_000,
  });
}
