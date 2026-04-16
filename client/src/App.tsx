import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DebriefApiKeyProvider } from "@/contexts/DebriefApiKeyContext";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Portal from "@/pages/portal";
import ProjectList from "@/pages/project-list";
import ProjectDetails from "@/pages/project-details";
import ProjectVerification from "@/pages/project-verification";
import ProjectProgress from "@/pages/project-progress";
import CiFeed from "@/pages/ci-feed";
import Settings from "@/pages/settings";
import Billing from "@/pages/billing";
import BillingSuccess from "@/pages/billing-success";
import TargetsPage from "@/pages/targets";
import TimelinePage from "@/pages/Timeline";
import EvidenceChain from "@/pages/EvidenceChain";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/portal" component={Portal} />
      <Route path="/projects" component={ProjectList} />
      <Route path="/projects/:id/verification" component={ProjectVerification} />
      <Route path="/projects/:id/progress" component={ProjectProgress} />
      <Route path="/projects/:id" component={ProjectDetails} />
      <Route path="/ci" component={CiFeed} />
      <Route path="/settings" component={Settings} />
      <Route path="/billing/success" component={BillingSuccess} />
      <Route path="/billing" component={Billing} />
      <Route path="/targets" component={TargetsPage} />
      <Route path="/timeline/:targetId" component={TimelinePage} />
      <Route path="/education/:runId/chain" component={EvidenceChain} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DebriefApiKeyProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </DebriefApiKeyProvider>
    </QueryClientProvider>
  );
}

export default App;
