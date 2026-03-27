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
import ProjectProgress from "@/pages/project-progress";
import CiFeed from "@/pages/ci-feed";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/portal" component={Portal} />
      <Route path="/projects" component={ProjectList} />
      <Route path="/projects/:id/progress" component={ProjectProgress} />
      <Route path="/projects/:id" component={ProjectDetails} />
      <Route path="/ci" component={CiFeed} />
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
