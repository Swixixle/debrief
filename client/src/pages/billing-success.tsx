import { Layout } from "@/components/layout";
import { Link } from "wouter";

export default function BillingSuccessPage() {
  return (
    <Layout variant="light">
      <div className="max-w-lg mx-auto text-center space-y-4">
        <h1 className="text-2xl font-semibold text-slate-900">You&apos;re all set</h1>
        <p className="text-slate-600">Thanks — your session completed in Stripe.</p>
        <Link href="/" className="inline-block text-slate-900 font-medium underline underline-offset-2">
          Back to Debrief
        </Link>
      </div>
    </Layout>
  );
}
