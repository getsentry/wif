export function prLinkFor(repo: string, prNumber: number): string {
  return `https://github.com/${repo}/pull/${prNumber}`;
}

export function prLinkMarkdown(repo: string, prNumber: number): string {
  const url = prLinkFor(repo, prNumber);
  return `[PR #${prNumber}](${url})`;
}
