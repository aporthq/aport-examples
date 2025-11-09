/**
 * MCP (Model Context Protocol) Enforcement Example
 *
 * ✅ CURRENT STATUS:
 * - ✅ Passport MCP configuration is supported (passport.mcp.servers, passport.mcp.tools)
 * - ✅ Policy verification validates MCP against passport allowlist
 * - ✅ MCP context can be passed in policy verification requests
 * - ✅ Supports multiple MCP servers/tools per request (arrays)
 *
 * This example demonstrates:
 * 1. Extracting MCP headers from requests (application-level)
 * 2. Passing MCP context to policy verification
 * 3. Using arrays for multiple MCP servers/tools
 *
 * ACTUAL SDK LOCATION: /sdk/node
 * ACTUAL MIDDLEWARE LOCATION: /middleware/express
 */

const express = require("express");
// Import from actual SDK location: /sdk/node
// In production: npm install @aporthq/sdk-node
const { APortClient, AportError } = require("@aporthq/sdk-node");

const app = express();
app.use(express.json());

// Initialize APort client
const client = new APortClient({
  baseUrl: process.env.APORT_API_BASE_URL || "https://api.aport.io",
  apiKey: process.env.APORT_API_KEY,
  timeoutMs: 5000,
});

/**
 * Extract MCP headers from request
 *
 * Supports both single values and arrays for multiple MCP servers/tools.
 * Arrays are preferred for multiple MCP usage.
 */
function extractMCPHeaders(req) {
  // Support array format (preferred): X-MCP-Servers, X-MCP-Tools
  const serversHeader =
    req.headers["x-mcp-servers"] || req.headers["x-mcp-server"];
  const toolsHeader = req.headers["x-mcp-tools"] || req.headers["x-mcp-tool"];

  // Parse arrays if comma-separated, otherwise treat as single value
  const servers = serversHeader
    ? serversHeader.includes(",")
      ? serversHeader.split(",").map((s) => s.trim())
      : [serversHeader]
    : [];

  const tools = toolsHeader
    ? toolsHeader.includes(",")
      ? toolsHeader.split(",").map((t) => t.trim())
      : [toolsHeader]
    : [];

  return {
    servers: servers,
    tools: tools,
    session: req.headers["x-mcp-session"],
    // Backward compatibility: single values
    server: servers[0] || null,
    tool: tools[0] || null,
  };
}

/**
 * Validate MCP headers against passport allowlist
 *
 * Validates ALL servers/tools in the request against passport allowlist.
 * The verify endpoint also validates MCP context, but this provides
 * early validation before making the API call.
 */
