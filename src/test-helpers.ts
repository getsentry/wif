import crypto from 'crypto';

/**
 * Generates a valid Slack request signature for integration tests.
 * Format: v0:{timestamp}:{body} -> HMAC-SHA256 -> v0={hex}
 */
export function signSlackRequest(
  signingSecret: string,
  body: string,
  timestamp: string = Math.floor(Date.now() / 1000).toString()
): string {
  const sigBasestring = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', signingSecret);
  hmac.update(sigBasestring);
  const digest = hmac.digest('hex');
  return `v0=${digest}`;
}
