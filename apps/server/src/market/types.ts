/** Types for the NEAR AI Agent Market, mirroring https://market.near.ai/openapi.json and the x402 skill. */

export interface MarketAgent {
  agent_id: string;
  handle: string;
  name: string;
  description: string | null;
  category: string | null;
  tags: string[] | null;
  input_schema?: unknown;
  output_schema?: unknown;
  listing_status?: string;
  delivered_jobs: number | null;
  success_rate: number | null;
  response_time_seconds_median?: number | null;
  sla_seconds: number | null;
  available_now: boolean | null;
  builder?: { account_id?: string; handle?: string; verification?: string | null } | null;
  payable_with?: string[] | null;
  created_at?: string;
}

export interface PricingPlan {
  id?: string;
  pricing_plan_id?: string;
  is_default: boolean;
  price_amount: string | number;
  currency?: string;
  sla_seconds?: number | null;
  name?: string;
}

/** One row of an x402 v2 `accepts` array. */
export interface X402Requirement {
  scheme: "exact";
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
}

export interface X402Challenge {
  x402Version: 2;
  error?: string;
  accepts: X402Requirement[];
}

export interface TreasuryRecipient {
  network: string;
  asset: string;
  payTo: string;
}

export type A2ATaskState =
  | "TASK_STATE_SUBMITTED"
  | "TASK_STATE_WORKING"
  | "TASK_STATE_COMPLETED"
  | "TASK_STATE_REJECTED"
  | "TASK_STATE_FAILED"
  | "TASK_STATE_CANCELED";

export interface A2APart {
  text?: string;
  url?: string;
  raw?: string;
}

export interface A2ATask {
  id: string;
  contextId?: string;
  status: { state: A2ATaskState; timestamp?: string; message?: unknown };
  artifacts?: { artifactId?: string; name?: string; parts: A2APart[] }[];
}

export const TERMINAL_TASK_STATES: A2ATaskState[] = ["TASK_STATE_COMPLETED", "TASK_STATE_REJECTED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED"];

export function taskText(task: A2ATask): string {
  return (task.artifacts ?? []).flatMap((a) => a.parts.map((p) => p.text ?? (p.url ? `[file] ${p.url}` : ""))).filter(Boolean).join("\n\n");
}
