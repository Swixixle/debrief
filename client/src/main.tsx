import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import App from "./App";
import { clerkPublishableKey } from "./lib/clerkEnv";
import "./index.css";

const publishableKey = clerkPublishableKey();
const app = <App />;

createRoot(document.getElementById("root")!).render(
  publishableKey ? (
    <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
      {app}
    </ClerkProvider>
  ) : (
    app
  ),
);
