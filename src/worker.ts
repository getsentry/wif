import { types, webApi, type EnvelopedEvent } from '@slack/bolt';
import { analyzeIssue } from './analysis/analyze.js';
import { withReactionFeedback } from './slack/index.js';

const defaultSlackClient = new webApi.WebClient(process.env.SLACK_BOT_TOKEN);

export interface ProcessSlackWebhookOptions {
  slackClient?: webApi.WebClient;
}

// Worker function that processes the job
export async function processSlackWebhook(
  data: EnvelopedEvent<types.SlackEvent>,
  options?: ProcessSlackWebhookOptions
): Promise<void> {
  const slackClient = options?.slackClient ?? defaultSlackClient;

  console.log('Worker is processing job with data:', data);

  if (data.event.type === 'app_mention') {
    const event = data.event;
    const { channel, ts, thread_ts } = event;

    await withReactionFeedback({ slackClient, channel, ts, threadTs: thread_ts }, async () => {
      const issueResult = await analyzeIssue(event.text);

      const responseText =
        `*Repository Analysis*\n\n` +
        `*Repository:* ${issueResult.owner}/${issueResult.repo}\n` +
        `*Confidence:* ${issueResult.confidence}\n` +
        (issueResult.sdkVersion ? `*SDK Version:* ${issueResult.sdkVersion}\n` : '') +
        `*Reasoning:* ${issueResult.reasoning}`;

      await slackClient.chat.postMessage({
        channel,
        thread_ts: thread_ts ?? ts,
        text: responseText,
      });

      console.log('Replied to Slack thread successfully');
    });
  }

  console.log('Worker is done processing job');
}
