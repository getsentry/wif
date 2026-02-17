import { GitHubService } from './analysis/github.js';
import { types, webApi, type EnvelopedEvent } from '@slack/bolt';
import { analyzeIssue } from './analysis/analyze.js';

const defaultSlackClient = new webApi.WebClient(process.env.SLACK_BOT_TOKEN);
const defaultGithubClient = new GitHubService();

export interface ProcessSlackWebhookOptions {
  slackClient?: webApi.WebClient;
  githubClient?: Pick<GitHubService, 'listOrgPublicRepos'>;
}

// Worker function that processes the job
export async function processSlackWebhook(
  data: EnvelopedEvent<types.SlackEvent>,
  options?: ProcessSlackWebhookOptions
): Promise<void> {
  const slackClient = options?.slackClient ?? defaultSlackClient;
  const githubClient = options?.githubClient ?? defaultGithubClient;

  console.log('Worker is processing job with data:', data);

  try {
    // Extract event data from Slack webhook
    if (data.event.type === 'app_mention') {
      const event = data.event;

      // Type guard to ensure we have the necessary properties
      const { channel, ts, thread_ts } = event;

      const repos = await githubClient.listOrgPublicRepos('getsentry');
      const repoList = repos
        .map((r) => `- [${r.fullName}](${r.htmlUrl})`)
        .slice(0, 10)
        .join('\n');

      await slackClient.chat.postMessage({
        channel,
        thread_ts: thread_ts ?? ts,
        markdown_text: `**Public repositories in getsentry** (${repos.length}):\n\n${repoList}`,
      });

      const issueResult = await analyzeIssue(event.text);

      // Format the result for Slack
      const responseText =
        `*Repository Analysis*\n\n` +
        `*Repository:* ${issueResult.owner}/${issueResult.repo}\n` +
        `*Confidence:* ${issueResult.confidence}\n` +
        `*Reasoning:* ${issueResult.reasoning}`;

      // Reply in the thread (or start a new thread if not already in one)
      await slackClient.chat.postMessage({
        channel,
        thread_ts: thread_ts || ts, // Use thread_ts if exists, otherwise use ts to start new thread
        text: responseText,
      });

      console.log('Replied to Slack thread successfully');
    }
  } catch (error) {
    console.error('Error replying to Slack:', error);
    throw error;
  }

  console.log('Worker is done processing job');
}
