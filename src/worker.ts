import { types, webApi, type EnvelopedEvent } from "@slack/bolt";

const slackClient = new webApi.WebClient(process.env.SLACK_BOT_TOKEN);

// Worker function that processes the job
export async function processSlackWebhook(
  data: EnvelopedEvent<types.SlackEvent>
): Promise<void> {
  console.log("Worker is processing job with data:", data);

  try {
    // Extract event data from Slack webhook
    if (data.event.type === "app_mention") {
      const event = data.event;

      // Type guard to ensure we have the necessary properties
      const { channel, ts, thread_ts } = event;

      // Reply in the thread (or start a new thread if not already in one)
      await slackClient.chat.postMessage({
        channel,
        thread_ts: thread_ts || ts, // Use thread_ts if exists, otherwise use ts to start new thread
        text: "received messages",
      });

      console.log("Replied to Slack thread successfully");
    }
  } catch (error) {
    console.error("Error replying to Slack:", error);
    throw error;
  }

  console.log("Worker is done processing job");
}
