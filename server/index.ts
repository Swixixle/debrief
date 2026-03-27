import express, { type Request, type Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { getConfig, getBootReport } from "./config";
import { initWebSocketServer } from "./ws";
import { handleStripeWebhook } from "./billing/webhook";
import { apiKeyAuth } from "./middleware/apiKeyAuth";
import { upsertUserMiddleware } from "./middleware/upsertUser";
import { withClerk } from "./middleware/clerk";

// Load and validate configuration
const config = getConfig();

// Configuration is now validated in getConfig() - no legacy validator needed

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  (req: Request, res: Response) => {
    void handleStripeWebhook(req, res);
  },
);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.use(apiKeyAuth);
app.use(withClerk);
app.use(upsertUserMiddleware);

// CORS Configuration - secure cross-origin requests
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
  
  // In production, only allow explicitly listed origins
  if (process.env.NODE_ENV === "production") {
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
  } else {
    // In development, allow localhost origins
    if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
  }
  
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Key, X-Api-Key, X-Hub-Signature-256, X-GitHub-Delivery, X-GitHub-Event");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Max-Age", "86400"); // 24 hours
  
  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  
  next();
});

// Security Headers Middleware
app.use((req, res, next) => {
  const isProduction = process.env.NODE_ENV === "production";
  
  // Strict-Transport-Security (HSTS) - only in production
  if (isProduction && process.env.FORCE_HTTP !== "true") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }

  // X-Frame-Options - prevent clickjacking
  res.setHeader("X-Frame-Options", "SAMEORIGIN");

  // X-Content-Type-Options - prevent MIME sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");

  // X-XSS-Protection - legacy XSS protection
  res.setHeader("X-XSS-Protection", "1; mode=block");

  // Referrer-Policy - control referrer information
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // Content-Security-Policy (CSP)
  // Note: This is a balanced policy that allows the app to function while providing security
  const clerkAndPaymentsConnect =
    "https://*.clerk.com https://*.clerk.accounts.dev https://api.clerk.com https://api.stripe.com https://m.stripe.network https://js.stripe.com";
  const clerkImages = "https://img.clerk.com";

  const cspDirectives = [
    "default-src 'self'",
    `img-src 'self' data: https: ${clerkImages}`,
    "font-src 'self' data:",
    `connect-src 'self' https://api.github.com https://github.com ${clerkAndPaymentsConnect}`,
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  // In development, be more permissive for hot reload and Vite
  if (!isProduction) {
    cspDirectives.push(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.clerk.com", // Vite + Clerk
      "style-src 'self' 'unsafe-inline'",
      `connect-src 'self' ws: wss: https://api.github.com https://github.com ${clerkAndPaymentsConnect}`,
    );
  } else {
    // Production: More restrictive CSP
    cspDirectives.push(
      `script-src 'self' https://*.clerk.com`, // Clerk components
      "style-src 'self' 'unsafe-inline'", // unsafe-inline needed for styled components
      `connect-src 'self' wss: https://api.github.com https://github.com ${clerkAndPaymentsConnect}`,
    );
  }

  res.setHeader("Content-Security-Policy", cspDirectives.join("; "));

  // Permissions-Policy - control browser features
  res.setHeader(
    "Permissions-Policy",
    isProduction
      ? "geolocation=(), microphone=(), camera=()"
      : "geolocation=(), microphone=(self), camera=()"
  );

  next();
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);
  initWebSocketServer(httpServer);

  if (process.env.DEBRIEF_RUN_ANALYZER_WORKER === "1") {
    const { createAnalyzerWorker } = await import("./queue/analyzer-worker");
    const w = createAnalyzerWorker();
    if (w) log("BullMQ analyzer worker started", "analyzer-worker");
  }

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    
    // In production, don't leak error details to clients
    let message: string;
    if (process.env.NODE_ENV === "production") {
      // Generic error messages in production
      if (status >= 500) {
        message = "Internal Server Error";
      } else {
        message = err.message || "Bad Request";
      }
    } else {
      // Detailed errors in development
      message = err.message || "Internal Server Error";
    }

    // Always log the full error server-side
    console.error("Internal Server Error:", {
      status,
      message: err.message,
      stack: err.stack,
      path: _req.path,
    });

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // Single deterministic bind with boot report
  const { host, port } = config;
  httpServer.listen({ host, port, reusePort: true }, () => {
    log(`serving on ${host}:${port}`);
    log(JSON.stringify(getBootReport(config)));
  });
})();
