import "dotenv/config";
import * as Sentry from "@sentry/node";
import express, { Request, Response } from "express";
import PQueue from "p-queue";
import { processSlackWebhook } from "./worker";

const app = express();

const PORT = process.env.PORT || 3000;

// Create a queue instance
const queue = new PQueue({ concurrency: 1 });

// Middleware to parse JSON bodies
app.use(express.json());

// Slack webhook endpoint
app.post("/api/webhooks/slack", (req: Request, res: Response) => {
  // Enqueue the job
  console.log("Enqueuing job with data:", req.body);
  queue.add(() => processSlackWebhook(req.body));

  // Respond immediately
  res.status(200).send("OK");
});

// Health check endpoint
app.get("/api/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

Sentry.setupExpressErrorHandler(app);

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
