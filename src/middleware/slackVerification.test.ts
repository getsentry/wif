import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../types.js";
import { createSlackVerificationMiddleware } from "./slackVerification.js";

vi.mock("@slack/bolt", () => ({
  verifySlackRequest: vi.fn(),
}));

const { verifySlackRequest } = await import("@slack/bolt");

describe("createSlackVerificationMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips verification for non-Slack webhook paths", () => {
    const verify = createSlackVerificationMiddleware("secret");
    const req = {
      originalUrl: "/api/health",
      headers: {},
    } as Request;

    expect(() => verify(req, null as unknown, Buffer.from("{}"))).not.toThrow();
    expect(verifySlackRequest).not.toHaveBeenCalled();
  });

  it("throws HttpError when signing secret is missing", () => {
    const verify = createSlackVerificationMiddleware(undefined);
    const req = {
      originalUrl: "/api/webhooks/slack",
      headers: {
        "x-slack-signature": "v0=abc",
        "x-slack-request-timestamp": "1234567890",
      },
    } as unknown as Request;

    expect(() => verify(req, null as unknown, Buffer.from("{}"))).toThrow(
      HttpError,
    );
    expect(() => verify(req, null as unknown, Buffer.from("{}"))).toThrow(
      "Missing Slack verification data",
    );
    expect(verifySlackRequest).not.toHaveBeenCalled();
  });

  it("throws HttpError when signature header is missing", () => {
    const verify = createSlackVerificationMiddleware("secret");
    const req = {
      originalUrl: "/api/webhooks/slack",
      headers: {
        "x-slack-request-timestamp": "1234567890",
      },
    } as unknown as Request;

    expect(() => verify(req, null as unknown, Buffer.from("{}"))).toThrow(
      HttpError,
    );
    expect(() => verify(req, null as unknown, Buffer.from("{}"))).toThrow(
      "Missing Slack verification data",
    );
  });

  it("throws HttpError when timestamp header is missing", () => {
    const verify = createSlackVerificationMiddleware("secret");
    const req = {
      originalUrl: "/api/webhooks/slack",
      headers: {
        "x-slack-signature": "v0=abc",
      },
    } as unknown as Request;

    expect(() => verify(req, null as unknown, Buffer.from("{}"))).toThrow(
      HttpError,
    );
    expect(() => verify(req, null as unknown, Buffer.from("{}"))).toThrow(
      "Missing Slack verification data",
    );
  });

  it("throws HttpError when timestamp is invalid", () => {
    const verify = createSlackVerificationMiddleware("secret");
    const req = {
      originalUrl: "/api/webhooks/slack",
      headers: {
        "x-slack-signature": "v0=abc",
        "x-slack-request-timestamp": "not-a-number",
      },
    } as unknown as Request;

    expect(() => verify(req, null as unknown, Buffer.from("{}"))).toThrow(
      HttpError,
    );
    expect(() => verify(req, null as unknown, Buffer.from("{}"))).toThrow(
      "Invalid Slack request timestamp",
    );
  });

  it("throws HttpError when verifySlackRequest fails", () => {
    vi.mocked(verifySlackRequest).mockImplementation(() => {
      throw new Error("Invalid signature");
    });
    const verify = createSlackVerificationMiddleware("secret");
    const req = {
      originalUrl: "/api/webhooks/slack",
      headers: {
        "x-slack-signature": "v0=invalid",
        "x-slack-request-timestamp": "1234567890",
      },
    } as unknown as Request;

    expect(() => verify(req, null as unknown, Buffer.from("{}"))).toThrow(
      HttpError,
    );
    expect(() => verify(req, null as unknown, Buffer.from("{}"))).toThrow(
      "Slack signature verification failed",
    );
  });

  it("calls verifySlackRequest with correct args when verification succeeds", () => {
    vi.mocked(verifySlackRequest).mockReturnValue(undefined);
    const verify = createSlackVerificationMiddleware("my-secret");
    const body = '{"type":"event_callback"}';
    const req = {
      originalUrl: "/api/webhooks/slack",
      headers: {
        "x-slack-signature": "v0=abc123",
        "x-slack-request-timestamp": "1234567890",
      },
    } as unknown as Request;

    verify(req, null as unknown, Buffer.from(body, "utf8"));

    expect(verifySlackRequest).toHaveBeenCalledWith({
      signingSecret: "my-secret",
      body,
      headers: {
        "x-slack-signature": "v0=abc123",
        "x-slack-request-timestamp": 1234567890,
      },
    });
  });

  it("handles array-valued headers (Express may pass arrays)", () => {
    vi.mocked(verifySlackRequest).mockReturnValue(undefined);
    const verify = createSlackVerificationMiddleware("secret");
    const req = {
      originalUrl: "/api/webhooks/slack",
      headers: {
        "x-slack-signature": ["v0=abc"],
        "x-slack-request-timestamp": ["1234567890"],
      },
    } as unknown as Request;

    expect(() => verify(req, null as unknown, Buffer.from("{}"))).not.toThrow();
    expect(verifySlackRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          "x-slack-signature": "v0=abc",
          "x-slack-request-timestamp": 1234567890,
        },
      }),
    );
  });
});
