import type { AppRoutes } from "../../types";
import { webhookRoute } from "./webhook.route";

export const appRoutes: AppRoutes = {
  "/webhook": webhookRoute,
};
