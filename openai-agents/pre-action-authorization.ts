/**
 * Pre-Action Authorization Pattern for AI Agents
 *
 * This example demonstrates a framework-agnostic pattern for enforcing authorization
 * immediately before any effectful tool/API call (refunds, trades, data exports) using APort.
 *
 * **Key Architecture Decision:**
 * - APort wraps **tool execution**, NOT the LLM client
 * - This makes it work with any agent framework (OpenAI, Anthropic, LangChain, etc.)
 * - GuardrailsOpenAI wraps the LLM client (data safety)
 * - APort wraps tool execution (action authorization)
 * - They're complementary, not competitive
 *
 * The pattern:
 * 1. Agent decides what action to take
 * 2. Before executing the tool, verify authorization with APort
 * 3. If authorized, execute the tool; otherwise, deny with reasons
 *
 * This complements input/output guardrails (like GuardrailsOpenAI) by adding action-level authorization.
 */

// Node.js environment types (for examples that run in Node.js)
// In a real project, install @types/node: npm i --save-dev @types/node
declare const process: {
  env: {
    [key: string]: string | undefined;
  };
};

interface NodeModule {
  id: string;
  exports: any;
  parent: NodeModule | null;
  filename: string | null;
  loaded: boolean;
  children: NodeModule[];
  path: string;
  paths: string[];
}

interface NodeRequire {
  main: NodeModule | undefined;
}

declare const require: NodeRequire & ((id: string) => any);
declare const module: NodeModule;

// Types for APort SDK
interface ActionContext {
  [key: string]: unknown;
  amount?: number;
  currency?: string;
  customer_id?: string;
  table_name?: string;
  row_limit?: number;
  include_pii?: boolean;
  region?: string;
  tenant_id?: string;
  user_id?: string;
}

interface PolicyVerificationResponse {
  decision_id: string;
  allow: boolean;
  reasons?: Array<{ code: string; message: string; severity?: string }>;
  assurance_level?: string;
  expires_in?: number;
  passport_digest?: string;
  signature?: string;
  created_at?: string;
  _meta?: Record<string, unknown>;
}

interface APortClientOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

/**
 * Simple APort client interface
 * In production, use the official @aporthq/sdk-node package
 */
class APortClient {
  private baseUrl: string;
  private apiKey?: string;
  private timeoutMs: number;

  constructor(options: APortClientOptions = {}) {
    this.baseUrl = options.baseUrl || "https://api.aport.io";
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs || 800;
  }

  private getHeaders(idempotencyKey?: string): HeadersInit {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    return headers;
  }

