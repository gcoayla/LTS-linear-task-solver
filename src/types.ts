import { type Serve } from "bun";
import type { getLabel } from "./linear/client";

// Route mapping for Bun.serve
export type AppRoutes<
  WebSocket = unknown,
  Path extends string = string,
> = Serve.Routes<WebSocket, Path>;

export type ServerRoute = AppRoutes[keyof AppRoutes];

export type LabelType = {
  name: string;
  description?: string;
  color: `#${string}`;
};
