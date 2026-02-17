import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { signSlackRequest } from "./test-helpers.js";

vi.mock("./worker.js", () => ({
  processSlackWebhook: vi.fn().mockResolvedValue(undefined),
}));

describe("app integration", () => {
  const SIGNING_SECRET = "test-signing-secret";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
  });

  describe("GET /api/health", () => {
    it("returns 200 with status ok", async () => {
      const app = createApp();
      const res = await request(app).get("/api/health");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok" });
    });
  });

  describe("POST /api/webhooks/slack", () => {
    it("returns 401 when Slack signature is missing", async () => {
      const app = createApp();
      const body = { type: "url_verification", challenge: "challenge123" };

      const res = await request(app)
        .post("/api/webhooks/slack")
        .send(body)
        .set("Content-Type", "application/json");

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("error");
    });

    it("returns 401 when Slack signature is invalid", async () => {
      const app = createApp();
      const body = { type: "url_verification", challenge: "challenge123" };

      const res = await request(app)
        .post("/api/webhooks/slack")
        .send(body)
        .set("Content-Type", "application/json")
        .set("x-slack-signature", "v0=invalid")
        .set("x-slack-request-timestamp", String(Math.floor(Date.now() / 1000)));

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("verification");
    });

    it("returns challenge for url_verification with valid signature", async () => {
      const app = createApp();
      const body = { type: "url_verification", challenge: "challenge123" };
      const bodyStr = JSON.stringify(body);
      const signature = signSlackRequest(SIGNING_SECRET, bodyStr);
      const timestamp = Math.floor(Date.now() / 1000).toString();

      const res = await request(app)
        .post("/api/webhooks/slack")
        .send(bodyStr)
        .set("Content-Type", "application/json")
        .set("x-slack-signature", signature)
        .set("x-slack-request-timestamp", timestamp);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ challenge: "challenge123" });
    });

    it("returns OK and queues event for non-url_verification with valid signature", async () => {
      const app = createApp();
      const body = {
        type: "event_callback",
        event: { type: "message", text: "hello" },
      };
      const bodyStr = JSON.stringify(body);
      const signature = signSlackRequest(SIGNING_SECRET, bodyStr);
      const timestamp = Math.floor(Date.now() / 1000).toString();

      const res = await request(app)
        .post("/api/webhooks/slack")
        .send(bodyStr)
        .set("Content-Type", "application/json")
        .set("x-slack-signature", signature)
        .set("x-slack-request-timestamp", timestamp);

      expect(res.status).toBe(200);
      expect(res.text).toBe("OK");
    });
  });
});
