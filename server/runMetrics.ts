/**
 * Summaries for runs table + cache from analyzer artifacts.
 */
export function extractRunSummary(
  operate: any,
  claims: any,
  apiSurface: any,
  dependencyGraph: any,
): {
  dciScore: number | null;
  claimCount: number | null;
  verifiedCount: number | null;
  openEndpointCount: number | null;
  criticalIssueCount: number | null;
  dependencyCount: number | null;
  flaggedDependencyCount: number | null;
} {
  const dciRaw = operate?.metrics?.dci_v1_claim_visibility?.score;
  const dciScore = dciRaw != null && !Number.isNaN(Number(dciRaw)) ? Number(dciRaw) : null;

  let claimCount: number | null = null;
  let verifiedCount: number | null = null;
  const claimArr = Array.isArray(claims)
    ? claims
    : claims && typeof claims === "object" && Array.isArray((claims as any).claims)
      ? (claims as any).claims
      : null;
  if (claimArr) {
    claimCount = claimArr.length;
    verifiedCount = claimArr.filter((c: any) => c?.verified === true || c?.status === "VERIFIED").length;
  }

  const endpoints =
    apiSurface?.endpoints ??
    apiSurface?.http_endpoints ??
    apiSurface?.routes ??
    apiSurface?.paths;
  let openEndpointCount: number | null = null;
  if (Array.isArray(endpoints)) {
    openEndpointCount = endpoints.filter(
      (e: any) =>
        e?.open === true ||
        String(e?.exposure || "").toLowerCase() === "public" ||
        String(e?.access || "").toLowerCase() === "unauthenticated",
    ).length;
  }

  let criticalIssueCount: number | null = null;
  if (Array.isArray(operate?.gaps)) {
    criticalIssueCount = operate.gaps.filter(
      (g: any) => String(g?.severity || "").toLowerCase() === "critical",
    ).length;
  }

  const depList =
    dependencyGraph?.dependencies ??
    dependencyGraph?.packages ??
    dependencyGraph?.direct_dependencies ??
    dependencyGraph?.nodes;
  let dependencyCount: number | null = null;
  let flaggedDependencyCount: number | null = null;
  if (Array.isArray(depList)) {
    dependencyCount = depList.length;
    flaggedDependencyCount = depList.filter(
      (d: any) =>
        (Array.isArray(d?.advisories) && d.advisories.length > 0) ||
        d?.osv_id ||
        d?.cve ||
        d?.vulnerable === true,
    ).length;
  }

  return {
    dciScore,
    claimCount,
    verifiedCount,
    openEndpointCount,
    criticalIssueCount,
    dependencyCount,
    flaggedDependencyCount,
  };
}
