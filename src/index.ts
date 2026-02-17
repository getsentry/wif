import "dotenv/config";
import * as Sentry from "@sentry/node";
import express, { Request, Response } from "express";

const app = express();

const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// Slack webhook endpoint
app.post("/api/webhooks/slack", (req: Request, res: Response) => {
  // TODO: Handle Slack webhook logic here
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
