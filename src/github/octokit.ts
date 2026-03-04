import { Octokit } from "octokit";
import { GITHUB_TOKEN } from "../env";

export const octokit = new Octokit({ auth: GITHUB_TOKEN });
