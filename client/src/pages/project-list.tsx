import { Link } from "wouter";
import { useProjects } from "@/hooks/use-projects";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { GitBranch, Calendar, Terminal } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { useDebriefApiKey } from "@/contexts/DebriefApiKeyContext";
import { isOpenWeb } from "@/lib/openWeb";

export default function ProjectList() {
  const { apiKey } = useDebriefApiKey();
  const { data: projects, isLoading, error } = useProjects();
  const hasApiAccess = isOpenWeb || Boolean(apiKey.trim());

  if (!hasApiAccess) {
    return (
      <Layout>
        <div className="max-w-lg mx-auto text-center py-20 px-4">
          <Card>
            <CardContent className="pt-8 pb-8 space-y-4">
              <h2 className="text-lg font-semibold">API key required</h2>
              <p className="text-muted-foreground text-sm">
                Enter your API key on the home page first, then you can open your saved debriefs.
              </p>
              <Link href="/">
                <Button>Go to home</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  if (isLoading) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-[50vh] space-y-4">
          <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
          <p className="text-muted-foreground font-mono animate-pulse">Loading library…</p>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="text-center py-20 text-destructive">
          <h2 className="text-2xl font-bold">System Error</h2>
          <p>{error.message}</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Library</h1>
            <p className="text-muted-foreground mt-1">Your debriefs and analysis history.</p>
          </div>
          <Link href="/">
            <div className="text-sm text-primary hover:text-primary/80 font-medium cursor-pointer">
              + New debrief
            </div>
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {projects?.map((project, i) => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Link href={`/projects/${project.id}`}>
                <Card className="p-6 hover:bg-secondary/40 transition-all duration-200 cursor-pointer border-white/5 hover:border-primary/30 group">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <h3 className="text-xl font-semibold font-display group-hover:text-primary transition-colors">
                          {project.name}
                        </h3>
                        <StatusBadge status={project.status} />
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground font-mono">
                        <span className="flex items-center gap-1.5 truncate max-w-[300px]">
                          {project.mode === "replit" ? <Terminal className="w-3.5 h-3.5" /> : <GitBranch className="w-3.5 h-3.5" />}
                          {project.url}
                        </span>
                        {project.createdAt && (
                          <span className="flex items-center gap-1.5">
                            <Calendar className="w-3.5 h-3.5" />
                            {formatDistanceToNow(new Date(project.createdAt), { addSuffix: true })}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center text-xs font-mono text-muted-foreground bg-background px-3 py-1.5 rounded border border-border">
                      ID: {String(project.id).padStart(4, '0')}
                    </div>
                  </div>
                </Card>
              </Link>
            </motion.div>
          ))}

          {projects?.length === 0 && (
            <div className="text-center py-20 border border-dashed border-border rounded-xl">
              <p className="text-muted-foreground">No debriefs in your library yet.</p>
              <Link href="/">
                <div className="mt-4 text-primary hover:underline cursor-pointer">Run your first debrief</div>
              </Link>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
