import type { AnalysisTools } from './tools/index.js';
import type { AnalysisSubtasks, ScanReleaseNotesOutput } from './subtasks/index.js';
import { prLinkFor } from './utils.js';

export type AnalysisResult =
  | { kind: 'high_confidence'; version: string; prLink: string; prNumber: number }
  | {
      kind: 'medium_confidence';
      version: string;
      prLink: string;
      prNumber: number;
      candidates: Array<{ version: string; prLink: string; prNumber: number }>;
    }
  | { kind: 'no_result' }
  | { kind: 'too_old'; message: string }
  | { kind: 'already_latest'; message: string }
  | { kind: 'invalid_version'; message: string }
  | { kind: 'fetch_failed'; message: string }
  | { kind: 'clarification'; message: string };

export async function analyzeIssue(
  issueDescription: string,
  tools: AnalysisTools,
  subtasks: AnalysisSubtasks
): Promise<AnalysisResult> {
  const progressTs = await tools.postNewSlackMessage('Analyzing…');

  const extractResult = await subtasks.extractRequest(issueDescription);
  if (extractResult.kind === 'clarification') {
    await tools.updateSlackMessage(progressTs, extractResult.message);
    await tools.postNewSlackMessage(extractResult.message);
    return { kind: 'clarification', message: extractResult.message };
  }

  const { sdk, version, problem, links } = extractResult;

  const resolveResult = await subtasks.resolveRepository(sdk, issueDescription);
  if (resolveResult.kind === 'clarification') {
    await tools.updateSlackMessage(progressTs, resolveResult.message);
    await tools.postNewSlackMessage(resolveResult.message);
    return { kind: 'clarification', message: resolveResult.message };
  }

  const repo = resolveResult.repo;

  const skippedSteps: string[] = [];

  if (links && links.length > 0) {
    await tools.updateSlackMessage(progressTs, 'Checking linked issues…');
    const linkResult = await subtasks.checkExtractedLinks(links, version, repo, problem);
    if (linkResult.kind === 'high_confidence') {
      const result: AnalysisResult = {
        kind: 'high_confidence',
        version: linkResult.version,
        prLink: linkResult.prLink,
        prNumber: linkResult.prNumber,
      };
      await postResult(tools, progressTs, result, {
        repo,
        firstRelease: linkResult.version,
        lastRelease: linkResult.version,
        releaseCount: 1,
        evaluatedPrs: [linkResult.prLink],
        skippedSteps,
      });
      return result;
    }
    if (linkResult.skippedLinks?.length) {
      for (const { url, reason } of linkResult.skippedLinks) {
        skippedSteps.push(`Could not check link ${url}: ${reason}`);
      }
    }
  }

  await tools.updateSlackMessage(progressTs, `Resolving releases for ${repo} after v${version}…`);

  const fetchResult = await subtasks.fetchReleaseRange(repo, version);

  if (fetchResult.kind === 'too_old') {
    const result: AnalysisResult = { kind: 'too_old', message: fetchResult.message };
    await postResult(tools, progressTs, result, {
      repo,
      version,
      releaseCount: 0,
      skippedSteps,
    });
    return result;
  }

  if (fetchResult.kind === 'already_latest') {
    const result: AnalysisResult = {
      kind: 'already_latest',
      message: fetchResult.message,
    };
    await postResult(tools, progressTs, result, {
      repo,
      version,
      releaseCount: 0,
      skippedSteps,
    });
    return result;
  }

  if (fetchResult.kind === 'invalid_version') {
    const result: AnalysisResult = {
      kind: 'invalid_version',
      message: fetchResult.message,
    };
    await postResult(tools, progressTs, result, { repo, version, skippedSteps });
    return result;
  }

  if (fetchResult.kind === 'fetch_failed') {
    const result: AnalysisResult = {
      kind: 'fetch_failed',
      message: fetchResult.message,
    };
    await postResult(tools, progressTs, result, { repo, version, skippedSteps });
    return result;
  }

  const releases = fetchResult.releases;
  const firstRelease = releases[0]?.tag ?? version;
  const lastRelease = releases[releases.length - 1]?.tag ?? version;

  await tools.updateSlackMessage(
    progressTs,
    `Scanning releases \`${firstRelease}\`–\`${lastRelease}\` (\`${releases.length}\` releases)…`
  );

  const scanResult = await subtasks.scanReleaseNotes(releases, problem, repo, (done, total) => {
    tools.updateSlackMessage(progressTs, `Scanned \`${done}\` of \`${total}\` releases…`);
  });

  const result = mapScanResultToAnalysisResult(scanResult);
  await postResult(tools, progressTs, result, {
    repo,
    firstRelease,
    lastRelease,
    releaseCount: releases.length,
    version,
    evaluatedPrs:
      result.kind === 'high_confidence'
        ? [prLinkFor(repo, result.prNumber)]
        : result.kind === 'medium_confidence'
          ? result.candidates.map((c) => c.prLink)
          : [],
    skippedSteps,
  });

  return result;
}

