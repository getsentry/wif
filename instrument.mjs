// Initialize Sentry - must be done before any other app code
import * as Sentry from "@sentry/node";

Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    // Performance Monitoring
    tracesSampleRate: 1.0,
    // Profiling
    profilesSampleRate: 1.0,
    enableLogs: true,
    integrations: [Sentry.consoleLoggingIntegration()]
});
  