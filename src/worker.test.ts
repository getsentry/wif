import { describe, it, expect, vi, beforeEach } from "vitest";
import { processSlackWebhook } from "./worker.js";

describe("processSlackWebhook", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("resolves without error for non-app_mention events", async () => {
    const data = { event: { type: "message" } };
    await expect(processSlackWebhook(data as never)).resolves.toBeUndefined();
  });

  it("processes payload data", async () => {
    const data = { event: { type: "message", text: "hello" } };
    await processSlackWebhook(data as never);

    expect(console.log).toHaveBeenCalledWith(
      "Worker is processing job with data:",
      data,
    );
    expect(console.log).toHaveBeenCalledWith("Worker is done processing job");
  });

  it("completes for events with event payload", async () => {
    const data = { event: { type: "reaction_added" } };
    await expect(processSlackWebhook(data as never)).resolves.toBeUndefined();
  });
});
