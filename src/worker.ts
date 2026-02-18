import { types, webApi, type EnvelopedEvent } from '@slack/bolt';
import { analyzeIssue } from './analysis/analyze.js';
import { createAnalysisTools } from './analysis/tools/index.js';
import { createAnalysisSubtasks } from './analysis/subtasks/index.js';
import { GitHubService } from './analysis/github.js';
import { withReactionFeedback } from './slack/index.js';
import * as Sentry from '@sentry/node';

const defaultSlackClient = new webApi.WebClient(process.env.SLACK_BOT_TOKEN);
const defaultGitHubService = new GitHubService();

export interface ProcessSlackWebhookOptions {
  slackClient?: webApi.WebClient;
}

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
      Sentry.setConversationId(ts ?? thread_ts);

      const tools = createAnalysisTools(
        { slackClient, channel, threadTs: thread_ts ?? ts },
        defaultGitHubService
      );
      const subtasks = createAnalysisSubtasks(tools);

      await analyzeIssue(event.text, tools, subtasks);

      console.log('Replied to Slack thread successfully');
    });
  }

  console.log('Worker is done processing job');
}
