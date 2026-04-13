/**
 * MCP Client with Passport Example
 *
 * This example demonstrates how to attach agent passports to MCP tool calls
 * for authorization verification. This is the CLIENT side - the agent that
 * makes tool calls to MCP servers.
 *
 * Key concepts:
 * 1. Attach agent_id to MCP tool call arguments
 * 2. Handle policy denials gracefully (retry with lower request, or escalate)
 * 3. Passport renewal flow when passport expires
 * 4. Error handling and audit trails
 *
 * This works with any MCP server that requires agent_id for policy verification.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { APortClient } from "@aporthq/sdk-node";
import type { PolicyVerificationResponse } from "@aporthq/sdk-node";

// Configuration
const AGENT_ID =
  process.env.APORT_AGENT_ID || "ap_a2d10232c6534523812423eec8a1425c";
const APORT_BASE_URL = process.env.APORT_BASE_URL || "https://api.aport.io";
const MCP_SERVER_COMMAND = process.env.MCP_SERVER_COMMAND || "npx";
const MCP_SERVER_ARGS = process.env.MCP_SERVER_ARGS
  ? process.env.MCP_SERVER_ARGS.split(" ")
  : ["@aporthq/mcp-policy-gate-example"];

/**
 * MCP Client with Passport Support
 *
 * Wraps the MCP client to automatically attach agent_id to tool calls
 */
class MCPClientWithPassport {
  private client: Client;
  private agentId: string;
  private aportClient: APortClient;

  constructor(agentId: string, transport: StdioClientTransport) {
    this.agentId = agentId;
    this.client = new Client(
      {
        name: "mcp-client-with-passport",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );
    this.aportClient = new APortClient({
      baseUrl: APORT_BASE_URL,
      timeoutMs: 5000,
    });
  }

  /**
   * Connect to MCP server
   */
  async connect(transport: StdioClientTransport): Promise<void> {
    await this.client.connect(transport);
    console.error(
      `[MCP Client] Connected to MCP server with agent_id: ${this.agentId}`
    );
  }

  /**
   * Map MCP tool name to APort policy ID
   */
  private getPolicyIdForTool(toolName: string): string {
    const toolToPolicyMap: Record<string, string> = {
      merge_pull_request: "code.repository.merge.v1",
      process_refund: "finance.payment.refund.v1",
      export_customer_data: "data.export.create.v1",
      publish_release: "code.release.publish.v1",
      send_message: "messaging.message.send.v1",
      execute_transaction: "finance.transaction.execute.v1",
      access_data: "governance.data.access.v1",
      crypto_trade: "finance.crypto.trade.v1",
      ingest_report: "data.report.ingest.v1",
      review_contract: "legal.contract.review.v1",
    };

    const policyId = toolToPolicyMap[toolName];
    if (!policyId) {
      throw new Error(
        `No policy mapping found for tool: ${toolName}. Available tools: ${Object.keys(
          toolToPolicyMap
        ).join(", ")}`
      );
    }
    return policyId;
  }

  /**
   * Build context for policy verification from tool arguments
   */
  private buildPolicyContext(
    toolName: string,
    args: Record<string, any>
  ): Record<string, any> {
    const context: Record<string, any> = {
      agent_id: this.agentId,
      ...args,
    };

    // Add tool-specific context transformations
    if (toolName === "merge_pull_request") {
      context.base_branch = args.base_branch || "main";
      context.pr_size_kb = args.pr_size_kb || 250;
    } else if (toolName === "process_refund") {
      context.reason_code = args.reason_code || "customer_request";
    }

    return context;
  }

  /**
   * Call MCP tool with automatic policy verification and agent_id attachment
   */
  async callTool(
    toolName: string,
    args: Record<string, any>,
    options?: {
      retryOnDenial?: boolean;
      maxRetries?: number;
      retryBackoff?: number;
      skipVerification?: boolean; // For testing or when server handles verification
    }
  ): Promise<any> {
    const maxRetries = options?.maxRetries ?? 3;
    const retryBackoff = options?.retryBackoff ?? 1000;
    let lastError: Error | null = null;
    let currentArgs = { ...args };

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Step 1: Verify policy BEFORE calling MCP tool (unless skipped)
        if (!options?.skipVerification) {
          const policyId = this.getPolicyIdForTool(toolName);
          const context = this.buildPolicyContext(toolName, currentArgs);

          console.error(
            `[Policy Verification] Verifying ${policyId} for agent ${
              this.agentId
            } (attempt ${attempt + 1}/${maxRetries})`
          );

          const decision: PolicyVerificationResponse =
            await this.aportClient.verifyPolicy(
              this.agentId,
              policyId,
              context
            );

          console.error(
            `[Policy Decision] ${decision.decision_id}: ${
              decision.allow ? "ALLOW" : "DENY"
            }`
          );

          if (!decision.allow) {
            const reasons =
              decision.reasons?.map((r) => r.message).join(", ") ||
              "Policy denied";
            throw new PolicyDeniedError(`Policy denied: ${reasons}`, decision);
          }

          console.error(
            `[Policy Verification] ✅ Policy check passed (decision_id: ${decision.decision_id})`
          );
        }

        // Step 2: Call MCP tool with agent_id attached
        console.error(
          `[Tool Call] Calling ${toolName} (attempt ${
            attempt + 1
          }/${maxRetries})`
        );

        // Attach agent_id to arguments for MCP server
        const argsWithPassport: Record<string, any> = {
          ...currentArgs,
          agent_id: this.agentId,
        };

        const result: any = await (this.client as any).request({
          method: "tools/call",
          params: {
            name: toolName,
            arguments: argsWithPassport,
          },
        });

        // Check if result indicates policy denial (server-side check)
        if (result && result.content && Array.isArray(result.content)) {
          const textContent = result.content.find(
            (c: any) => c.type === "text"
          );
          if (textContent?.text?.includes("Policy denied")) {
            throw new PolicyDeniedError(textContent.text, result);
          }
        }

        console.error(`[Tool Call] ✅ ${toolName} succeeded`);
        return result;
      } catch (error) {
        lastError = error as Error;

        // If it's a policy denial and retry is enabled, try with adjusted parameters
        if (
          error instanceof PolicyDeniedError &&
          options?.retryOnDenial &&
          attempt < maxRetries - 1
        ) {
          console.error(
            `[Tool Call] ❌ Policy denied, retrying with adjusted parameters...`
          );

          // Example: Reduce amount for refunds, reduce row limit for exports
          if (toolName === "process_refund" && currentArgs.amount) {
            currentArgs.amount = Math.floor(
              (currentArgs.amount as number) * 0.5
            ); // Reduce by 50%
            console.error(
              `[Tool Call] Retrying with reduced amount: ${currentArgs.amount}`
            );
          } else if (toolName === "export_customer_data" && currentArgs.limit) {
            currentArgs.limit = Math.floor((currentArgs.limit as number) * 0.5); // Reduce by 50%
            console.error(
              `[Tool Call] Retrying with reduced limit: ${currentArgs.limit}`
            );
          }

          // Wait before retry
          await new Promise((resolve) =>
            setTimeout(resolve, retryBackoff * (attempt + 1))
          );
          continue;
        }

        // If not retryable or max retries reached, throw
        throw error;
      }
    }

