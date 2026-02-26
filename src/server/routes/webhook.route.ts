import type { IssueWebhookPayload } from "@linear/sdk";
import type { ServerRoute } from "../../types";
import { getLabel, linearClient } from "../../linear/client";
import {
  aiDoneLabelPayload,
  aiFailedLabelPayload,
  aiInProgressLabelPayload,
} from "../../linear/labels";

export const webhookRoute: ServerRoute = {
  async GET() {
    return Response.json({
      message: "hello",
    });
  },
  async POST(req) {
    const { data: issue } = (await req.json()) as {
      data: IssueWebhookPayload;
    };

    const isIssuePayload = "title" in issue && "description" in issue;

    if (isIssuePayload) {
      const labelNames = issue.labels.map((label) => label.name.toLowerCase());

      const aiLabels = {
        aiCandidate: labelNames.includes("ai-candidate"),
        aiInProgress: labelNames.includes("ai-in-progress"),
        aiFailed: labelNames.includes("ai-failed"),
      };

      // For now, workflow will only start for issues
      // that have the "ai-candidate" label. In-progress
      // or failed issues will be ignored. This can change
      // in the future (e.g. requirements change or the
      // zagent should retry failed issues).
      if (
        aiLabels.aiCandidate &&
        !aiLabels.aiInProgress &&
        !aiLabels.aiFailed
      ) {
        console.log("Received AI candidate issue");

        // Get the "ai-in-progress" label.
        const aiInProgressLabel = await getLabel(aiInProgressLabelPayload);

        // Get the "ai-failed" label
        const aiFailedLabel = await getLabel(aiFailedLabelPayload);

        const aiDoneLabel = await getLabel(aiDoneLabelPayload);

        // First and most impotant: update the status to ai-in-progress
        await linearClient.updateIssue(issue.id, {
          addedLabelIds: [aiInProgressLabel.id],
        });

        // Continue work. Agent work starts here:
      }
    }

    return Response.json({});
  },
};
