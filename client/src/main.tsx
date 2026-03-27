import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import App from "./App";
import "./index.css";

const pk = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const app = <App />;

createRoot(document.getElementById("root")!).render(
  pk ? (
    <ClerkProvider publishableKey={pk} afterSignOutUrl="/">
      {app}
    </ClerkProvider>
  ) : (
    app
  ),
);
