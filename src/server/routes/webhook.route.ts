import type { IssueWebhookPayload } from "@linear/sdk";
import type { ServerRoute } from "../../types";
import { getLabel, linearClient } from "../../linear/client";
import {
  aiDoneLabelPayload,
  aiFailedLabelPayload,
  aiInProgressLabelPayload,
} from "../../linear/labels";
import { getLangchainGithubTools } from "../../agent/tools";
import { Sandbox } from "e2b";

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  StateGraph,
  Annotation,
  messagesStateReducer,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { LLM_TOKEN } from "../../env";
import { octokit } from "../../github/octokit";
import { getGithubRepoUrl, appendGithubToken, AI_MODEL } from "../../shared";

// defining the webhook route
export const webhookRoute: ServerRoute = {
  async GET() {
    return Response.json({ message: "Webhook active" });
  },

  async POST(req) {
    console.log("🚀 Webhook received.");
    const { data: issuePayload } = (await req.json()) as {
      data: IssueWebhookPayload;
    };

    // fetch the issue
    let freshIssue: any = issuePayload;
    try {
      freshIssue = await linearClient.issue(issuePayload.id);
    } catch (e) {
      console.warn("⚠️ Could not fetch fresh issue, using payload.");
    }

    const labels = freshIssue.labels
      ? await (
          await freshIssue.labels()
        ).nodes
      : [];
    const labelNames = labels.map((l: any) => l.name.toLowerCase());
    const labelIds = labels.map((l: any) => l.id);

    // IGNORE if NOT ai-candidate
    if (!labelNames.includes("ai-candidate")) {
      return Response.json({ message: "Ignored: Not an AI candidate" });
    }

    // IGNORE if ALREADY in progress/done/failed
    const [aiInProgressLabel, aiFailedLabel, aiDoneLabel] = await Promise.all([
      getLabel(aiInProgressLabelPayload),
      getLabel(aiFailedLabelPayload),
      getLabel(aiDoneLabelPayload),
    ]);

    const activeLabelIds = [
      aiInProgressLabel.id,
      aiFailedLabel.id,
      aiDoneLabel.id,
    ];
    if (labelIds.some((id: string) => activeLabelIds.includes(id))) {
      console.log("⚠️ Ignored: Already processed or in progress.");
      return Response.json({ message: "Ignored: Already processed" });
    }

    // Only now do we update Linear
    try {
      await linearClient.updateIssue(freshIssue.id, {
        addedLabelIds: [aiInProgressLabel.id],
      });
    } catch (e) {
      console.log("⚠️ Could not lock issue (concurrency collision). Ignoring.");
      return Response.json({ message: "Ignored: Locked" });
    }

    console.log("📦 Creating sandbox...");
    const sandbox = await Sandbox.create();
    const REPO_PATH = "/home/user/repo";

    try {
      console.log("⬇️ Cloning repo...");
      await sandbox.commands.run(
        `git clone ${appendGithubToken(await getGithubRepoUrl(freshIssue.projectId!)!)} ${REPO_PATH}`
      );
      await sandbox.commands.run(
        `git config --global user.email "ai@linear.app" && git config --global user.name "AI Agent"`,
        { cwd: REPO_PATH }
      );

      console.log("🛠 Initializing Agent...");
      const tools = getLangchainGithubTools(
        sandbox,
        await getGithubRepoUrl(freshIssue.projectId!)!
      );
      const model = new ChatGoogleGenerativeAI({
        model: AI_MODEL,
        apiKey: LLM_TOKEN,
      }).bindTools(tools);

      const AgentState = Annotation.Root({
        messages: Annotation<BaseMessage[]>({ reducer: messagesStateReducer }),
      });
      const workflow = new StateGraph(AgentState)
        .addNode("agent", async (state) => ({
          messages: [await model.invoke(state.messages)],
        }))
        .addNode("tools", new ToolNode(tools))
        .addEdge("__start__", "agent")
        .addConditionalEdges("agent", (state) => {
          const last = state.messages[state.messages.length - 1] as any;
          return last.tool_calls?.length > 0 ? "tools" : "__end__";
        })
        .addEdge("tools", "agent");

      const app = workflow.compile().withConfig({ recursionLimit: 25 });

      console.log("🧠 Running Agent loop...");
      await app.invoke({
        messages: [
          new SystemMessage(`You are a Senior Software Engineer.
            YOUR PROCESS:
            1. EXPLORE: Use 'getProjectResources' and 'listFiles'.
            2. READ: Use 'getFileContent'.
            3. WRITE: Use 'writeFile' to apply changes.
            - Once changes are done, output "TASK_COMPLETE".`),
          new HumanMessage(
            `Issue: ${freshIssue.title}\nDescription: ${freshIssue.description}`
          ),
        ],
      });
      console.log("✅ Agent loop finished.");

      const branchName = `ai-fix-${freshIssue.id}-${Date.now()}`;
      console.log(`🌿 Branching: ${branchName}`);
      await sandbox.commands.run(`git checkout -b ${branchName}`, {
        cwd: REPO_PATH,
      });

      const status = await sandbox.commands.run("git status --porcelain", {
        cwd: REPO_PATH,
      });
      if (status.stdout.trim() !== "") {
        console.log("💾 Committing and Pushing...");
        await sandbox.commands.run("git add .", { cwd: REPO_PATH });
        await sandbox.commands.run(
          `git commit -m "AI Fix: ${freshIssue.title}"`,
          { cwd: REPO_PATH }
        );
        await sandbox.commands.run(`git push origin ${branchName}`, {
          cwd: REPO_PATH,
        });

        const [owner, repo] = (await getGithubRepoUrl(freshIssue.projectId!)!)!
          .split("github.com/")[1]!
          .split("/") as [string, string];

        const { data: repoData } = await octokit.rest.repos.get({
          owner,
          repo: repo.replace(".git", ""),
        });

        await octokit.rest.pulls.create({
          owner,
          repo: repo.replace(".git", ""),
          title: `AI Fix: ${freshIssue.title}`,
          body: `Automated PR generated by AI. \n\nRelated Issue: ${freshIssue.title}`,
          head: branchName,
          base: repoData.default_branch,
          draft: true,
        });
        console.log("🎉 PR Created.");
      }

      await linearClient.updateIssue(freshIssue.id, {
        addedLabelIds: [aiDoneLabel.id],
        removedLabelIds: [aiInProgressLabel.id],
      });
    } catch (error) {
      console.error("❌ Agent error:", error);
      await linearClient.updateIssue(freshIssue.id, {
        addedLabelIds: [aiFailedLabel.id],
        removedLabelIds: [aiInProgressLabel.id],
      });
    } finally {
      await sandbox.kill();
    }
    return Response.json({ status: "ok" });
  },
};
