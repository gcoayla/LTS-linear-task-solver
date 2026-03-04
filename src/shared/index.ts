import { GITHUB_TOKEN } from "../env";
import { linearClient } from "../linear/client";

export const GITHUB_BASE_URL = "https://github.com";
export const AI_MODEL = "gemini-3-flash-preview";
export const REPO_PATH = "/home/user/repo";

// helper functions
export async function getProjectExternalLinks(projectId: string) {
  const project = await linearClient.project(projectId);
  const externalLinksInfo = await project.externalLinks();
  return externalLinksInfo.nodes;
}

export async function getGithubRepoUrl(projectId: string): Promise<string> {
  const projectExternalLinks = await getProjectExternalLinks(projectId);
  const link = projectExternalLinks.find((link) =>
    link.url.startsWith(GITHUB_BASE_URL)
  );
  if (!link) {
    throw new Error(
      `No GitHub repository link found for Linear project ${projectId}`
    );
  }
  return link.url;
}

export function appendGithubToken(repoUrl: string) {
  if (!repoUrl.startsWith(GITHUB_BASE_URL)) throw new Error("Invalid URL");
  return repoUrl.replace("https://", `https://${GITHUB_TOKEN}@`);
}

/**
 * Parse owner and repo name from a GitHub URL.
 * Handles both "https://github.com/owner/repo" and "https://github.com/owner/repo.git".
 */
export function parseOwnerRepo(repoUrl: string): { owner: string; repo: string } {
  const path = repoUrl.split("github.com/")[1];
  if (!path) {
    throw new Error(`Cannot parse owner/repo from URL: ${repoUrl}`);
  }
  const [owner, rawRepo] = path.split("/") as [string, string];
  return { owner, repo: rawRepo.replace(".git", "") };
}
