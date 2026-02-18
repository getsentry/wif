import { describe, it, expect, vi } from 'vitest';
import { createGitHubTools } from './github.js';
import type { GitHubService } from '../github.js';

describe('createGitHubTools', () => {
  it('getReleasesFromVersion returns releases strictly after version, oldest first', async () => {
    const mockReleases = [
      { tag: 'v8.0.0', name: '8.0.0', url: '', body: null },
      { tag: 'v8.1.0', name: '8.1.0', url: '', body: null },
      { tag: 'v7.9.0', name: '7.9.0', url: '', body: null },
    ];
    const githubService = {
      findAllReleases: vi.fn().mockResolvedValue(mockReleases),
    } as unknown as GitHubService;

    const tools = createGitHubTools(githubService);
    const result = await tools.getReleasesFromVersion('getsentry/sentry-javascript', '8.0.0');

    expect(githubService.findAllReleases).toHaveBeenCalledWith('getsentry/sentry-javascript');
    expect(result).toHaveLength(1);
    expect(result.map((r) => r.tag)).toEqual(['v8.1.0']);
  });

  it('getReleasesFromVersion throws when version is unparseable', async () => {
    const mockReleases = [{ tag: 'v8.0.0', name: '8.0.0', url: '', body: null }];
    const githubService = {
      findAllReleases: vi.fn().mockResolvedValue(mockReleases),
    } as unknown as GitHubService;

    const tools = createGitHubTools(githubService);
    await expect(
      tools.getReleasesFromVersion('getsentry/sentry-javascript', 'not-a-version')
    ).rejects.toThrow('Invalid version');
  });

  it('findAllReleases delegates to service', async () => {
    const mockReleases = [{ tag: 'v1.0.0', name: '1.0.0', url: '', body: null }];
    const githubService = {
      findAllReleases: vi.fn().mockResolvedValue(mockReleases),
    } as unknown as GitHubService;

    const tools = createGitHubTools(githubService);
    const result = await tools.findAllReleases('owner/repo');

    expect(githubService.findAllReleases).toHaveBeenCalledWith('owner/repo');
    expect(result).toEqual(mockReleases);
  });
});
