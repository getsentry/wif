import { describe, expect, it, vi } from 'vitest';
import { createFetchReleaseRangeSubtask } from './fetch-release-range.js';

function makeTools(overrides?: {
  getReleasesFromVersion?: ReturnType<typeof vi.fn>;
  findAllReleases?: ReturnType<typeof vi.fn>;
}) {
  return {
    getReleasesFromVersion: overrides?.getReleasesFromVersion ?? vi.fn().mockResolvedValue([]),
    findAllReleases: overrides?.findAllReleases ?? vi.fn().mockResolvedValue([]),
  };
}

describe('fetchReleaseRange', () => {
  it('returns version range when no releases found after reported version', async () => {
    const tools = makeTools({
      getReleasesFromVersion: vi.fn().mockResolvedValue([]),
      findAllReleases: vi.fn().mockResolvedValue([
        { tag: '2.19.2', name: '2.19.2', url: '', body: '' },
        { tag: '1.0.0', name: '1.0.0', url: '', body: '' },
        { tag: '2.0.0', name: '2.0.0', url: '', body: '' },
      ]),
    });

    const subtask = createFetchReleaseRangeSubtask(tools);
    const result = await subtask('getsentry/sentry-python', '7.0.0');

    expect(result.kind).toBe('already_latest');
    expect(result.message).toContain('Known stable versions range from');
    expect(result.message).toContain('1.0.0');
    expect(result.message).toContain('2.19.2');
  });

  it('excludes pre-releases from the version range', async () => {
    const tools = makeTools({
      getReleasesFromVersion: vi.fn().mockResolvedValue([]),
      findAllReleases: vi.fn().mockResolvedValue([
        { tag: '3.0.0-alpha.1', name: '3.0.0-alpha.1', url: '', body: '' },
        { tag: '2.5.0', name: '2.5.0', url: '', body: '' },
        { tag: '1.0.0', name: '1.0.0', url: '', body: '' },
      ]),
    });

    const subtask = createFetchReleaseRangeSubtask(tools);
    const result = await subtask('getsentry/sentry-python', '7.0.0');

    expect(result.kind).toBe('already_latest');
    expect(result.message).toContain('1.0.0');
    expect(result.message).toContain('2.5.0');
    expect(result.message).not.toContain('alpha');
  });

  it('falls back to generic message when no stable versions exist', async () => {
    const tools = makeTools({
      getReleasesFromVersion: vi.fn().mockResolvedValue([]),
      findAllReleases: vi.fn().mockResolvedValue([]),
    });

    const subtask = createFetchReleaseRangeSubtask(tools);
    const result = await subtask('getsentry/sentry-python', '7.0.0');

    expect(result.kind).toBe('already_latest');
    expect(result.message).toBe(
      'No releases found after the reported version. You may already be on the latest stable release.'
    );
  });

  it('returns releases when they exist', async () => {
    const releases = [
      { tag: '2.20.0', name: '2.20.0', url: '', body: 'fixes' },
      { tag: '2.21.0', name: '2.21.0', url: '', body: 'more fixes' },
    ];
    const tools = makeTools({
      getReleasesFromVersion: vi.fn().mockResolvedValue(releases),
    });

    const subtask = createFetchReleaseRangeSubtask(tools);
    const result = await subtask('getsentry/sentry-python', '2.19.0');

    expect(result.kind).toBe('releases');
    if (result.kind === 'releases') {
      expect(result.releases).toEqual(releases);
    }
  });
});
