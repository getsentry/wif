import type { webApi } from '@slack/bolt';
import { buildErrorBlocks } from '../analysis/blocks/index.js';

export interface ReactionFeedbackContext {
  slackClient: Pick<webApi.WebClient, 'reactions' | 'chat'>;
  channel: string;
  ts: string;
  threadTs: string | undefined;
}

export async function withReactionFeedback<T>(
  ctx: ReactionFeedbackContext,
  work: () => Promise<T>
): Promise<T> {
  const { slackClient, channel, ts, threadTs } = ctx;

  await slackClient.reactions.remove({ channel, timestamp: ts, name: 'hourglass' }).catch(() => {});
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
      blocks: buildErrorBlocks(errorSummary),
      text: `Something went wrong: ${errorSummary}`,
    } as Parameters<webApi.WebClient['chat']['postMessage']>[0]);
    throw error;
  }
}
