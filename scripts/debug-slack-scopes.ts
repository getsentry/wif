import 'dotenv/config';
import { webApi } from '@slack/bolt';

const token = process.env.SLACK_BOT_TOKEN;
if (!token) {
  console.error('SLACK_BOT_TOKEN not set in .env');
  process.exit(1);
}

const client = new webApi.WebClient(token);

const CHANNEL = 'C0AFCTRGQ3G';
const THREAD_TS = '1771492113.572259';
const MESSAGE_TS = '1771493193.636779';

interface TestResult {
  name: string;
  scope: string;
  ok: boolean;
  error?: string;
}

async function testApi(
  name: string,
  scope: string,
  fn: () => Promise<unknown>
): Promise<TestResult> {
  try {
    await fn();
    return { name, scope, ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name, scope, ok: false, error: msg };
  }
}

async function main() {
  console.log('Testing Slack bot token scopes...\n');
  console.log(`Token prefix: ${token!.slice(0, 10)}...`);

  const authTest = await client.auth.test();
  console.log(`Bot user: ${authTest.user} (${authTest.user_id})`);
  console.log(`Team: ${authTest.team} (${authTest.team_id})\n`);

  const results: TestResult[] = [];

  results.push(
    await testApi('conversations.replies', 'channels:history', () =>
      client.conversations.replies({ channel: CHANNEL, ts: THREAD_TS, limit: 1 })
    )
  );

  results.push(
    await testApi('users.info', 'users:read', () => client.users.info({ user: authTest.user_id! }))
  );

  results.push(
    await testApi('reactions.add', 'reactions:write', () =>
      client.reactions.add({ channel: CHANNEL, timestamp: MESSAGE_TS, name: 'robot_face' })
    )
  );

  results.push(
    await testApi('chat.postMessage (dry)', 'chat:write', () =>
      client.chat.postMessage({
        channel: CHANNEL,
        thread_ts: THREAD_TS,
        text: '[debug] scope test — please ignore',
      })
    )
  );

  console.log('Results:\n');
  console.log('API Method              Required Scope       Status');
  console.log('─'.repeat(65));
  for (const r of results) {
    const status = r.ok ? '✓ OK' : `✗ FAILED: ${r.error}`;
    console.log(`${r.name.padEnd(24)}${r.scope.padEnd(21)}${status}`);
  }

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    console.log(`\n${failures.length} scope(s) missing or failing.`);
    console.log(
      'Fix: Go to https://api.slack.com/apps → OAuth & Permissions → add missing scopes → reinstall app.'
    );
  } else {
    console.log('\nAll scopes OK!');
  }

  // Clean up the test reaction
  try {
    await client.reactions.remove({ channel: CHANNEL, timestamp: MESSAGE_TS, name: 'robot_face' });
  } catch {
    // ignore cleanup failure
  }
}

main().catch(console.error);
