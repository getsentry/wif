import { types, webApi, type EnvelopedEvent } from '@slack/bolt';
import { analyzeIssue } from './analysis/analyze.js';
import { GitHubService } from './analysis/github.js';

const defaultSlackClient = new webApi.WebClient(process.env.SLACK_BOT_TOKEN);
const defaultGithubClient = new GitHubService();

export interface ProcessSlackWebhookOptions {
  slackClient?: webApi.WebClient;
  githubClient?: Pick<GitHubService, 'listOrgPublicRepos'>;
}

interface ReactionFeedbackContext {
  slackClient: webApi.WebClient;
  channel: string;
  ts: string;
  threadTs: string | undefined;
}

async function withReactionFeedback<T>(
  ctx: ReactionFeedbackContext,
  work: () => Promise<T>
): Promise<T> {
  const { slackClient, channel, ts, threadTs } = ctx;

  await slackClient.reactions.add({ channel, timestamp: ts, name: 'eyes' });

  try {
    const result = await work();
    await slackClient.reactions.remove({ channel, timestamp: ts, name: 'eyes' });
    await slackClient.reactions.add({
      channel,
      timestamp: ts,
      name: 'white_check_mark',
    });
    return result;
  } catch (error) {
    await slackClient.reactions.remove({ channel, timestamp: ts, name: 'eyes' });
    await slackClient.reactions.add({ channel, timestamp: ts, name: 'x' });
    const errorSummary = (error instanceof Error ? error.message : String(error))
      .split('\n')[0]
      .trim();
    await slackClient.chat.postMessage({
      channel,
      thread_ts: threadTs ?? ts,
      markdown_text: `Something went wrong: ${errorSummary}`,
    });
    throw error;
  }
}

// Worker function that processes the job
export async function processSlackWebhook(
  data: EnvelopedEvent<types.SlackEvent>,
  options?: ProcessSlackWebhookOptions
): Promise<void> {
  const slackClient = options?.slackClient ?? defaultSlackClient;
  const githubClient = options?.githubClient ?? defaultGithubClient;

  console.log('Worker is processing job with data:', data);

  if (data.event.type === 'app_mention') {
    const event = data.event;
    const { channel, ts, thread_ts } = event;

    await withReactionFeedback({ slackClient, channel, ts, threadTs: thread_ts }, async () => {
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

      const responseText =
        `*Repository Analysis*\n\n` +
        `*Repository:* ${issueResult.owner}/${issueResult.repo}\n` +
        `*Confidence:* ${issueResult.confidence}\n` +
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
