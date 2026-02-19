/**
 * Maps GitHub repository slugs to their Slack user group handles.
 * Used to ping the correct SDK maintainer group when deferring to maintainers.
 * A repo may map to multiple groups (e.g. sentry-java covers both Android and Java).
 */
const REPO_MAINTAINER_MAP: Record<string, string[]> = {
  'getsentry/sentry-java': ['@android-sdk-maintainers', '@java-sdk-maintainers'],
  'getsentry/sentry-cocoa': ['@apple-sdk-maintainers'],
  'getsentry/dart': ['@flutter-sdk-maintainers'],
  'getsentry/sentry-electron': ['@electron-sdk-maintainers'],
  'getsentry/sentry-elixir': ['@elixir-sdk-maintainers'],
  'getsentry/sentry-go': ['@go-sdk-maintainers'],
  'getsentry/godot': ['@godot-sdk-maintainers'],
  'getsentry/sentry-javascript': ['@javascript-sdk-maintainers'],
  'getsentry/sentry-kotlin-multiplatform': ['@kmp-sdk-maintainers'],
  'getsentry/sentry-native': ['@native-sdk-maintainers'],
  'getsentry/sentry-dotnet': ['@dotnet-sdk-maintainers'],
  'getsentry/sentry-php': ['@php-sdk-maintainers'],
  'getsentry/sentry-python': ['@python-sdk-maintainers'],
  'getsentry/sentry-react-native': ['@react-native-sdk-maintainers'],
  'getsentry/sentry-ruby': ['@ruby-sdk-maintainers'],
  'getsentry/sentry-rust': ['@rust-sdk-maintainers'],
  'getsentry/sentry-unity': ['@unity-sdk-maintainers'],
  'getsentry/sentry-unreal': ['@unreal-sdk-maintainers'],
};

/**
 * Returns a space-separated string of Slack user group handles for the given
 * repository slug, or null if there is no known maintainer group for that repo.
 *
 * @example getMaintainerMention('getsentry/sentry-java') // '@android-sdk-maintainers @java-sdk-maintainers'
 */
export function getMaintainerMention(repo: string): string | null {
  const groups = REPO_MAINTAINER_MAP[repo];
  if (!groups || groups.length === 0) return null;
  return groups.join(' ');
}
