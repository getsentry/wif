import type { webApi } from '@slack/bolt';
import * as Sentry from '@sentry/node';

/**
 * Fetches the full thread from Slack via conversations.replies and returns
 * formatted text suitable for analysis input. The thread root is either the
 * message that started the thread (ts) or the parent when the webhook was
 * triggered by a reply (thread_ts).
 *
 * On failure (e.g. missing `channels:history` scope), the error is reported
 * to Sentry and `fallbackText` (the triggering message) is returned so the
 * analysis can proceed with reduced context.
 */
export async function fetchThreadMessages(
  slackClient: Pick<webApi.WebClient, 'conversations' | 'users'>,
  channel: string,
  threadRootTs: string,
  fallbackText: string
): Promise<string> {
  let messages: Array<{ user?: string; text: string; ts: string }>;
  try {
    messages = await fetchReplies(slackClient, channel, threadRootTs);
  } catch (err) {
    Sentry.captureException(err);
    return fallbackText;
  }

  messages.sort((a, b) => a.ts.localeCompare(b.ts));

  const userIds = [...new Set(messages.map((m) => m.user).filter(Boolean))] as string[];
  const userNames = new Map<string, string>();

  for (const uid of userIds) {
    try {
      const userResult = await slackClient.users.info({ user: uid });
      if (userResult.ok && userResult.user) {
        const name =
          userResult.user.real_name ||
          userResult.user.profile?.real_name ||
          userResult.user.name ||
          uid;
        userNames.set(uid, name);
      }
    } catch {
      userNames.set(uid, uid);
    }
  }

  return messages
    .map((m) => {
      const label = m.user ? (userNames.get(m.user) ?? m.user) : 'Unknown';
      return `${label}: ${m.text}`;
    })
    .join('\n\n');
}

async function fetchReplies(
  slackClient: Pick<webApi.WebClient, 'conversations'>,
  channel: string,
  threadRootTs: string
): Promise<Array<{ user?: string; text: string; ts: string }>> {
  const messages: Array<{ user?: string; text: string; ts: string }> = [];
  let cursor: string | undefined;

  do {
    const result = await slackClient.conversations.replies({
      channel,
      ts: threadRootTs,
      limit: 200,
      ...(cursor && { cursor }),
    });

    if (!result.ok || !result.messages) {
      throw new Error('Failed to fetch thread messages');
    }

    for (const msg of result.messages) {
      if (
        'text' in msg &&
        typeof msg.text === 'string' &&
        msg.text.trim() &&
        'ts' in msg &&
        typeof msg.ts === 'string'
      ) {
        messages.push({
          user: 'user' in msg ? msg.user : undefined,
          text: msg.text.trim(),
          ts: msg.ts,
        });
      }
    }

    cursor = result.response_metadata?.next_cursor;
  } while (cursor);

  return messages;
}
