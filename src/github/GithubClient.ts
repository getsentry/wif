import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "octokit";
import type { Repository } from "./types.js";

const DEFAULT_APP_ID = "2884252";
const DEFAULT_INSTALLATION_ID = "110672284";

const PRIVATE_KEY_PATHS = [
  "/run/secrets/github-app-private-key",
  resolve(process.cwd(), "secrets", "github-app-private-key"),
];

export class GithubClient {
  private octokit: Octokit | null = null;
  private readonly appId: string;
  private readonly installationId: string;

  constructor(options?: {
    appId?: string;
    installationId?: string;
  }) {
    this.appId =
      options?.appId ??
      process.env.GITHUB_APP_ID ??
      DEFAULT_APP_ID;
    this.installationId =
      options?.installationId ??
      process.env.GITHUB_INSTALLATION_ID ??
      DEFAULT_INSTALLATION_ID;
  }

  private loadPrivateKey(): string {
    for (const path of PRIVATE_KEY_PATHS) {
      if (existsSync(path)) {
        return readFileSync(path, "utf-8");
      }
    }
    throw new Error(
      `GitHub App private key not found. Tried: ${PRIVATE_KEY_PATHS.join(", ")}`,
    );
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
      });
    }
    return this.octokit;
  }

  async listOrgPublicRepos(org: string): Promise<Repository[]> {
    const octokit = this.getOctokit();
    const repos = await octokit.paginate(
      octokit.rest.repos.listForOrg,
      {
        org,
        type: "public",
        per_page: 100,
      },
    );
    return repos.map(
      (r: {
        name: string;
        full_name?: string;
        html_url?: string;
        owner?: { login?: string };
      }) => ({
        name: r.name,
        fullName: r.full_name ?? `${r.owner?.login}/${r.name}`,
        htmlUrl: r.html_url ?? `https://github.com/${r.full_name ?? r.name}`,
      }),
    );
  }
}
