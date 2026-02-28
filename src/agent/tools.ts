import { tool } from "@langchain/core/tools";
import { z } from "zod";
import chalk from "chalk";
import { Sandbox } from "e2b";
import { octokit } from "../github/octokit";

export function getLangchainGithubTools(sandbox: Sandbox, repoUrl: string) {
  const repoInfo = repoUrl
    .replace("https://github.com/", "")
    .replace(".git", "");
  const [owner, repo] = repoInfo.split("/") as [string, string];

  return [
    tool(async () => ({ repoUrl, owner, repo, found: true }), {
      name: "getProjectResources",
      description: "Fetch the project resources.",
      schema: z.object({ projectId: z.string() }),
    }),

    tool(
      async () => {
        const result = await sandbox.commands.run(
          "find . -maxdepth 3 -type f -not -path '*/.*'",
          { cwd: "/home/user/repo" }
        );
        return result.stdout;
      },
      {
        name: "listFiles",
        description: "List repository files using the sandbox.",
        schema: z.object({}),
      }
    ),

    tool(
      async ({ path }) => {
        try {
          return await sandbox.files.read(`/home/user/repo/${path}`);
        } catch (e) {
          return `Error: File not found at ${path}`;
        }
      },
      {
        name: "getFileContent",
        description: "Read file content from the sandbox.",
        schema: z.object({ path: z.string() }),
      }
    ),

    tool(
      async (args) => {
        console.log(
          chalk.yellow("[E2B + GitHub] ") +
            `Searching for existing PRs targeting: "${args.filePath}"`
        );

        try {
          // Instead of matching the title exactly (which the agent modifies),
          // we check if ANY open PR exists that looks like it is modifying our file.
          const { data: openPRs } = await octokit.rest.pulls.list({
            owner,
            repo,
            state: "open",
          });

          // Match if the title contains the filename OR if the branch name starts with the same root
          const rootBranchName = args.branchName.split("-")[0];
          const existingPR = openPRs.find(
            (pr) =>
              pr.title.toLowerCase().includes(args.filePath.toLowerCase()) ||
              pr.head.ref.toLowerCase().includes(rootBranchName!.toLowerCase())
          );

          if (existingPR) {
            console.log(
              chalk.blue("[GitHub Tool] STOPPING: Existing PR detected: ") +
                existingPR.html_url
            );
            return JSON.stringify({
              prUrl: existingPR.html_url,
              status: "Already Exists",
            });
          }

          console.log(
            chalk.yellow("[E2B + GitHub] ") +
              `No existing PR found. Processing ${args.filePath}...`
          );

          await sandbox.files.write(
            `/home/user/repo/${args.filePath}`,
            args.newContent
          );

          const { data: repoData } = await octokit.rest.repos.get({
            owner,
            repo,
          });
          const baseBranch = repoData.default_branch;
          const uniqueBranch = `${args.branchName}-${Date.now()}`;

          const { data: baseRef } = await octokit.rest.git.getRef({
            owner,
            repo,
            ref: `heads/${baseBranch}`,
          });

          await octokit.rest.git.createRef({
            owner,
            repo,
            ref: `refs/heads/${uniqueBranch}`,
            sha: baseRef.object.sha,
          });

          let fileSha: string | undefined;
          try {
            const { data: fileData } = await octokit.rest.repos.getContent({
              owner,
              repo,
              path: args.filePath,
              ref: baseBranch,
            });
            if (!Array.isArray(fileData) && "sha" in fileData) {
              fileSha = fileData.sha;
            }
          } catch (e) {}

          await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: args.filePath,
            message: args.commitMessage,
            content: Buffer.from(args.newContent).toString("base64"),
            branch: uniqueBranch,
            ...(fileSha && { sha: fileSha }),
          });

          const { data: pr } = await octokit.rest.pulls.create({
            owner,
            repo,
            title: args.prTitle,
            body: args.prBody,
            head: uniqueBranch,
            base: baseBranch,
            draft: true,
          });

          console.log(chalk.green("[GitHub Tool] SUCCESS: ") + pr.html_url);
          return JSON.stringify({ prUrl: pr.html_url, status: "Success" });
        } catch (err: any) {
          console.error(chalk.red("[GitHub Tool] FAILED: "), err.message);
          return JSON.stringify({ status: "Error", message: err.message });
        }
      },
      {
        name: "applyFixAndCreatePR",
        description:
          "Creates a PR. If a PR for this file/task already exists, it will abort.",
        schema: z.object({
          filePath: z.string(),
          newContent: z.string(),
          commitMessage: z.string(),
          branchName: z.string(),
          prTitle: z.string(),
          prBody: z.string(),
        }),
      }
    ),
  ];
}
