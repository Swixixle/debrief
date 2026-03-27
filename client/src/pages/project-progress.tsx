import { Link, useRoute } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const DEMO_POINTS = [
  { date: "Week 1", dci: 0.67 },
  { date: "Week 2", dci: 0.74 },
  { date: "Week 3", dci: 0.89 },
];

/**
 * Placeholder “learning journey” + DCI trend until `runs` rows back charts from Postgres.
 */
export default function ProjectProgress() {
  const [, params] = useRoute("/projects/:id/progress");
  const id = params?.id || "0";

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
        <div className="flex items-center gap-4">
          <Link href={`/projects/${id}`}>
            <span className="text-sm text-primary cursor-pointer">← Back to report</span>
          </Link>
          <h1 className="text-2xl font-semibold">Progress</h1>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <p className="text-muted-foreground text-sm">
              Run history and diffs are backed by the new <code className="text-xs">runs</code> table (see{" "}
              <code className="text-xs">db:push</code>). This view will chart DCI, open endpoints, and CVE counts from
              stored runs once analyzers write summary rows after each completed job.
            </p>
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="text-sm font-medium text-foreground mb-4">Example — trust trend (sample data)</p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={DEMO_POINTS} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} width={48} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(v: number) => [`${Math.round(v * 100)}%`, "DCI"]} />
                    <Line type="monotone" dataKey="dci" stroke="#c2410c" strokeWidth={2} dot />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Learner framing will read like: “Since your first run three weeks ago you tightened weak spots — that is real
              progress.” (copy will pull from actual run-to-run diffs.)
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