async function validateMCPAgainstPassport(agentId, mcpHeaders) {
  try {
    // Get passport to check MCP allowlist
    const passport = await client.getPassportView(agentId);
    const allowedServers = passport.mcp?.servers || [];
    const allowedTools = passport.mcp?.tools || [];

    // Validate all servers (array support)
    if (mcpHeaders.servers && mcpHeaders.servers.length > 0) {
      const unauthorizedServers = mcpHeaders.servers.filter(
        (server) => !allowedServers.includes(server)
      );
      if (unauthorizedServers.length > 0) {
        throw new Error(
          `MCP server(s) ${unauthorizedServers.join(
            ", "
          )} not in passport allowlist. ` +
            `Allowed servers: ${allowedServers.join(", ")}`
        );
      }
    }

    // Validate all tools (array support)
    if (mcpHeaders.tools && mcpHeaders.tools.length > 0) {
      const unauthorizedTools = mcpHeaders.tools.filter(
        (tool) => !allowedTools.includes(tool)
      );
      if (unauthorizedTools.length > 0) {
        throw new Error(
          `MCP tool(s) ${unauthorizedTools.join(
            ", "
          )} not in passport allowlist. ` +
            `Allowed tools: ${allowedTools.join(", ")}`
        );
      }
    }

    return true;
  } catch (error) {
    if (error instanceof AportError) {
      throw new Error(`Failed to get passport: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Middleware: Extract agent ID and validate MCP headers
 */
async function mcpEnforcementMiddleware(req, res, next) {
  try {
    // Extract agent ID
    const agentId =
      req.headers["x-agent-passport-id"] || req.headers["x-agent-id"];

    if (!agentId) {
      return res.status(401).json({
        error: "missing_agent_id",
        message:
          "Agent ID is required. Provide it as X-Agent-Passport-Id header.",
      });
    }

    // Extract MCP headers
    const mcpHeaders = extractMCPHeaders(req);

    // Validate MCP headers against passport (application-level)
    // The verify endpoint also validates MCP, but this provides early validation
    if (mcpHeaders.servers.length > 0 || mcpHeaders.tools.length > 0) {
      await validateMCPAgainstPassport(agentId, mcpHeaders);
    }

    // Attach to request for use in routes
    req.agentId = agentId;
    req.mcp = mcpHeaders;

    next();
  } catch (error) {
    return res.status(403).json({
      error: "mcp_enforcement_failed",
      message: error.message,
    });
  }
}

// Apply MCP enforcement middleware
app.use(mcpEnforcementMiddleware);

// Example 1: Basic endpoint that logs MCP headers
app.post("/api/basic-mcp", (req, res) => {
  console.log("Agent ID:", req.agentId);
  console.log("MCP Headers:", req.mcp);

  res.json({
    success: true,
    agent_id: req.agentId,
    mcp_context: req.mcp,
  });
});

// Example 2: Refund with MCP enforcement + policy verification
app.post("/api/refunds/create", async (req, res) => {
  const { amount, currency, customer_id, order_id } = req.body;

  try {
    // Policy verification (validates MCP against passport allowlist)
    // Use new API endpoint: /api/verify/policy/{pack_id}
    const decision = await client.verifyPolicy(
      req.agentId,
      "finance.payment.refund.v1",
      {
        amount, // Amount in cents
        currency,
        customer_id,
        order_id,
        reason_code: req.body.reason_code || "customer_request",
        region: req.body.region || "US",
        idempotency_key: req.body.idempotency_key || `refund_${Date.now()}`,
        // Include MCP context (arrays preferred, single values supported)
        mcp_servers: req.mcp.servers.length > 0 ? req.mcp.servers : undefined,
        mcp_tools: req.mcp.tools.length > 0 ? req.mcp.tools : undefined,
        // Backward compatibility: single values
        mcp_server: req.mcp.server || undefined,
        mcp_tool: req.mcp.tool || undefined,
        mcp_session: req.mcp.session || undefined,
      }
    );

    if (!decision.allow) {
      return res.status(403).json({
        error: "policy_violation",
        message: "Policy verification denied",
        decision_id: decision.decision_id,
        reasons: decision.reasons,
      });
    }

    // MCP headers already validated by middleware
    console.log(
      `Processing refund: $${amount / 100} ${currency} for ${customer_id}`
    );
    console.log("MCP Context:", req.mcp);

    // Process refund (your business logic here)
    const refund_id = `ref_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    res.json({
      success: true,
      refund_id,
      amount,
      currency,
      customer_id,
      order_id,
      decision_id: decision.decision_id,
      processed_via_mcp: req.mcp.servers.length > 0 || req.mcp.tools.length > 0,
      mcp_servers: req.mcp.servers,
      mcp_tools: req.mcp.tools,
      mcp_session: req.mcp.session,
    });
  } catch (error) {
    if (error instanceof AportError) {
      return res.status(error.status || 500).json({
        error: "policy_verification_failed",
        message: error.message,
        decision_id: error.decision_id,
      });
    }

    return res.status(500).json({
      error: "internal_server_error",
      message: error.message,
    });
  }
});

// Example 3: Data export with MCP enforcement + policy verification
app.post("/api/export/csv", async (req, res) => {
  const { table_name, row_limit, include_pii } = req.body;

  try {
    // Policy verification (validates MCP against passport allowlist)
    const decision = await client.verifyPolicy(
      req.agentId,
      "data.export.create.v1",
      {
        table_name,
        row_limit: row_limit || 1000,
        include_pii: include_pii || false,
        // Include MCP context (arrays preferred)
        mcp_servers: req.mcp.servers.length > 0 ? req.mcp.servers : undefined,
        mcp_tools: req.mcp.tools.length > 0 ? req.mcp.tools : undefined,
        mcp_server: req.mcp.server || undefined,
        mcp_tool: req.mcp.tool || undefined,
        mcp_session: req.mcp.session || undefined,
      }
    );

    if (!decision.allow) {
      return res.status(403).json({
        error: "policy_violation",
        message: "Policy verification denied",
        decision_id: decision.decision_id,
        reasons: decision.reasons,
      });
    }

    console.log(`Exporting ${table_name} with limit: ${row_limit}`);
    console.log("MCP Context:", req.mcp);

    // Simulate CSV export
    const csvData = `id,name,email\n1,John Doe,${
      include_pii ? "john@example.com" : "[REDACTED]"
    }\n`;

    const export_id = `exp_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    res.json({
      success: true,
      export_id,
      format: "csv",
      rows: 1,
      mcp_servers: req.mcp.servers,
      mcp_tools: req.mcp.tools,
      decision_id: decision.decision_id,
      data: csvData,
    });
  } catch (error) {
    if (error instanceof AportError) {
      return res.status(error.status || 500).json({
        error: "policy_verification_failed",
        message: error.message,
      });
    }

    return res.status(500).json({
      error: "internal_server_error",
      message: error.message,
    });
  }
});

// Example 4: Health check (no auth required)
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    mcp_enforcement: "enabled (validates MCP context in policy verification)",
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error("Error:", err);

  if (err.message.includes("MCP")) {
    return res.status(403).json({
      error: "mcp_enforcement_failed",
      message: err.message,
    });
  }

  if (err.message.includes("Agent Passport")) {
    return res.status(401).json({
      error: "authentication_failed",
      message: err.message,
    });
  }

  res.status(500).json({
    error: "internal_server_error",
    message: "An unexpected error occurred",
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 MCP-enabled server running on port ${PORT}`);
  console.log(`📋 Try these endpoints:`);
  console.log(`   POST /api/basic-mcp - Basic MCP header logging`);
  console.log(`   POST /api/refunds/create - Refunds with policy + MCP`);
  console.log(`   POST /api/export/csv - Data export with policy + MCP`);
  console.log(`   GET /health - Health check (no auth required)`);
  console.log(``);
  console.log(`📦 Required headers:`);
  console.log(`   X-Agent-Passport-Id: your-agent-id`);
  console.log(
    `   X-MCP-Servers: https://mcp.stripe.com,https://mcp.notion.com (optional, comma-separated)`
  );
  console.log(
    `   X-MCP-Tools: stripe.refunds.create,notion.pages.export (optional, comma-separated)`
  );
  console.log(`   X-MCP-Session: session-id (optional)`);
  console.log(``);
  console.log(`   Alternative (single values, backward compatible):`);
  console.log(`   X-MCP-Server: https://mcp.stripe.com (optional)`);
  console.log(`   X-MCP-Tool: stripe.refunds.create (optional)`);
  console.log(``);
  console.log(
    `✅ MCP validation: Policy verification validates MCP context against passport allowlist`
  );
  console.log(`   See MCP_PRIMER.md and MCP_MULTIPLE_SERVERS.md for details.`);
});

// Example curl commands:
/*

# Basic MCP test (single server/tool)
curl -X POST http://localhost:3000/api/basic-mcp \
  -H "Content-Type: application/json" \
  -H "X-Agent-Passport-Id: ap_your_agent_id" \
  -H "X-MCP-Server: https://mcp.stripe.com" \
  -H "X-MCP-Tool: stripe.refunds.create" \
  -H "X-MCP-Session: session_123" \
  -d '{"test": true}'

# Basic MCP test (multiple servers/tools - preferred)
curl -X POST http://localhost:3000/api/basic-mcp \
  -H "Content-Type: application/json" \
  -H "X-Agent-Passport-Id: ap_your_agent_id" \
  -H "X-MCP-Servers: https://mcp.stripe.com,https://mcp.notion.com" \
  -H "X-MCP-Tools: stripe.refunds.create,notion.pages.export" \
  -H "X-MCP-Session: session_123" \
  -d '{"test": true}'

# Refund with MCP (single server/tool)
curl -X POST http://localhost:3000/api/refunds/create \
  -H "Content-Type: application/json" \
  -H "X-Agent-Passport-Id: ap_your_agent_id" \
  -H "X-MCP-Server: https://mcp.stripe.com" \
  -H "X-MCP-Tool: stripe.refunds.create" \
  -d '{
    "amount": 5000,
    "currency": "USD",
    "customer_id": "cust_123",
    "order_id": "order_456",
    "reason_code": "customer_request"
  }'

# Refund with MCP (multiple servers/tools)
curl -X POST http://localhost:3000/api/refunds/create \
  -H "Content-Type: application/json" \
  -H "X-Agent-Passport-Id: ap_your_agent_id" \
  -H "X-MCP-Servers: https://mcp.stripe.com,https://mcp.notion.com" \
  -H "X-MCP-Tools: stripe.refunds.create,notion.pages.export" \
  -d '{
    "amount": 5000,
    "currency": "USD",
    "customer_id": "cust_123",
    "order_id": "order_456",
    "reason_code": "customer_request"
  }'

# Export with MCP (multiple servers/tools)
curl -X POST http://localhost:3000/api/export/csv \
  -H "Content-Type: application/json" \
  -H "X-Agent-Passport-Id: ap_your_agent_id" \
  -H "X-MCP-Servers: https://mcp.notion.com,https://mcp.snowflake.com" \
  -H "X-MCP-Tools: notion.pages.export,snowflake.query.execute" \
  -d '{
    "table_name": "users",
    "row_limit": 1000,
    "include_pii": false
  }'

# Health check (no auth)
curl http://localhost:3000/health

*/
