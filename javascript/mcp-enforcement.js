/**
 * MCP (Model Context Protocol) Enforcement Example
 *
 * This example demonstrates how to use the Agent Passport middleware
 * with MCP header validation and allowlist enforcement.
 */

const express = require("express");
const {
  agentPassportMiddleware,
  mcpEnforcementMiddleware,
  createMCPAwarePolicyMiddleware,
  extractMCPHeaders,
  isMCPServerAllowed,
  isMCPToolAllowed,
} = require("@agent-passport/middleware-express");

const app = express();
app.use(express.json());

// Basic setup with MCP enforcement
app.use(
  agentPassportMiddleware({
    baseUrl: process.env.APORT_API_BASE_URL || "https://api.aport.io",
    failClosed: true,
  })
);

// Add MCP enforcement middleware
app.use(
  mcpEnforcementMiddleware({
    enabled: true,
    strictMode: true,
    logViolations: true,
  })
);

// Example 1: Basic endpoint that logs MCP headers
app.post("/api/basic-mcp", (req, res) => {
  console.log("Agent ID:", req.agent?.agent_id);
  console.log("MCP Headers:", req.mcp);

  res.json({
    success: true,
    agent_id: req.agent?.agent_id,
    mcp_context: req.mcp,
  });
});

// Example 2: Custom MCP validation
app.post("/api/custom-mcp-validation", (req, res) => {
  const mcpHeaders = extractMCPHeaders(req);

  // Custom server validation
  if (mcpHeaders.server) {
    if (!isMCPServerAllowed(mcpHeaders.server, req.agent)) {
      return res.status(403).json({
        error: "mcp_denied",
        reason: "server_not_allowlisted",
        server: mcpHeaders.server,
        allowed_servers: req.agent.mcp?.servers || [],
      });
    }
  }

  // Custom tool validation
  if (mcpHeaders.tool) {
    if (!isMCPToolAllowed(mcpHeaders.tool, req.agent)) {
      return res.status(403).json({
        error: "mcp_denied",
        reason: "tool_not_allowlisted",
        tool: mcpHeaders.tool,
        allowed_tools: req.agent.mcp?.tools || [],
      });
    }
  }

  res.json({
    success: true,
    message: "MCP validation passed",
    validated_headers: mcpHeaders,
  });
});

// Example 3: Policy-specific MCP enforcement
const refundsRouter = express.Router();

// Apply payments.refund.v1 policy with MCP checks
refundsRouter.use(createMCPAwarePolicyMiddleware("payments.refund.v1"));

refundsRouter.post("/create", (req, res) => {
  const { amount, customer_id } = req.body;

  // This endpoint is protected by:
  // 1. Agent passport verification
  // 2. MCP allowlist checks (if headers present)
  // 3. payments.refund.v1 policy requirements

  console.log(`Processing refund: $${amount} for customer ${customer_id}`);
  console.log("MCP Context:", req.mcp);

  res.json({
    success: true,
    refund_id: "rf_" + Math.random().toString(36).substr(2, 9),
    amount,
    customer_id,
    processed_via_mcp: !!(req.mcp?.server || req.mcp?.tool),
  });
});

refundsRouter.get("/status/:refund_id", (req, res) => {
  res.json({
    refund_id: req.params.refund_id,
    status: "completed",
    mcp_session: req.mcp?.session,
  });
});

app.use("/api/refunds", refundsRouter);

// Example 4: Data export with MCP enforcement
const exportRouter = express.Router();

// Apply data.export.v1 policy with MCP checks
exportRouter.use(createMCPAwarePolicyMiddleware("data.export.v1"));

exportRouter.post("/csv", (req, res) => {
  const { table, filters, include_pii } = req.body;

  console.log(`Exporting ${table} with filters:`, filters);
  console.log("MCP Context:", req.mcp);

  // Simulate CSV export
  const csvData = `id,name,email\n1,John Doe,${
    include_pii ? "john@example.com" : "[REDACTED]"
  }\n`;

  res.json({
    success: true,
    export_id: "exp_" + Math.random().toString(36).substr(2, 9),
    format: "csv",
    rows: 1,
    mcp_tool_used: req.mcp?.tool,
    data: csvData,
  });
});

app.use("/api/export", exportRouter);

// Example 5: Health check (no MCP enforcement)
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    mcp_enforcement: "enabled",
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
  console.log(`   POST /api/custom-mcp-validation - Custom MCP validation`);
  console.log(`   POST /api/refunds/create - Refunds with policy + MCP`);
  console.log(`   POST /api/export/csv - Data export with policy + MCP`);
  console.log(`   GET /health - Health check (no auth required)`);
  console.log(``);
  console.log(`📦 Required headers:`);
  console.log(`   X-Agent-Passport-Id: your-agent-id`);
  console.log(`   X-MCP-Server: https://mcp.stripe.com (optional)`);
  console.log(`   X-MCP-Tool: stripe.refunds.create (optional)`);
  console.log(`   X-MCP-Session: session-id (optional)`);
});

// Example curl commands:
/*

# Basic MCP test
curl -X POST http://localhost:3000/api/basic-mcp \
  -H "Content-Type: application/json" \
  -H "X-Agent-Passport-Id: ap_your_agent_id" \
  -H "X-MCP-Server: https://mcp.stripe.com" \
  -H "X-MCP-Tool: stripe.refunds.create" \
  -H "X-MCP-Session: session_123" \
  -d '{"test": true}'

# Refund with MCP
curl -X POST http://localhost:3000/api/refunds/create \
  -H "Content-Type: application/json" \
  -H "X-Agent-Passport-Id: ap_your_agent_id" \
  -H "X-MCP-Server: https://mcp.stripe.com" \
  -H "X-MCP-Tool: stripe.refunds.create" \
  -d '{"amount": 100, "customer_id": "cust_123"}'

# Export with MCP
curl -X POST http://localhost:3000/api/export/csv \
  -H "Content-Type: application/json" \
  -H "X-Agent-Passport-Id: ap_your_agent_id" \
  -H "X-MCP-Server: https://mcp.notion.com" \
  -H "X-MCP-Tool: notion.pages.export" \
  -d '{"table": "users", "filters": {}, "include_pii": false}'

# Health check (no auth)
curl http://localhost:3000/health

*/