    throw (
      lastError ||
      new Error(`Failed to call ${toolName} after ${maxRetries} attempts`)
    );
  }

  /**
   * List available tools from MCP server
   */
  async listTools(): Promise<any[]> {
    const result: any = await (this.client as any).request({
      method: "tools/list",
      params: {},
    });
    return result && result.tools ? result.tools : [];
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    await this.client.close();
  }
}

/**
 * Policy Denial Error
 */
class PolicyDeniedError extends Error {
  constructor(
    message: string,
    public result: PolicyVerificationResponse | any
  ) {
    super(message);
    this.name = "PolicyDeniedError";
  }

  get decisionId(): string | undefined {
    if (this.result && typeof this.result === "object") {
      return this.result.decision_id;
    }
    return undefined;
  }

  get reasons(): Array<{ code: string; message: string }> | undefined {
    if (this.result && typeof this.result === "object") {
      return this.result.reasons;
    }
    return undefined;
  }
}

/**
 * Example: Using MCP Client with OpenAI Function Calling
 *
 * This shows how to integrate MCP client with OpenAI's function calling API
 */
export async function exampleWithOpenAI() {
  console.log("=".repeat(60));
  console.log("Example: MCP Client with OpenAI Function Calling");
  console.log("=".repeat(60));

  // In a real OpenAI integration, you would:
  // 1. Get function call from OpenAI
  // 2. Map function name to MCP tool name
  // 3. Call MCP tool with agent_id attached
  // 4. Return result to OpenAI

  const transport = new StdioClientTransport({
    command: MCP_SERVER_COMMAND,
    args: MCP_SERVER_ARGS,
  });

  const mcpClient = new MCPClientWithPassport(AGENT_ID, transport);
  await mcpClient.connect(transport);

  try {
    // Simulate OpenAI function call: "refund $50 to customer_123"
    const openaiFunctionCall = {
      name: "process_refund",
      arguments: {
        amount: 5000, // $50.00 in cents
        currency: "USD",
        order_id: "ord_123",
        customer_id: "customer_123",
        reason_code: "customer_request",
      },
    };

    // Call MCP tool with passport attached
    const result = await mcpClient.callTool(
      openaiFunctionCall.name,
      openaiFunctionCall.arguments,
      {
        retryOnDenial: true,
        maxRetries: 3,
      }
    );

    console.log("✅ Refund processed:", result);
  } catch (error) {
    if (error instanceof PolicyDeniedError) {
      console.error("❌ Policy denied:", error.message);
      console.error("   Result:", error.result);
      // In a real OpenAI integration, you would return this to the user
    } else {
      console.error("❌ Error:", error);
    }
  } finally {
    await mcpClient.close();
  }
}

