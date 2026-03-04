import { GITHUB_TOKEN } from "../env";
import { linearClient } from "../linear/client";

export const GITHUB_BASE_URL = "https://github.com";
export const AI_MODEL = "gemini-3-flash-preview";

// helper functions
export async function getProjectExternalLinks(projectId: string) {
  const project = await linearClient.project(projectId);
  const externalLinksInfo = await project.externalLinks();
  return externalLinksInfo.nodes;
}

export async function getGithubRepoUrl(projectId: string) {
  const projectExternalLinks = await getProjectExternalLinks(projectId);
  return projectExternalLinks.find((link) =>
    link.url.startsWith(GITHUB_BASE_URL)
  )?.url!;
}

export function appendGithubToken(repoUrl: string) {
  if (!repoUrl.startsWith(GITHUB_BASE_URL)) throw new Error("Invalid URL");
  return repoUrl.replace("https://", `https://${GITHUB_TOKEN}@`);
}
