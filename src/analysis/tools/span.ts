import * as Sentry from '@sentry/node';

const MAX_ATTR_LENGTH = 10_000;

function safeStringify(value: unknown): string {
  try {
    const str = JSON.stringify(value);
    return str.length > MAX_ATTR_LENGTH ? str.slice(0, MAX_ATTR_LENGTH) + '...' : str;
  } catch {
    return String(value);
  }
}

const AGENT_NAME = 'wif';

function buildSpanOptions(toolName: string, args: Record<string, unknown>) {
  return {
    op: 'gen_ai.execute_tool',
    name: `execute_tool ${toolName}`,
    attributes: {
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.tool.name': toolName,
      'gen_ai.agent.name': AGENT_NAME,
      'gen_ai.tool.call.arguments': safeStringify(args),
    },
  };
}

export async function withToolSpan<T>(
  toolName: string,
  args: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  return Sentry.startSpan(buildSpanOptions(toolName, args), async (span) => {
    const result = await fn();
    span.setAttribute('gen_ai.tool.call.result', safeStringify(result));
    return result;
  });
}

export function withSyncToolSpan<T>(
  toolName: string,
  args: Record<string, unknown>,
  fn: () => T
): T {
  return Sentry.startSpan(buildSpanOptions(toolName, args), (span) => {
    const result = fn();
    span.setAttribute('gen_ai.tool.call.result', safeStringify(result));
    return result;
  });
}
