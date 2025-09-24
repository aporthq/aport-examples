/**
 * Multi-Currency Refunds Example
 *
 * Demonstrates how to handle refunds in any currency with proper validation
 * and security measures. No hardcoded currency or region restrictions.
 */

const express = require("express");
const {
  processRefund,
  createRefundContext,
  RefundContext,
  RefundPolicyConfig,
} = require("./sdk/node/dist/sdk/node/src/refunds.js");

const app = express();
app.use(express.json());

// Your agent ID
const AGENT_ID = "agents/ap_multi_currency_refund_agent";

/**
 * Multi-Currency Refund Endpoint
 *
 * Supports any valid ISO 4217 currency code and any region code.
 * The policy enforcement handles validation dynamically.
 */
app.post("/api/refunds", async (req, res) => {
  try {
    const {
      amount_minor,
      currency,
      region,
      order_id,
      customer_id,
      reason_code,
      idempotency_key,
      order_currency,
      order_total_minor,
      already_refunded_minor,
      note,
      merchant_case_id,
    } = req.body;

    // Create refund context using SDK
    const refundContext = {
      order_id,
      customer_id,
      amount_minor,
      currency,
      region,
      reason_code,
      idempotency_key,
      order_currency,
      order_total_minor,
      already_refunded_minor,
      note,
      merchant_case_id,
    };

    // Process refund using SDK
    const policyResult = await processRefund(refundContext, {
      agentId: AGENT_ID,
      failClosed: true,
      logViolations: true,
    });

    if (!policyResult.allowed) {
      return res.status(403).json({
        success: false,
        error: policyResult.error?.code || "refund_policy_violation",
        message:
          policyResult.error?.message || "Refund request violates policy",
        reasons: policyResult.error?.reasons || [],
        decision_id: policyResult.decision_id,
        remaining_daily_cap: policyResult.remaining_daily_cap,
      });
    }

    // Log successful refund
    console.log(`Refund processed: ${policyResult.refund_id}`, {
      amount_minor,
      currency,
      region,
      order_id,
      customer_id,
      agent_id: AGENT_ID,
    });

    res.json({
      success: true,
      refund_id: policyResult.refund_id,
      amount_minor,
      currency,
      region,
      order_id,
      customer_id,
      status: "processed",
      decision_id: policyResult.decision_id,
      remaining_daily_cap: policyResult.remaining_daily_cap,
      expires_in: policyResult.expires_in,
    });
  } catch (error) {
    console.error("Refund processing error:", error);
    res.status(500).json({
      success: false,
      error: "internal_server_error",
      message: "Internal server error",
    });
  }
});

/**
 * Get supported currencies (dynamic - no hardcoded list)
 */
app.get("/api/currencies", (req, res) => {
  res.json({
    message: "Any valid ISO 4217 currency code is supported",
    examples: [
      "USD",
      "EUR",
      "GBP",
      "JPY",
      "CAD",
      "AUD",
      "CHF",
      "CNY",
      "INR",
      "BRL",
      "MXN",
      "SEK",
      "NOK",
      "DKK",
      "PLN",
      "CZK",
      "HUF",
      "RON",
      "BGN",
      "HRK",
      "RSD",
      "UAH",
      "RUB",
      "TRY",
      "ILS",
      "AED",
      "SAR",
      "QAR",
      "KWD",
      "BHD",
      "OMR",
      "JOD",
      "LBP",
      "EGP",
      "MAD",
      "TND",
      "DZD",
      "ZAR",
      "NGN",
      "KES",
      "GHS",
      "ETB",
      "KRW",
      "VND",
      "IDR",
      "THB",
      "MYR",
      "SGD",
      "PHP",
      "TWD",
      "HKD",
      "NZD",
      "ISK",
      "CLP",
      "COP",
      "ARS",
      "UYU",
      "PEN",
      "BOB",
      "PYG",
      "VES",
      "CRC",
      "GTQ",
      "HNL",
      "NIO",
      "PAB",
      "DOP",
      "JMD",
      "TTD",
      "BBD",
      "BZD",
      "XCD",
      "AWG",
      "ANG",
      "SRD",
      "GYD",
      "BMD",
      "KYD",
      "FKP",
      "SHP",
      "SBD",
      "VUV",
      "WST",
      "TOP",
      "FJD",
      "PGK",
    ],
    note: "This is not an exhaustive list - any valid ISO 4217 code works",
  });
});

/**
 * Get supported regions (dynamic - no hardcoded list)
 */
app.get("/api/regions", (req, res) => {
  res.json({
    message: "Any valid country/region code is supported",
    examples: [
      "US",
      "CA",
      "GB",
      "DE",
      "FR",
      "IT",
      "ES",
      "NL",
      "BE",
      "AT",
      "CH",
      "SE",
      "NO",
      "DK",
      "FI",
      "PL",
      "CZ",
      "HU",
      "RO",
      "BG",
      "HR",
      "RS",
      "UA",
      "RU",
      "TR",
      "IL",
      "AE",
      "SA",
      "QA",
      "KW",
      "BH",
      "OM",
      "JO",
      "LB",
      "EG",
      "MA",
      "TN",
      "DZ",
      "ZA",
      "NG",
      "KE",
      "GH",
      "ET",
      "KR",
      "VN",
      "ID",
      "TH",
      "MY",
      "SG",
      "PH",
      "TW",
      "HK",
      "NZ",
      "IS",
      "CL",
      "CO",
      "AR",
      "UY",
      "PE",
      "BO",
      "PY",
      "VE",
      "CR",
      "GT",
      "HN",
      "NI",
      "PA",
      "DO",
      "JM",
      "TT",
      "BB",
      "BZ",
      "AG",
      "AW",
      "SR",
      "GY",
      "BM",
      "KY",
      "FK",
      "SH",
      "SB",
      "VU",
      "WS",
      "TO",
      "FJ",
      "PG",
    ],
    note: "This is not an exhaustive list - any valid 2-4 character region code works",
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Multi-Currency Refunds service running on port ${PORT}`);
  console.log("Supports any valid ISO 4217 currency code and any region code");
  console.log("\nExample requests:");
  console.log("USD: curl -X POST http://localhost:3000/api/refunds \\");
  console.log("  -H 'Content-Type: application/json' \\");
  console.log(
    '  -d \'{"amount_minor": 5000, "currency": "USD", "region": "US", "order_id": "ORD-001", "customer_id": "CUST-001", "reason_code": "customer_request", "idempotency_key": "key123"}\''
  );
  console.log("\nEUR: curl -X POST http://localhost:3000/api/refunds \\");
  console.log("  -H 'Content-Type: application/json' \\");
  console.log(
    '  -d \'{"amount_minor": 4250, "currency": "EUR", "region": "DE", "order_id": "ORD-002", "customer_id": "CUST-002", "reason_code": "defective", "idempotency_key": "key456"}\''
  );
  console.log("\nJPY: curl -X POST http://localhost:3000/api/refunds \\");
  console.log("  -H 'Content-Type: application/json' \\");
  console.log(
    '  -d \'{"amount_minor": 15000, "currency": "JPY", "region": "JP", "order_id": "ORD-003", "customer_id": "CUST-003", "reason_code": "not_as_described", "idempotency_key": "key789"}\''
  );
});
