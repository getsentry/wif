import { parse as semverParse } from 'semver';
import type { GitHubRelease, GitHubService } from '../github.js';
import { withToolSpan } from './span.js';

export function createGitHubTools(githubService: GitHubService) {
  return {
    async getReleasesFromVersion(repo: string, fromVersion: string): Promise<GitHubRelease[]> {
      return withToolSpan('getReleasesFromVersion', { repo, fromVersion }, async () => {
        const all = await githubService.findAllReleases(repo);
        const fromParsed = semverParse(fromVersion) ?? semverParse(fromVersion.replace(/^v/, ''));
        if (!fromParsed) {
          throw new Error(`Invalid version: "${fromVersion}" could not be parsed`);
        }
        const filtered = all.filter((r) => {
          const tagParsed = semverParse(r.tag);
          if (!tagParsed) return false;
          if (tagParsed.prerelease?.length) return false;
          return tagParsed.compare(fromParsed) > 0;
        });
        return filtered.reverse();
      });
    },
    async findAllReleases(repo: string): Promise<GitHubRelease[]> {
      return withToolSpan('findAllReleases', { repo }, () => githubService.findAllReleases(repo));
    },
    async getIssueResolution(
      issueUrl: string
    ): Promise<{ fixed_in_version: string; pr_number: number } | null> {
      return withToolSpan('getIssueResolution', { issueUrl }, () =>
        githubService.getIssueResolution(issueUrl)
      );
    },
    async getPrDetails(
      repo: string,
      prNumber: number
    ): Promise<{ title: string; body: string | null } | null> {
      return withToolSpan('getPrDetails', { repo, prNumber }, async () => {
        const pr = await githubService.getPullRequest(repo, prNumber);
        if (!pr) return null;
        return { title: pr.title, body: pr.body };
      });
    },
  };
}
