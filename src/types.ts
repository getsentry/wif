import { types, type EnvelopedEvent } from "@slack/bolt";

/** User/client error - return 4xx, do not report to Sentry */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Slack Events API url_verification payload */
export interface SlackUrlVerification {
  type: "url_verification";
  challenge: string;
  token?: string;
}

/** Slack webhook request body (union of url_verification and event callback) */
export type SlackWebhookBody =
  | SlackUrlVerification
  | EnvelopedEvent<types.SlackEvent>;