/**
 * Example: Using MCP Client with Anthropic Tool Use
 *
 * This shows how to integrate MCP client with Anthropic's tool use API
 */
export async function exampleWithAnthropic() {
  console.log("=".repeat(60));
  console.log("Example: MCP Client with Anthropic Tool Use");
  console.log("=".repeat(60));

  const transport = new StdioClientTransport({
    command: MCP_SERVER_COMMAND,
    args: MCP_SERVER_ARGS,
  });

  const mcpClient = new MCPClientWithPassport(AGENT_ID, transport);
  await mcpClient.connect(transport);

  try {
    // Simulate Anthropic tool use: "merge PR #123"
    const anthropicToolUse = {
      id: "toolu_abc123",
      name: "merge_pull_request",
      input: {
        repository: "my-org/my-repo",
        pr_number: 123,
        base_branch: "main",
      },
    };

    // Call MCP tool with passport attached
    const result = await mcpClient.callTool(
      anthropicToolUse.name,
      anthropicToolUse.input,
      {
        retryOnDenial: false, // Don't retry merges
      }
    );

    console.log("✅ PR merged:", result);
  } catch (error) {
    if (error instanceof PolicyDeniedError) {
      console.error("❌ Policy denied:", error.message);
      // In a real Anthropic integration, you would return this to the model
    } else {
      console.error("❌ Error:", error);
    }
  } finally {
    await mcpClient.close();
  }
}

/**
 * Example: Policy Verification Flow
 *
 * Demonstrates how policy verification works before tool execution
 */
export async function examplePolicyVerification() {
  console.log("=".repeat(60));
  console.log("Example: Policy Verification Flow");
  console.log("=".repeat(60));

  const transport = new StdioClientTransport({
    command: MCP_SERVER_COMMAND,
    args: MCP_SERVER_ARGS,
  });

  const mcpClient = new MCPClientWithPassport(AGENT_ID, transport);
  await mcpClient.connect(transport);

  try {
    // First call - policy is verified before tool execution
    console.log("Call 1: Policy verification before tool execution");
    const result1 = await mcpClient.callTool("merge_pull_request", {
      repository: "my-org/my-repo",
      pr_number: 1,
    });
    console.log("✅ First call succeeded:", result1);

    // Second call - policy is verified again (fresh verification each time)
    console.log("\nCall 2: Policy verification again (fresh check)");
    const result2 = await mcpClient.callTool("merge_pull_request", {
      repository: "my-org/my-repo",
      pr_number: 2,
    });
    console.log("✅ Second call succeeded:", result2);

    console.log("\n✅ Policy verification flow completed");
    console.log("   Note: Each tool call verifies policy before execution");
  } catch (error) {
    if (error instanceof PolicyDeniedError) {
      console.error("❌ Policy denied:", error.message);
      console.error("   Decision ID:", error.decisionId);
      console.error("   Reasons:", error.reasons);
    } else {
      console.error("❌ Error:", error);
    }
  } finally {
    await mcpClient.close();
  }
}

/**
 * Example: Error Handling and Graceful Degradation
 *
 * Shows how to handle different error scenarios
 */
export async function exampleErrorHandling() {
  console.log("=".repeat(60));
  console.log("Example: Error Handling");
  console.log("=".repeat(60));

  const transport = new StdioClientTransport({
    command: MCP_SERVER_COMMAND,
    args: MCP_SERVER_ARGS,
  });

  const mcpClient = new MCPClientWithPassport(AGENT_ID, transport);
  await mcpClient.connect(transport);

  // Example 1: Policy denial with retry
  console.log("\n1. Policy denial with automatic retry:");
  try {
    await mcpClient.callTool(
      "process_refund",
      {
        amount: 1000000, // $10,000 - might exceed limits
        currency: "USD",
        order_id: "ord_456",
      },
      {
        retryOnDenial: true,
        maxRetries: 3,
      }
    );
  } catch (error) {
    if (error instanceof PolicyDeniedError) {
      console.log("   Policy denied after retries - escalate to human");
    }
  }

  // Example 2: Invalid tool name
  console.log("\n2. Invalid tool name:");
  try {
    await mcpClient.callTool("nonexistent_tool", {});
  } catch (error) {
    console.log(
      `   Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Example 3: Network error
  console.log("\n3. Network error handling:");
  // In production, you would implement retry logic with exponential backoff
  // and circuit breaker pattern

  await mcpClient.close();
}

/**
 * Main example runner
 */
async function main() {
  console.log("🚀 MCP Client with Passport Examples\n");

  // Run examples
  await exampleWithOpenAI();
  console.log("\n");

  await exampleWithAnthropic();
  console.log("\n");

  await examplePolicyVerification();
  console.log("\n");

  await exampleErrorHandling();
  console.log("\n");

  console.log("✨ All examples completed!");
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { MCPClientWithPassport, PolicyDeniedError };
