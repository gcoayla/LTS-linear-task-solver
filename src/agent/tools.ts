import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { Sandbox } from "e2b";

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
        description: "List repository files in the sandbox.",
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
      async ({ filePath, newContent }) => {
        await sandbox.files.write(`/home/user/repo/${filePath}`, newContent);
        return `File ${filePath} written to sandbox successfully.`;
      },
      {
        name: "writeFile",
        description: "Writes content to a file in the sandbox.",
        schema: z.object({ filePath: z.string(), newContent: z.string() }),
      }
    ),
  ];
}
