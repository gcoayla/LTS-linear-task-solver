import { LinearClient } from "@linear/sdk";

const LINEAR_TOKEN = process.env.LINEAR_TOKEN;

export const linearClient = new LinearClient({
  apiKey: LINEAR_TOKEN,
});

/**
 * Get a Linear label given its information. If label  doesn't
 * exist, it will be created with the information passed
 */
export async function getLabel({
  name,
  description,
  color,
}: {
  name: string;
  description?: string;
  color: `#${string}`;
}) {
  // first get related labels
  const relatedLabels = await linearClient.issueLabels({
    filter: {
      name: {
        eqIgnoreCase: name,
      },
    },
  });

  let label = relatedLabels.nodes[0]!;

  // if label does not exist
  if (!label) {
    label = await linearClient
      .createIssueLabel({
        name,
        color,
        description,
      })
      .then((createdLabel) => createdLabel.issueLabel!);
  }

  return label;
}
