#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { APortClient } from "@aporthq/sdk-node";

// Initialize APort client
const aportClient = new APortClient({
  baseUrl: process.env.APORT_BASE_URL || "https://api.aport.io",
  timeoutMs: 5000,
});

// Create MCP server using non-deprecated McpServer API
const server = new McpServer(
  {
    name: "aport-protected-tools",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tool: Merge Pull Request
server.registerTool(
  "merge_pull_request",
  {
    description: "Merge a pull request (policy-protected)",
    inputSchema: z.object({
      agent_id: z
        .string()
        .describe("Agent passport ID (required for policy verification)"),
      repository: z.string().describe('Repository name (e.g., "owner/repo")'),
      pr_number: z.number().describe("Pull request number"),
      base_branch: z.string().optional().describe('Base branch (e.g., "main")'),
    }),
  },
  async (args) => {
    return await handleMergePullRequest(args.agent_id, args);
  }
);

// Register tool: Process Refund
server.registerTool(
  "process_refund",
  {
    description: "Process a refund (policy-protected)",
    inputSchema: z.object({
      agent_id: z.string().describe("Agent passport ID"),
      amount: z.number().describe("Refund amount in cents"),
      currency: z.string().describe('Currency code (e.g., "USD")'),
      order_id: z.string().describe("Order ID"),
      reason_code: z.string().optional().describe("Reason code"),
    }),
  },
  async (args) => {
    return await handleProcessRefund(args.agent_id, args);
  }
);

// Handler: Merge Pull Request (Simple Mode Only)
async function handleMergePullRequest(
  agentId: string,
  args: {
    repository: string;
    pr_number: number;
    base_branch?: string;
  }
) {
  console.error(
    `[Policy Check] Verifying merge permission for agent ${agentId}`
  );

  try {
    const context = {
      agent_id: agentId,
      repository: args.repository,
      base_branch: args.base_branch || "main",
      pr_size_kb: 250,
    };

    // Simple mode: Passport check + policy verification
    const decision = await aportClient.verifyPolicy(
      agentId,
      "code.repository.merge.v1",
      context
    );

    console.error(
      `[Policy Decision] ${decision.decision_id}: ${
        decision.allow ? "ALLOW" : "DENY"
      }`
    );

    if (!decision.allow) {
      const reasons =
        decision.reasons?.map((r: any) => r.message).join(", ") ||
        "Policy denied";
      return {
        content: [
          {
            type: "text" as const,
            text: `Policy denied: ${reasons}\nDecision ID: ${decision.decision_id}`,
          },
        ],
        isError: true,
      };
    }

    // Policy allowed - execute tool
    return {
      content: [
        {
          type: "text" as const,
          text: `✅ Pull request #${args.pr_number} merged to ${
            args.base_branch || "main"
          } in ${args.repository}\n\nDecision ID: ${
            decision.decision_id
          }\nAgent: ${agentId}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
      isError: true,
    };
  }
}

// Handler: Process Refund (Simple Mode Only)
async function handleProcessRefund(
  agentId: string,
  args: {
    amount: number;
    currency: string;
    order_id: string;
    reason_code?: string;
  }
) {
  console.error(
    `[Policy Check] Verifying refund permission for agent ${agentId}`
  );

  try {
    const context = {
      agent_id: agentId,
      amount: args.amount,
      currency: args.currency,
      order_id: args.order_id,
      reason_code: args.reason_code || "customer_request",
    };

    // Simple mode: Passport check + policy verification
    const decision = await aportClient.verifyPolicy(
      agentId,
      "finance.payment.refund.v1",
      context
    );

    console.error(
      `[Policy Decision] ${decision.decision_id}: ${
        decision.allow ? "ALLOW" : "DENY"
      }`
    );

    if (!decision.allow) {
      const reasons =
        decision.reasons?.map((r: any) => r.message).join(", ") ||
        "Policy denied";
      return {
        content: [
          {
            type: "text" as const,
            text: `Policy denied: ${reasons}\nDecision ID: ${decision.decision_id}`,
          },
        ],
        isError: true,
      };
    }

    // Policy allowed - execute refund
    const refundId = `ref_${Date.now()}`;
    return {
      content: [
        {
          type: "text" as const,
          text: `✅ Refund processed: ${refundId}\nAmount: $${(
            args.amount / 100
          ).toFixed(2)} ${args.currency}\nOrder: ${
            args.order_id
          }\n\nDecision ID: ${decision.decision_id}\nAgent: ${agentId}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
      isError: true,
    };
  }
}

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("APort-protected MCP server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
