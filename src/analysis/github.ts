import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import * as Sentry from '@sentry/node';
import { SemVer, parse as semverParse } from 'semver';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_APP_ID = '2884252';
const DEFAULT_INSTALLATION_ID = '110672284';

const PRIVATE_KEY_PATHS = [
  '/run/secrets/github-app-private-key',
  resolve(process.cwd(), 'secrets', 'github-app-private-key'),
];

// Type definitions for GitHub API responses
export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      date: string | undefined;
    };
  };
  html_url: string;
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  merged_at: string | null;
  merge_commit_sha: string | null;
}

export interface GitHubRelease {
  tag: string;
  name: string | null;
  url: string;
  body: string | null | undefined;
}

export interface Repository {
  name: string;
  fullName: string;
  htmlUrl: string;
}

export class GitHubService {
  private octokit: Octokit | null = null;
  private readonly appId: string;
  private readonly installationId: string;

  constructor(options?: { appId?: string; installationId?: string }) {
    this.appId = options?.appId ?? process.env.GITHUB_APP_ID ?? DEFAULT_APP_ID;
    this.installationId =
      options?.installationId ?? process.env.GITHUB_INSTALLATION_ID ?? DEFAULT_INSTALLATION_ID;
  }

  private loadPrivateKey(): string {
    for (const path of PRIVATE_KEY_PATHS) {
      if (existsSync(path)) {
        return readFileSync(path, 'utf-8');
      }
    }
    throw new Error(`GitHub App private key not found. Tried: ${PRIVATE_KEY_PATHS.join(', ')}`);
  }

