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
import { LLM_TOKEN, GITHUB_TOKEN } from "../../env";

export const webhookRoute: ServerRoute = {
  async GET() {
    return Response.json({ message: "Webhook endpoint active" });
  },

  async POST(req) {
    const { data: issue } = (await req.json()) as { data: IssueWebhookPayload };

    // Safety check for payload structure
    if (!("title" in issue))
      return Response.json({ message: "Ignored: No title" });

    // Initial Candidate Check
    const labelNames = issue.labels.map((l) => l.name.toLowerCase());
    if (!labelNames.includes("ai-candidate"))
      return Response.json({ message: "Ignored: Not an AI candidate" });

    // Fetch AI status labels for filtering
    const [aiInProgressLabel, aiFailedLabel, aiDoneLabel] = await Promise.all([
      getLabel(aiInProgressLabelPayload),
      getLabel(aiFailedLabelPayload),
      getLabel(aiDoneLabelPayload),
    ]);

    // Check if issue is already in a terminal or active state
    // We check the issue's labelIds array to see if any of our AI status labels are present.
    const activeLabelIds = [
      aiInProgressLabel.id,
      aiFailedLabel.id,
      aiDoneLabel.id,
    ];
    const isAlreadyProcessed = issue.labelIds.some((id) =>
      activeLabelIds.includes(id)
    );

    if (isAlreadyProcessed) {
      return Response.json({
        message: "Ignored: Issue already has AI status labels",
      });
    }

    // Repo Setup
    const project = await linearClient.project(issue.projectId!);
    const repoUrl = (await project.externalLinks()).nodes.find((l) =>
      l.url.startsWith("https://github.com")
    )?.url;

    if (!repoUrl) return Response.json({ error: "No Repo URL" });

    // Execution
    const sandbox = await Sandbox.create();

    try {
      // Mark as In Progress
      await linearClient.updateIssue(issue.id, {
        addedLabelIds: [aiInProgressLabel.id],
      });

      // Clone Repo
      const repoUrlWithToken = repoUrl.replace(
        "https://",
        `https://${GITHUB_TOKEN}@`
      );
      await sandbox.commands.run(
        `git clone ${repoUrlWithToken} /home/user/repo`
      );

      // Initialize Agent
      const tools = getLangchainGithubTools(sandbox, repoUrl);
      const model = new ChatGoogleGenerativeAI({
        model: "gemini-3-flash-preview",
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
          const lastMessage = state.messages[state.messages.length - 1] as any;
          return lastMessage.tool_calls?.length > 0 ? "tools" : "__end__";
        })
        .addEdge("tools", "agent");

      const app = workflow.compile();

      await app.invoke({
        messages: [
          new SystemMessage(
            "You are an expert Engineer. Solve the issue. MUST use applyFixAndCreatePR to finish."
          ),
          new HumanMessage(
            `Issue: ${issue.title}\nDescription: ${issue.description}`
          ),
        ],
      });

      // Success Path
      await linearClient.updateIssue(issue.id, {
        addedLabelIds: [aiDoneLabel.id],
        removedLabelIds: [aiInProgressLabel.id],
      });
    } catch (error) {
      console.error("Agent execution error:", error);

      // Failure Path
      await linearClient.updateIssue(issue.id, {
        addedLabelIds: [aiFailedLabel.id],
        removedLabelIds: [aiInProgressLabel.id],
      });
    } finally {
      await sandbox.kill();
    }

    return Response.json({ status: "ok" });
  },
};
