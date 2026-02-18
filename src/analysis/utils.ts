export function prLinkFor(repo: string, prNumber: number): string {
  return `https://github.com/${repo}/pull/${prNumber}`;
}