  private getOctokit(): Octokit {
    if (!this.octokit) {
      const privateKey = this.loadPrivateKey();
      this.octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: this.appId,
          privateKey,
          installationId: this.installationId,
        },
        request: {
          retryAfter: 3, // Retry after 3 seconds on rate limit
        },
      });
    }
    return this.octokit;
  }

  async listOrgPublicRepos(org: string): Promise<Repository[]> {
    const octokit = this.getOctokit();
    const repos = await octokit.paginate(octokit.rest.repos.listForOrg, {
      org,
      type: 'public',
      per_page: 100,
    });
    return repos.map(
      (r: { name: string; full_name?: string; html_url?: string; owner?: { login?: string } }) => ({
        name: r.name,
        fullName: r.full_name ?? `${r.owner?.login}/${r.name}`,
        htmlUrl: r.html_url ?? `https://github.com/${r.full_name ?? r.name}`,
      })
    );
  }

  /**
   * Get ALL commits between two versions using simple date-based approach
   */
  async getCommitsBetweenVersions(
    repo: string,
    fromVersion: string,
    commitSearchKeywords: string[]
  ): Promise<GitHubCommit[]> {
    try {
      console.log(`Looking up ALL commits between ${fromVersion} and HEAD`);
      const [owner, repoName] = repo.split('/');

      // Get the date of the fromVersion
      const fromDate = await this.getVersionDate(owner, repoName, fromVersion);

      // Search for commits with keywords since that date
      return this.searchCommitsWithKeywords(repo, commitSearchKeywords, fromDate);
    } catch (error) {
      console.error(`Failed to get commits between ${fromVersion} and HEAD for ${repo}:`, error);
      Sentry.captureException(error);
      return [];
    }
  }

  /**
   * Get the commit date for a version tag
   */
  private async getVersionDate(owner: string, repoName: string, version: string): Promise<string> {
    try {
      const octokit = this.getOctokit();
      // Try different tag formats that repos commonly use
      const tagFormats = [version, `v${version}`, version.replace(/^v/, '')];

      for (const tagFormat of tagFormats) {
        try {
          const tagResponse = await octokit.git.getRef({
            owner,
            repo: repoName,
            ref: `tags/${tagFormat}`,
          });

          // Get the commit details to extract the date
          const commitResponse = await octokit.git.getCommit({
            owner,
            repo: repoName,
            commit_sha: tagResponse.data.object.sha,
          });

          console.log(`Found version ${tagFormat} with date ${commitResponse.data.author.date}`);
          return commitResponse.data.author.date;
        } catch {
          // Try next format
          continue;
        }
      }

      throw new Error(`Version tag not found: ${version}`);
    } catch (error) {
      console.error(`Could not get date for version ${version}:`, error);
      // Fallback to a reasonable date (1 year ago) if we can't find the version
      const fallbackDate = new Date();
      fallbackDate.setFullYear(fallbackDate.getFullYear() - 1);
      return fallbackDate.toISOString();
    }
  }

  /**
   * Search for commits containing specific keywords since a date
   */
  private async searchCommitsWithKeywords(
    repo: string,
    keywords: string[],
    sinceDate: string
  ): Promise<GitHubCommit[]> {
    const allMatchingCommits: GitHubCommit[] = [];

    // Search for each keyword separately to get comprehensive results
    for (const keyword of keywords) {
      try {
        const keywordCommits = await this.searchCommits(repo, keyword, sinceDate.split('T')[0]);
        allMatchingCommits.push(...keywordCommits);
      } catch (error) {
        console.error(`Failed to search for keyword "${keyword}":`, error);
        // Continue with other keywords even if one fails
      }
    }

    // Remove duplicates based on SHA
    const uniqueCommits = allMatchingCommits.filter(
      (commit, index, self) => index === self.findIndex((c) => c.sha === commit.sha)
    );

    console.log(
      `Found ${uniqueCommits.length} unique commits matching keywords: ${keywords.join(', ')}`
    );
    return uniqueCommits;
  }

  /**
   * Search repository for commits containing a specific keyword since a date
   */
  async searchCommits(repo: string, keyword: string, sinceDate: string): Promise<GitHubCommit[]> {
    const searchQuery = `repo:${repo} committer-date:>${sinceDate} ${keyword}`;
    console.log(`Searching commits with query: ${searchQuery}`);

    // GitHub's Search API often works better unauthenticated for public repos
    try {
      return await Sentry.startSpan(
        {
          op: 'github.search.commits',
          name: `Search commits with query`,
          attributes: {
            searchQuery,
            keyword,
            sinceDate,
            repo,
          },
        },
        async (span) => {
          const unauthenticatedOctokit = new Octokit();
          const { data } = await unauthenticatedOctokit.search.commits({
            q: searchQuery,
            sort: 'committer-date',
            order: 'desc',
            per_page: 100,
          });

          const commits = data.items.map((item) => ({
            sha: item.sha,
            commit: {
              message: item.commit.message,
              author: {
                date: item.commit.author.date,
              },
            },
            html_url: item.html_url,
          }));

          const numCommits = commits.length;
          span.setAttribute('numCommits', numCommits);
          console.log(`✅ Unauthenticated search: Found ${numCommits} commits for "${keyword}"`);
          return commits;
        }
      );
    } catch (unauthError) {
      console.error(`❌ Both authenticated and unauthenticated search failed for "${keyword}"`);
      console.error(
        'Auth error:',
        unauthError instanceof Error ? unauthError.message : unauthError
      );
      console.error(
        'Unauth error:',
        unauthError instanceof Error ? unauthError.message : unauthError
      );

      Sentry.captureException(unauthError);
      // Don't throw - return empty array so other keywords can still be searched
      return [];
    }
  }

  /**
   * Get pull request details by number
   */
  async getPullRequest(repo: string, prNumber: number): Promise<GitHubPullRequest | null> {
    try {
      const octokit = this.getOctokit();
      const [owner, repoName] = repo.split('/');
      const { data } = await octokit.pulls.get({
        owner,
        repo: repoName,
        pull_number: prNumber,
      });

      return {
        id: data.id,
        number: data.number,
        title: data.title,
        body: data.body,
        html_url: data.html_url,
        merged_at: data.merged_at,
        merge_commit_sha: data.merge_commit_sha,
      };
    } catch (error) {
      console.error(`Failed to get PR #${prNumber} for ${repo}:`, error);
      return null;
    }
  }

  /**
   * Extract PR numbers from commit messages (e.g., "fix: something (#1234)")
   */
  extractPRNumbers(commits: GitHubCommit[]): number[] {
    const prNumbers = new Set<number>();

    for (const commit of commits) {
      // Match patterns like (#123), (GH-123), (PR-123)
      const matches = commit.commit.message.match(/\(#?(?:GH-|PR-)?(\d+)\)/gi);
      if (matches) {
        for (const match of matches) {
          const numberMatch = match.match(/(\d+)/);
          if (numberMatch) {
            prNumbers.add(parseInt(numberMatch[1]));
          }
        }
      }
    }

    return Array.from(prNumbers);
  }

  /**
   * Get version chronology by parsing semantic versions
   */
  parseVersions(releases: GitHubRelease[]): SemVer[] {
    return releases
      .map((r) => semverParse(r.tag))
      .filter((v) => !!v)
      .sort((a, b) => a.compare(b));
  }

  /**
   * Check current rate limit status
   */
  async checkRateLimit(): Promise<{
    remaining: number;
    limit: number;
    resetTime: Date;
  }> {
    const octokit = this.getOctokit();
    const { data } = await octokit.rateLimit.get();
    return {
      remaining: data.rate.remaining,
      limit: data.rate.limit,
      resetTime: new Date(data.rate.reset * 1000),
    };
  }

  async findAllReleases(repo: string): Promise<GitHubRelease[]> {
    return await Sentry.startSpan({ name: 'findAllReleases', attributes: { repo } }, async () => {
      const octokit = this.getOctokit();
      const [owner, repoName] = repo.split('/');
      const allReleases: GitHubRelease[] = [];
      let page = 1;
      const perPage = 100;

      while (true) {
        const { data } = await Sentry.startSpan(
          { name: 'listReleases', attributes: { page, perPage } },
          () =>
            octokit.repos.listReleases({
              owner,
              repo: repoName,
              per_page: perPage,
              page,
            })
        );

        if (data.length === 0) {
          break;
        }

        allReleases.push(
          ...data.map((r) => ({
            tag: r.tag_name,
            name: r.name,
            url: r.url,
            body: r.body,
          }))
        );

        if (data.length < perPage) {
          break;
        }

        page++;
      }

      return allReleases.sort((a, b) => {
        const semverA = semverParse(a.tag);
        const semverB = semverParse(b.tag);
        if (!semverA || !semverB) {
          return 0;
        }
        return semverB.compare(semverA);
      });
    });
  }

  findReleaseForPr(pr: GitHubPullRequest, releases: GitHubRelease[]): string | undefined | null {
    const prRefRegex = new RegExp(`\\(#${pr.number}\\)|#${pr.number}\\b`);
    const containing = releases.filter((r) => prRefRegex.test(r.body ?? ''));
    if (containing.length === 0) return undefined;
    const oldest = containing.sort((a, b) => {
      const semverA = semverParse(a.tag);
      const semverB = semverParse(b.tag);
      if (!semverA || !semverB) return 0;
      return semverA.compare(semverB);
    })[0];
    return oldest?.tag ?? oldest?.name ?? undefined;
  }

  /**
   * Parse a GitHub issue/PR URL into owner, repo, and number.
   */
  parseIssueUrl(url: string): { owner: string; repo: string; number: number } | null {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)/i);
    if (!match) return null;
    return {
      owner: match[1],
      repo: match[2],
      number: parseInt(match[3], 10),
    };
  }

  /**
   * Check if a linked issue/PR was fixed and in which release.
   * Returns fixed_in_version (tag) and pr_number if the fix is in a release.
   */
  async getIssueResolution(
    issueUrl: string
  ): Promise<{ fixed_in_version: string; pr_number: number } | null> {
    const parsed = this.parseIssueUrl(issueUrl);
    if (!parsed) return null;

    const { owner, repo, number } = parsed;
    const repoSlug = `${owner}/${repo}`;

    try {
      const octokit = this.getOctokit();

      const issueResponse = await octokit.issues.get({
        owner,
        repo,
        issue_number: number,
      });
      const issue = issueResponse.data;

      let prNumber: number;
      if (issue.pull_request) {
        prNumber = number;
      } else {
        const pr = await this.findClosingPr(owner, repo, number);
        if (!pr) return null;
        prNumber = pr.number;
      }

      const prData = await octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });
      const pr: GitHubPullRequest = {
        id: prData.data.id,
        number: prData.data.number,
        title: prData.data.title,
        body: prData.data.body,
        html_url: prData.data.html_url,
        merged_at: prData.data.merged_at,
        merge_commit_sha: prData.data.merge_commit_sha,
      };
      if (!pr.merged_at) return null;

      const releases = await this.findAllReleases(repoSlug);
      const fixedInVersion = this.findReleaseForPr(pr, releases);
      if (!fixedInVersion) return null;

      return { fixed_in_version: fixedInVersion, pr_number: prNumber };
    } catch (error) {
      console.error(`Failed to get issue resolution for ${issueUrl}:`, error);
      Sentry.captureException(error);
      return null;
    }
  }

  private async findClosingPr(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<{ number: number } | null> {
    const patterns = [
      new RegExp(`(?:fixes?|closes?|resolves?)\\s*#\\s*${issueNumber}\\b`, 'i'),
      new RegExp(`#\\s*${issueNumber}\\b`, 'i'),
    ];

    const octokit = this.getOctokit();
    const { data } = await octokit.search.issuesAndPullRequests({
      q: `repo:${owner}/${repo} type:pr is:merged`,
      sort: 'updated',
      order: 'desc',
      per_page: 30,
    });

    for (const item of data.items) {
      const text = `${item.title || ''} ${item.body || ''}`;
      if (patterns.some((p) => p.test(text))) {
        return { number: item.number };
      }
    }
    return null;
  }
}
