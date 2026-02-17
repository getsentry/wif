import { verifySlackRequest } from "@slack/bolt";
import type { Request } from "express";
import { HttpError } from "../types.js";

const SLACK_WEBHOOK_PATH = "/api/webhooks/slack";

/**
 * Returns express.json verify callback that validates Slack request signatures
 * using @slack/bolt's verifySlackRequest. Only runs for the Slack webhook path.
 */
export function createSlackVerificationMiddleware(signingSecret: string | undefined) {
  return function verify(req: Request, _res: unknown, buf: Buffer): void {
    if (!req.originalUrl?.startsWith(SLACK_WEBHOOK_PATH)) {
      return;
    }

    if (!signingSecret) {
      throw new HttpError(401, "Missing Slack verification data");
    }

    const signature = req.headers["x-slack-signature"];
    const timestamp = req.headers["x-slack-request-timestamp"];
    const sig = typeof signature === "string" ? signature : signature?.[0];
    const tsHeader = typeof timestamp === "string" ? timestamp : timestamp?.[0];

    if (!sig || !tsHeader) {
      throw new HttpError(401, "Missing Slack verification data");
    }

    const timestampNum = parseInt(tsHeader, 10);
    if (isNaN(timestampNum)) {
      throw new HttpError(401, "Invalid Slack request timestamp");
    }

    try {
      verifySlackRequest({
        signingSecret,
        body: buf.toString("utf8"),
        headers: {
          "x-slack-signature": sig,
          "x-slack-request-timestamp": timestampNum,
        },
      });
    } catch {
      throw new HttpError(401, "Slack signature verification failed");
    }
  };
}