function mapScanResultToAnalysisResult(scan: ScanReleaseNotesOutput): AnalysisResult {
  if (scan.kind === 'high_confidence') {
    return {
      kind: 'high_confidence',
      version: scan.candidate.version,
      prLink: scan.candidate.prLink,
      prNumber: scan.candidate.prNumber,
    };
  }
  if (scan.kind === 'medium') {
    const best = scan.candidates[0];
    return {
      kind: 'medium_confidence',
      version: best.version,
      prLink: best.prLink,
      prNumber: best.prNumber,
      candidates: scan.candidates.map((c) => ({
        version: c.version,
        prLink: c.prLink,
        prNumber: c.prNumber,
      })),
    };
  }
  return { kind: 'no_result' };
}

interface PostResultContext {
  repo?: string;
  firstRelease?: string;
  lastRelease?: string;
  releaseCount?: number;
  version?: string;
  evaluatedPrs?: string[];
  skippedSteps?: string[];
}

async function postResult(
  tools: AnalysisTools,
  progressTs: string | undefined,
  result: AnalysisResult,
  ctx: PostResultContext
): Promise<void> {
  const checked =
    ctx.firstRelease && ctx.lastRelease && ctx.repo
      ? `Checked: releases \`${ctx.firstRelease}\`–\`${ctx.lastRelease}\` in \`${ctx.repo}\`.`
      : ctx.version
        ? `Checked: version \`${ctx.version}\`.`
        : '';
  const evaluated =
    ctx.evaluatedPrs && ctx.evaluatedPrs.length > 0
      ? `Relevant PRs evaluated: ${ctx.evaluatedPrs.join(', ')}.`
      : ctx.releaseCount !== undefined
        ? `Release notes reviewed: ${ctx.releaseCount}.`
        : '';
  const skipped =
    ctx.skippedSteps && ctx.skippedSteps.length > 0
      ? `Skipped steps: ${ctx.skippedSteps.join('; ')}.`
      : '';

  let responseText: string;

  const trace = [checked, evaluated, skipped].filter(Boolean).join('\n');

  switch (result.kind) {
    case 'high_confidence':
      responseText =
        `This was fixed in v${normalizeVersion(result.version)}. See ${result.prLink}.\n\n` + trace;
      break;
    case 'medium_confidence':
      responseText =
        `v${normalizeVersion(result.version)} includes changes that may address this (${result.prLink}), ` +
        `but I'm not fully certain. Deferring to SDK maintainers to confirm.\n\n` +
        trace;
      break;
    case 'no_result':
      responseText =
        `I wasn't able to identify a fix in the releases after v${ctx.version ?? '?'}.\n` +
        `Deferring to SDK maintainers for investigation.\n\n` +
        trace;
      break;
    case 'too_old':
      responseText =
        `The reported version (v${ctx.version ?? '?'}) is more than 100 releases behind ` +
        `the latest stable release. Unable to look this up efficiently.\n` +
        `Deferring to SDK maintainers.` +
        (skipped ? `\n\n${skipped}` : '');
      break;
    case 'already_latest':
    case 'invalid_version':
    case 'fetch_failed':
    case 'clarification':
      responseText = result.message + (skipped ? `\n\n${skipped}` : '');
      break;
  }

  await tools.updateSlackMessage(progressTs, 'Done.');
  await tools.postNewSlackMessage(responseText);
}

function normalizeVersion(v: string): string {
  return v.replace(/^v/, '');
}
