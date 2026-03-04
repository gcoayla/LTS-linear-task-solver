import type { IssueWebhookPayload } from "@linear/sdk";
import type { ServerRoute } from "../../types";
import { getLabel, linearClient } from "../../linear/client";
import {
  aiDoneLabelPayload,
  aiFailedLabelPayload,
  aiInProgressLabelPayload,
} from "../../linear/labels";
import { runAgentWorkflow } from "../../services/orchestrator";

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

    // ── Fetch fresh issue ─────────────────────────────────────────
    let freshIssue: any = issuePayload;
    try {
      freshIssue = await linearClient.issue(issuePayload.id);
    } catch (e) {
      console.warn("⚠️ Could not fetch fresh issue, using payload.");
    }

    // ── Label validation ──────────────────────────────────────────
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

    // IGNORE if issue has no project (we need projectId to find the repo)
    if (!freshIssue.projectId) {
      console.log("⚠️ Ignored: Issue has no associated project.");
      return Response.json({ message: "Ignored: No project linked" });
    }

    // IGNORE if ALREADY in progress/done/failed (idempotency check)
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

    // ── Acquire distributed lock ──────────────────────────────────
    try {
      await linearClient.updateIssue(freshIssue.id, {
        addedLabelIds: [aiInProgressLabel.id],
      });
    } catch (e) {
      console.log("⚠️ Could not lock issue (concurrency collision). Ignoring.");
      return Response.json({ message: "Ignored: Locked" });
    }

    // ── Dispatch to orchestrator (fire-and-forget) ────────────────
    // Lock is confirmed. Hand off to the worker.
    // We do NOT await so the webhook returns 200 immediately.
    runAgentWorkflow(
      {
        id: freshIssue.id,
        title: freshIssue.title,
        description: freshIssue.description,
        projectId: freshIssue.projectId,
      },
      {
        aiInProgressLabelId: aiInProgressLabel.id,
        aiDoneLabelId: aiDoneLabel.id,
        aiFailedLabelId: aiFailedLabel.id,
      }
    ).catch((err) => {
      // Safety net: if runAgentWorkflow itself throws before reaching
      // its own try/catch (e.g. Sandbox.create fails), mark as failed.
      console.error("❌ Orchestrator top-level error:", err);
      linearClient
        .updateIssue(freshIssue.id, {
          addedLabelIds: [aiFailedLabel.id],
          removedLabelIds: [aiInProgressLabel.id],
        })
        .catch((labelErr) =>
          console.error("❌ Could not mark issue as failed:", labelErr)
        );
    });

    return Response.json({ status: "ok" });
  },
};
