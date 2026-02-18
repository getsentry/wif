import { parse as semverParse } from 'semver';
import type { GitHubRelease, GitHubService } from '../github.js';

export function createGitHubTools(githubService: GitHubService) {
  return {
    async getReleasesFromVersion(repo: string, fromVersion: string): Promise<GitHubRelease[]> {
      const all = await githubService.findAllReleases(repo);
      const fromParsed = semverParse(fromVersion) ?? semverParse(fromVersion.replace(/^v/, ''));
      if (!fromParsed) {
        return all;
      }
      return all.filter((r) => {
        const tagParsed = semverParse(r.tag);
        if (!tagParsed) return false;
        return tagParsed.compare(fromParsed) >= 0;
      });
    },
    async findAllReleases(repo: string): Promise<GitHubRelease[]> {
      return githubService.findAllReleases(repo);
    },
  };
}
