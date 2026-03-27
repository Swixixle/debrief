/**
 * Centralized configuration module for PTA server.
 * 
 * Handles:
 * - Port binding configuration
 * - Environment variable loading and validation
 * - Production config enforcement
 */

export interface BindConfig {
  host: string;
  port: number;
}

export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  isDevelopment: boolean;
  
  // Server binding
  host: string;
  port: number;
  
  // Database
  databaseUrl: string | undefined;
  
  // Security
  apiKey: string | undefined;
  adminKey: string | undefined;
  forceHttp: boolean;
  
  // CI/CD
  githubToken: string | undefined;
  githubWebhookSecret: string | undefined;
  ciWorkerEnabled: boolean;
  ciTmpDir: string | undefined;
  ciPreserveWorkdir: boolean;
  analyzerTimeoutMs: number;
  
  // AI Integration
  aiEnabled: boolean;
  aiOpenaiApiKey: string | undefined;
  aiOpenaiBaseUrl: string | undefined;
}

/**
 * Get deterministic bind configuration.
 * 
 * Rules:
 * - Port from PORT env var, default 5000
 * - In production: invalid PORT causes fail-fast
 * - In development: invalid PORT warns and falls back to 5000
 * - Host from HOST env var, default "0.0.0.0"
 */
export function getBindConfig(): BindConfig {
  const portStr = process.env.PORT || "5000";
  const port = parseInt(portStr, 10);
  const host = process.env.HOST || "0.0.0.0";
  const isProduction = process.env.NODE_ENV === "production";
  
  // Validate port
  if (isNaN(port) || port < 1 || port > 65535) {
    if (isProduction) {
      throw new Error(
        `Invalid PORT environment variable: "${portStr}". ` +
        `Must be a number between 1 and 65535.`
      );
    } else {
      console.warn(
        `[WARNING] Invalid PORT "${portStr}", falling back to 5000 in development mode`
      );
      return { host, port: 5000 };
    }
  }
  
  return { host, port };
}

/**
 * Load and validate complete application configuration.
 * 
 * In production:
 * - .env files are IGNORED (only process.env is used)
 * - Missing required vars cause fail-fast
 * 
 * In development:
 * - .env files are loaded (via dotenv, if configured)
 * - Missing vars produce warnings but don't fail
 */
export function getConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";
  const isDevelopment = nodeEnv === "development";
  
  // Load .env only in non-production
  if (!isProduction && isDevelopment) {
    // Note: dotenv should be loaded at app entry point, not here
    // This is just documentation of the policy
  }
  
  const { host, port } = getBindConfig();
  
  // CI/CD config
  const ciWorkerEnabled = process.env.CI_WORKER_ENABLED === "true";
  const githubWebhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  
  // AI Integration
  const aiOpenaiApiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const aiOpenaiBaseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const aiEnabled = !!(aiOpenaiApiKey && aiOpenaiBaseUrl);
  
  const config: AppConfig = {
    nodeEnv,
    isProduction,
    isDevelopment,
    
    host,
    port,
    
    databaseUrl: process.env.DATABASE_URL,
    
    apiKey: process.env.API_KEY,
    adminKey: process.env.ADMIN_KEY || process.env.API_KEY, // Fallback for now
    forceHttp: process.env.FORCE_HTTP === "true",
    
    githubToken: process.env.GITHUB_TOKEN,
    githubWebhookSecret,
    ciWorkerEnabled,
    ciTmpDir: process.env.CI_TMP_DIR,
    ciPreserveWorkdir: process.env.CI_PRESERVE_WORKDIR === "true",
    analyzerTimeoutMs: parseInt(process.env.ANALYZER_TIMEOUT_MS || "600000", 10),
    
    aiEnabled,
    aiOpenaiApiKey,
    aiOpenaiBaseUrl,
  };
  
  // Validate production requirements
  if (isProduction) {
    const errors: string[] = [];
    
    if (!config.databaseUrl) {
      errors.push("DATABASE_URL is required in production");
    }
    
    if (!config.adminKey) {
      errors.push("ADMIN_KEY (or API_KEY) is required in production");
    } else if (config.adminKey.length < 32) {
      errors.push(
        `ADMIN_KEY must be at least 32 characters (current: ${config.adminKey.length})`
      );
    }
    
    if (ciWorkerEnabled || githubWebhookSecret) {
      if (!githubWebhookSecret) {
        errors.push(
          "GITHUB_WEBHOOK_SECRET is required when CI features are enabled in production"
        );
      }
    }
    
    if (errors.length > 0) {
      console.error("\n❌ Production configuration validation failed:\n");
      errors.forEach((error) => console.error(`  - ${error}`));
      console.error("\nSee docs/CONFIGURATION.md for configuration guide.\n");
      process.exit(1);
    }
  }
  
  return config;
}

/**
 * Get boot report for startup logging.
 * Returns a structured JSON object with key system information.
 */
export function getBootReport(config: AppConfig): Record<string, any> {
  const startTime = new Date().toISOString();
  
  // Read version from APP_VERSION env or package.json
  let appVersion = "unknown";
  try {
    // Prefer APP_VERSION if set (allows override in deployment)
    if (process.env.APP_VERSION) {
      appVersion = process.env.APP_VERSION;
    } else {
      const pkg = require("../package.json");
      appVersion = pkg.version || "unknown";
    }
  } catch {
    // Fallback if package.json not found
  }
  
  // Ensure version has pta- prefix for consistency with Python analyzer
  const toolVersion = appVersion.startsWith("pta-") ? appVersion : `pta-${appVersion}`;
  
  return {
    timestamp: startTime,
    tool_version: toolVersion,
    node_env: config.nodeEnv,
    bind_host: config.host,
    bind_port: config.port,
    db_configured: !!config.databaseUrl,
    ci_enabled: config.ciWorkerEnabled || !!config.githubWebhookSecret,
    semantic_enabled: config.aiEnabled,
    force_http: config.forceHttp,
    open_web: process.env.DEBRIEF_OPEN_WEB === "1",
  };
}
