import type { IssueWebhookPayload } from "@linear/sdk";
import { getLabel, linearClient } from "../linear/client";

Bun.serve({
  routes: {
    "/webhook": {
      async POST(req) {
        const { data: issue } = (await req.json()) as {
          data: IssueWebhookPayload;
        };

        const isIssuePayload = "title" in issue && "description" in issue;

        if (isIssuePayload) {
          const labelNames = issue.labels.map((label) =>
            label.name.toLowerCase()
          );

          const aiStatus = {
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
            aiStatus.aiCandidate &&
            !aiStatus.aiInProgress &&
            !aiStatus.aiFailed
          ) {
            console.log("Received AI candidate issue");

            // Get the "ai-in-progress" label.
            const aiInProgressLabel = await getLabel({
              name: "ai-in-progress",
              color: "#4765d1",
              description:
                "Managed by API: Indicates the AI Agent is currently processing this task.",
            });

            // Get the "ai-failed" label
            const aiFailedLabel = await getLabel({
              name: "ai-failed",
              color: "#d04a53",
              description:
                "Managed by API: Indicates the AI Agent failed to complete this task.",
            });

            // First and most impotant: update the status to ai-in-progress
            await linearClient.updateIssue(issue.id, {
              addedLabelIds: [aiInProgressLabel.id, aiFailedLabel.id],
            });

            // Continue work
          }
        }

        return Response.json({});
      },
    },
  },
});
