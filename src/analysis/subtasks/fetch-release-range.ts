import { parse as semverParse } from 'semver';
import type { GitHubRelease } from '../github.js';
import type { AnalysisTools } from '../tools/types.js';

export interface FetchReleaseRangeResult {
  kind: 'releases';
  releases: GitHubRelease[];
}

export interface TooOldResult {
  kind: 'too_old';
  message: string;
}

export interface AlreadyLatestResult {
  kind: 'already_latest';
  message: string;
}

export interface InvalidVersionResult {
  kind: 'invalid_version';
  message: string;
}

export interface FetchFailedResult {
  kind: 'fetch_failed';
  message: string;
}

export type FetchReleaseRangeOutput =
  | FetchReleaseRangeResult
  | TooOldResult
  | AlreadyLatestResult
  | InvalidVersionResult
  | FetchFailedResult;

const MAX_RELEASES = 100;

function describeKnownVersionRange(allReleases: GitHubRelease[]): string | null {
  const stableVersions = allReleases
    .map((r) => semverParse(r.tag))
    .filter((v) => v && !v.prerelease?.length);

  if (stableVersions.length === 0) return null;

  const sorted = stableVersions.sort((a, b) => a!.compare(b!));
  const oldest = sorted[0]!.version;
  const latest = sorted[sorted.length - 1]!.version;
  return `Known stable versions range from \`${oldest}\` to \`${latest}\`.`;
}

export function createFetchReleaseRangeSubtask(
  tools: Pick<AnalysisTools, 'getReleasesFromVersion' | 'findAllReleases'>
) {
  return async function fetchReleaseRange(
    repo: string,
    fromVersion: string
  ): Promise<FetchReleaseRangeOutput> {
    try {
      const releases = await tools.getReleasesFromVersion(repo, fromVersion);

      if (releases.length === 0) {
        const allReleases = await tools.findAllReleases(repo);
        const rangeInfo = describeKnownVersionRange(allReleases);
        const message = rangeInfo
          ? `No releases found after the reported version. ${rangeInfo}`
          : 'No releases found after the reported version. You may already be on the latest stable release.';
        return { kind: 'already_latest', message };
      }

      if (releases.length > MAX_RELEASES) {
        return {
          kind: 'too_old',
          message:
            'The reported version is too old — there are more than 100 releases since then. Unable to look this up efficiently.',
        };
      }

      return { kind: 'releases', releases };
    } catch (error) {
      console.error('Failed to fetch release range:', error);
      const isInvalidVersion = error instanceof Error && error.message.includes('Invalid version');
      if (isInvalidVersion) {
        return {
          kind: 'invalid_version',
          message: 'Could not find the reported version. Please verify the version is correct.',
        };
      }
      return {
        kind: 'fetch_failed',
        message: 'Unable to fetch releases. Deferring to SDK maintainers for investigation.',
      };
    }
  };
}
