import { withSyncToolSpan } from './span.js';

/**
 * Maps SDK identifiers to GitHub owner/repo slugs.
 * Used by lookup_sdk_repository tool.
 */
const SDK_REPOSITORY_MAP: Record<string, string> = {
  'sentry-cocoa': 'getsentry/sentry-cocoa',
  ios: 'getsentry/sentry-cocoa',
  'sentry-java': 'getsentry/sentry-java',
  android: 'getsentry/sentry-java',
  'sentry-python': 'getsentry/sentry-python',
  'sentry-javascript': 'getsentry/sentry-javascript',
  'sentry-dotnet': 'getsentry/sentry-dotnet',
  'sentry-ruby': 'getsentry/sentry-ruby',
  'sentry-php': 'getsentry/sentry-php',
  'sentry-go': 'getsentry/sentry-go',
  'sentry-rust': 'getsentry/sentry-rust',
  'sentry-react-native': 'getsentry/sentry-react-native',
  'sentry-capacitor': 'getsentry/sentry-capacitor',
  'sentry-electron': 'getsentry/sentry-electron',
  'sentry-lynx': 'getsentry/sentry-lynx',
  'sentry-elixir': 'getsentry/sentry-elixir',
};

export function lookupSdkRepository(sdk: string): string | null {
  return withSyncToolSpan('lookupSdkRepository', { sdk }, () => {
    const normalized = sdk.toLowerCase().trim();
    return SDK_REPOSITORY_MAP[normalized] ?? null;
  });
}
