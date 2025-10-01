/**
 * Complete Refunds v1 Policy Example
 * Demonstrates all features and edge cases
 */

const express = require("express");
const { requireRefundsPolicy } = require("../middleware/express/src/index");

const app = express();
app.use(express.json());

// Mock Agent ID for demonstration
const AGENT_ID = "agents/ap_complete_refund_agent";

// Complete Refund Endpoint with Policy Protection
app.post(
  "/refund",
  requireRefundsPolicy(AGENT_ID, {
    failClosed: true,
    logViolations: true,
    cacheTtl: 60,
  }),
  async (req, res) => {
    try {
      const {
        order_id,
        customer_id,
        amount_minor,
        currency,
        reason_code,
        region,
        idempotency_key,
        order_currency,
        order_total_minor,
        already_refunded_minor,
        note,
        merchant_case_id,
      } = req.body;

      // Policy is already verified by middleware
      const policyResult = req.policyResult;

      // Process the refund
      const refund_id = `ref_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      console.log(`Refund Processed: ${refund_id}`, {
        order_id,
        customer_id,
        amount_minor,
        currency,
        reason_code,
        region,
        decision_id: policyResult.evaluation.decision_id,
        remaining_daily_cap: policyResult.evaluation.remaining_daily_cap,
      });

      // Simulate refund processing
      const refund = {
        refund_id,
        order_id,
        customer_id,
        amount_minor,
        currency,
        reason_code,
        region,
        status: "processed",
        processed_at: new Date().toISOString(),
        decision_id: policyResult.evaluation.decision_id,
        remaining_daily_cap: policyResult.evaluation.remaining_daily_cap,
        expires_in: policyResult.evaluation.expires_in,
      };

      res.json({
        success: true,
        refund,
        policy_result: {
          decision_id: policyResult.evaluation.decision_id,
          remaining_daily_cap: policyResult.evaluation.remaining_daily_cap,
          expires_in: policyResult.evaluation.expires_in,
        },
      });
    } catch (error) {
      console.error("Refund processing error:", error);
      res.status(500).json({
        success: false,
        error: "refund_processing_error",
        message: "Failed to process refund",
      });
    }
  }
);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "refunds-v1-example",
    timestamp: new Date().toISOString(),
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Unhandled error:", error);
  res.status(500).json({
    success: false,
    error: "internal_server_error",
    message: "Internal server error",
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Refunds v1 Example Service running on port ${PORT}`);
  console.log("Protected by APort payments.refund.v1 policy pack");
  console.log("\n=== Test Examples ===\n");

  // Example 1: Valid refund
  console.log("1. Valid Refund (L2 assurance):");
  console.log(`curl -X POST http://localhost:${PORT}/refund \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{`);
  console.log(`    "order_id": "ORD-001",`);
  console.log(`    "customer_id": "CUST-001",`);
  console.log(`    "amount_minor": 7500,`);
  console.log(`    "currency": "USD",`);
  console.log(`    "reason_code": "customer_request",`);
  console.log(`    "region": "US",`);
  console.log(`    "idempotency_key": "test_key_001"`);
  console.log(`  }'\n`);

  // Example 2: High amount refund (L3 assurance)
  console.log("2. High Amount Refund (L3 assurance):");
  console.log(`curl -X POST http://localhost:${PORT}/refund \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{`);
  console.log(`    "order_id": "ORD-002",`);
  console.log(`    "customer_id": "CUST-002",`);
  console.log(`    "amount_minor": 25000,`);
  console.log(`    "currency": "USD",`);
  console.log(`    "reason_code": "defective",`);
  console.log(`    "region": "US",`);
  console.log(`    "idempotency_key": "test_key_002"`);
  console.log(`  }'\n`);

  // Example 3: Multi-currency refund
  console.log("3. Multi-Currency Refund (EUR):");
  console.log(`curl -X POST http://localhost:${PORT}/refund \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{`);
  console.log(`    "order_id": "ORD-003",`);
  console.log(`    "customer_id": "CUST-003",`);
  console.log(`    "amount_minor": 8500,`);
  console.log(`    "currency": "EUR",`);
  console.log(`    "reason_code": "not_as_described",`);
  console.log(`    "region": "EU",`);
  console.log(`    "idempotency_key": "test_key_003"`);
  console.log(`  }'\n`);

  // Example 4: Refund with order balance validation
  console.log("4. Refund with Order Balance Validation:");
  console.log(`curl -X POST http://localhost:${PORT}/refund \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{`);
  console.log(`    "order_id": "ORD-004",`);
  console.log(`    "customer_id": "CUST-004",`);
  console.log(`    "amount_minor": 3000,`);
  console.log(`    "currency": "USD",`);
  console.log(`    "reason_code": "duplicate",`);
  console.log(`    "region": "US",`);
  console.log(`    "idempotency_key": "test_key_004",`);
  console.log(`    "order_currency": "USD",`);
  console.log(`    "order_total_minor": 10000,`);
  console.log(`    "already_refunded_minor": 2000`);
  console.log(`  }'\n`);

  // Example 5: Invalid refund (missing required fields)
  console.log("5. Invalid Refund (Missing Required Fields):");
  console.log(`curl -X POST http://localhost:${PORT}/refund \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{`);
  console.log(`    "order_id": "ORD-005"`);
  console.log(`    // Missing required fields will be rejected`);
  console.log(`  }'\n`);

  // Example 6: Duplicate idempotency key
  console.log("6. Duplicate Idempotency Key (Should be rejected):");
  console.log(`curl -X POST http://localhost:${PORT}/refund \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{`);
  console.log(`    "order_id": "ORD-006",`);
  console.log(`    "customer_id": "CUST-006",`);
  console.log(`    "amount_minor": 1000,`);
  console.log(`    "currency": "USD",`);
  console.log(`    "reason_code": "customer_request",`);
  console.log(`    "region": "US",`);
  console.log(`    "idempotency_key": "duplicate_key"`);
  console.log(`  }'`);
  console.log(`// Run the same request again to test idempotency protection\n`);

  // Example 7: Cross-currency refund (should be rejected)
  console.log("7. Cross-Currency Refund (Should be rejected):");
  console.log(`curl -X POST http://localhost:${PORT}/refund \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{`);
  console.log(`    "order_id": "ORD-007",`);
  console.log(`    "customer_id": "CUST-007",`);
  console.log(`    "amount_minor": 5000,`);
  console.log(`    "currency": "USD",`);
  console.log(`    "order_currency": "EUR",`);
  console.log(`    "reason_code": "customer_request",`);
  console.log(`    "region": "US",`);
  console.log(`    "idempotency_key": "test_key_007"`);
  console.log(`  }'\n`);

  // Example 8: Health check
  console.log("8. Health Check:");
  console.log(`curl http://localhost:${PORT}/health\n`);

  console.log("=== Error Response Examples ===\n");
  console.log("Policy violations will return structured error responses:");
  console.log(
    JSON.stringify(
      {
        success: false,
        error: "daily_cap_exceeded",
        message:
          "Daily cap 50000 USD exceeded for USD; current 48000 + 5000 > 50000",
        reasons: [
          {
            code: "daily_cap_exceeded",
            message:
              "Daily cap 50000 USD exceeded for USD; current 48000 + 5000 > 50000",
          },
        ],
        decision_id: "dec_01HJ...8",
        remaining_daily_cap: {
          USD: 2000,
        },
      },
      null,
      2
    )
  );
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nShutting down gracefully...");
  process.exit(0);
});

module.exports = app;