  async verifyPolicy(
    agentId: string,
    policyId: string,
    context: ActionContext = {},
    idempotencyKey?: string
  ): Promise<PolicyVerificationResponse> {
    const url = `${this.baseUrl}/api/verify/policy/${policyId}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.getHeaders(idempotencyKey),
        body: JSON.stringify({
          agent_id: agentId,
          context,
          idempotency_key: idempotencyKey,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new AuthorizationError(
          {
            decision_id: error.decision_id || "unknown",
            allow: false,
            reasons: error.reasons || [
              { code: "HTTP_ERROR", message: `HTTP ${response.status}` },
            ],
          },
          `Authorization failed: HTTP ${response.status}`
        );
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof AuthorizationError) {
        throw error;
      }
      throw new AuthorizationError(
        {
          decision_id: "unknown",
          allow: false,
          reasons: [{ code: "NETWORK_ERROR", message: String(error) }],
        },
        `Network error: ${error}`
      );
    }
  }
}

/**
 * Authorization error with decision context
 */
class AuthorizationError extends Error {
  decision: PolicyVerificationResponse;

  constructor(
    decision: PolicyVerificationResponse,
    message: string = "Authorization denied"
  ) {
    super(message);
    this.name = "AuthorizationError";
    this.decision = decision;
  }
}

/**
 * Pre-action authorizer wrapper
 */
class PreActionAuthorizer {
  constructor(private client: APortClient) {}

  async verify(
    agentId: string,
    policyId: string,
    context: ActionContext,
    idempotencyKey?: string
  ): Promise<PolicyVerificationResponse> {
    const decision = await this.client.verifyPolicy(
      agentId,
      policyId,
      context,
      idempotencyKey
    );

    if (!decision.allow) {
      throw new AuthorizationError(
        decision,
        `Authorization denied: ${
          decision.reasons?.map((r) => r.message).join(", ") ||
          "Policy check failed"
        }`
      );
    }

    return decision;
  }
}

/**
 * Generic wrapper function for adding pre-action authorization to tool functions
 */
function withPreActionAuthorization<TArgs extends unknown[], TReturn>(
  authorizer: PreActionAuthorizer,
  agentId: string,
  policyId: string,
  buildContext: (...args: TArgs) => ActionContext,
  idempotencyKeyFn?: (...args: TArgs) => string | undefined
) {
  return async (fn: (...args: TArgs) => Promise<TReturn> | TReturn) => {
    return async (...args: TArgs): Promise<TReturn> => {
      // Build context from function arguments
      const context = buildContext(...args);

      // Generate idempotency key if provided
      const idempotencyKey = idempotencyKeyFn
        ? idempotencyKeyFn(...args)
        : undefined;

      // Verify authorization
      try {
        const decision = await authorizer.verify(
          agentId,
          policyId,
          context,
          idempotencyKey
        );

        // Log decision for audit trail
        console.log(
          `✅ Authorization allowed: decision_id=${decision.decision_id}`
        );

        // Execute the tool
        return await fn(...args);
      } catch (error) {
        if (error instanceof AuthorizationError) {
          // Log denial for audit trail
          console.log(
            `❌ Authorization denied: decision_id=${error.decision.decision_id}`
          );
          console.log(`   Reasons:`, error.decision.reasons);

          // Re-raise with decision context
          throw error;
        }
        throw error;
      }
    };
  };
}

// Example: Refund tool implementation
async function executeRefund(
  amount: number,
  currency: string,
  customerId: string,
  reason: string = "Customer request"
): Promise<{
  status: string;
  refund_id: string;
  amount: number;
  currency: string;
  customer_id: string;
  reason: string;
}> {
  // Simulate API call
  await new Promise((resolve) => setTimeout(resolve, 100));

  return {
    status: "success",
    refund_id: `ref_${customerId}_${amount}`,
    amount,
    currency,
    customer_id: customerId,
    reason,
  };
}

// Example: Data export tool implementation
async function executeDataExport(
  tableName: string,
  rowLimit: number,
  includePii: boolean = false
): Promise<{
  status: string;
  export_id: string;
  table_name: string;
  rows_exported: number;
  include_pii: boolean;
}> {
  // Simulate API call
  await new Promise((resolve) => setTimeout(resolve, 100));

  return {
    status: "success",
    export_id: `exp_${tableName}`,
    table_name: tableName,
    rows_exported: Math.min(rowLimit, 1000), // Simulated
    include_pii: includePii,
  };
}

/**
 * Example usage
 *
 * Note: This pattern works with any agent framework:
 * - OpenAI Agents SDK
 * - Anthropic Claude
 * - LangChain / LangGraph
 * - Microsoft Agent Framework
 * - CrewAI
 * - AutoGPT
 * - Any framework that calls functions
 *
 * The key: APort wraps functions, not framework-specific clients
 */
async function main() {
  console.log("🚀 Pre-Action Authorization Pattern for AI Agents\n");
  console.log("Framework-agnostic pattern - works with any agent framework\n");

  // Initialize APort client
  const client = new APortClient({
    baseUrl: process.env.APORT_API_URL || "https://api.aport.io",
    apiKey: process.env.APORT_API_KEY, // Optional for public endpoints
  });

  const authorizer = new PreActionAuthorizer(client);

  // Example 1: Refund with authorization
  console.log("=".repeat(60));
  console.log("Example 1: Refund with Pre-Action Authorization");
  console.log("=".repeat(60));

  // Wrap the refund tool with authorization
  const authorizedRefund = await withPreActionAuthorization(
    authorizer,
    process.env.AGENT_ID || "ap_a2d10232c6534523812423eec8a1425c",
    "finance.payment.refund.v1",
    (
      amount: number,
      currency: string,
      customerId: string,
      reason?: string
    ) => ({
      amount,
      currency,
      customer_id: customerId,
      reason: reason || "Customer request",
    })
  )(executeRefund);

  try {
    // This will verify authorization before executing
    const result = await authorizedRefund(
      5000,
      "USD",
      "cust_123",
      "Customer requested refund"
    );
    console.log(`✅ Refund executed:`, result);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      console.log(`❌ Refund denied: ${error.message}`);
      console.log(`   Decision ID: ${error.decision.decision_id}`);
      console.log(`   Reasons:`, error.decision.reasons);
    } else {
      throw error;
    }
  }

  // Example 2: Data export with authorization
  console.log("\n" + "=".repeat(60));
  console.log("Example 2: Data Export with Pre-Action Authorization");
  console.log("=".repeat(60));

  const authorizedExport = await withPreActionAuthorization(
    authorizer,
    process.env.AGENT_ID || "ap_a2d10232c6534523812423eec8a1425c",
    "data.export.create.v1",
    (tableName: string, rowLimit: number, includePii: boolean) => ({
      table_name: tableName,
      row_limit: rowLimit,
      include_pii: includePii,
    })
  )(executeDataExport);

  try {
    // This will verify authorization before executing
    const result = await authorizedExport("users", 1000, false);
    console.log(`✅ Export executed:`, result);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      console.log(`❌ Export denied: ${error.message}`);
      console.log(`   Decision ID: ${error.decision.decision_id}`);
      console.log(`   Reasons:`, error.decision.reasons);
    } else {
      throw error;
    }
  }

  // Example 3: Direct authorization check (without wrapper)
  console.log("\n" + "=".repeat(60));
  console.log("Example 3: Direct Authorization Check");
  console.log("=".repeat(60));

  try {
    const decision = await authorizer.verify(
      process.env.AGENT_ID || "ap_a2d10232c6534523812423eec8a1425c",
      "finance.payment.refund.v1",
      {
        amount: 10000, // $100.00 in cents
        currency: "USD",
        customer_id: "cust_456",
      }
    );

    console.log(
      `✅ Authorization allowed: decision_id=${decision.decision_id}`
    );
    console.log(`   Assurance level: ${decision.assurance_level}`);

    // Now safe to execute the tool
    const result = await executeRefund(10000, "USD", "cust_456");
    console.log(`✅ Refund executed:`, result);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      console.log(`❌ Authorization denied: ${error.message}`);
      console.log(`   Decision ID: ${error.decision.decision_id}`);
    } else {
      throw error;
    }
  }

  console.log("\n✨ Example completed!");
}

// Run example if executed directly
// Note: This check works in Node.js environments
// For browser/other environments, call main() directly
if (typeof require !== "undefined" && require.main === module) {
  main().catch(console.error);
}

export {
  APortClient,
  PreActionAuthorizer,
  AuthorizationError,
  withPreActionAuthorization,
  type ActionContext,
  type PolicyVerificationResponse,
};
