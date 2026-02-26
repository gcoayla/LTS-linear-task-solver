import type { LabelType } from "../types";
import type { getLabel } from "./client";

export const aiInProgressLabelPayload: LabelType = {
  name: "ai-in-progress",
  color: "#4765d1",
  description:
    "Managed by Webhook: Indicates the AI Agent is currently processing this task.",
};

export const aiFailedLabelPayload: LabelType = {
  name: "ai-failed",
  color: "#d04a53",
  description:
    "Managed by Webhook: Indicates the AI Agent failed to complete this task.",
};

export const aiDoneLabelPayload: LabelType = {
  name: "ai-done",
  color: "#00dcc9",
  description:
    "Managed by Webhook: Indicates the AI Agent completed this task.",
};
