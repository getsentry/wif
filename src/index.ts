import * as Sentry from "@sentry/node";
import "dotenv/config";
import express, { Request, Response } from "express";
import PQueue from "p-queue";
import {
  createSlackVerificationMiddleware,
  httpErrorHandler,
} from "./middleware/index.js";
import type { SlackWebhookBody } from "./types.js";
import { processSlackWebhook } from "./worker.js";

const app = express();

const PORT = process.env.PORT || 3000;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

const queue = new PQueue({ concurrency: 1 });

app.use(
  express.json({
    verify: createSlackVerificationMiddleware(SLACK_SIGNING_SECRET),
  }),
);

app.use(httpErrorHandler);

app.post("/api/webhooks/slack", (req: Request, res: Response) => {
  const body = req.body as SlackWebhookBody;

  if (body.type === "url_verification") {
    return res.status(200).json({ challenge: body.challenge });
  }

  // At this point, we know it's an EnvelopedEvent
  queue
    .add(() => processSlackWebhook(body))
    .catch((reason) => {
      console.error("Error processing job:", reason);
      Sentry.captureException(reason);
    });

  res.status(200).send("OK");
});

app.get("/api/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

Sentry.setupExpressErrorHandler(app);

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
