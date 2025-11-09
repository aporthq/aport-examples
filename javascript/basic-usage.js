/**
 * Basic JavaScript/Node.js examples for The Passport for AI Agents
 */

const https = require("https");

// Configuration
const API_BASE_URL = process.env.API_URL || "https://api.aport.io";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "your-admin-token";

/**
 * Make HTTP request helper
 */
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const jsonData = JSON.parse(data);
          resolve({
            status: res.statusCode,
            data: jsonData,
            headers: res.headers,
          });
        } catch (e) {
          resolve({ status: res.statusCode, data: data, headers: res.headers });
        }
      });
    });

    req.on("error", reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

/**
 * Verify an agent passport
 */
async function verifyPassport(agentId) {
  console.log(`\n🔍 Verifying passport for agent: ${agentId}`);

  try {
    const response = await makeRequest(`${API_BASE_URL}/api/verify/${agentId}`);

    if (response.status === 200) {
      console.log("✅ Passport verified successfully:");
      console.log(JSON.stringify(response.data, null, 2));

      // Check rate limit headers
      console.log("\n📊 Rate Limit Info:");
      console.log(`Limit: ${response.headers["x-ratelimit-limit"]}`);
      console.log(`Remaining: ${response.headers["x-ratelimit-remaining"]}`);
      console.log(
        `Reset: ${new Date(
          parseInt(response.headers["x-ratelimit-reset"]) * 1000
        )}`
      );
    } else {
      console.log(`❌ Verification failed (${response.status}):`);
      console.log(JSON.stringify(response.data, null, 2));
    }
  } catch (error) {
    console.error("❌ Error verifying passport:", error.message);
  }
}

/**
 * Create a new agent passport
 */
async function createPassport(passportData) {
  console.log("\n📝 Creating new passport...");

  try {
    const response = await makeRequest(`${API_BASE_URL}/api/admin/create`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(passportData),
    });

    if (response.status === 201) {
      console.log("✅ Passport created successfully:");
      console.log(JSON.stringify(response.data, null, 2));
    } else {
      console.log(`❌ Creation failed (${response.status}):`);
      console.log(JSON.stringify(response.data, null, 2));
    }
  } catch (error) {
    console.error("❌ Error creating passport:", error.message);
  }
}

/**
 * List all agents (admin only)
 */
async function listAgents() {
  console.log("\n📋 Listing all agents...");

  try {
    const response = await makeRequest(`${API_BASE_URL}/api/admin/agents`, {
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
    });

    if (response.status === 200) {
      console.log("✅ Agents retrieved successfully:");
      console.log(JSON.stringify(response.data, null, 2));
    } else {
      console.log(`❌ Failed to list agents (${response.status}):`);
      console.log(JSON.stringify(response.data, null, 2));
    }
  } catch (error) {
    console.error("❌ Error listing agents:", error.message);
  }
}

/**
 * Update agent status
 */
async function updateAgentStatus(agentId, status, reason = "") {
  console.log(`\n🔄 Updating agent ${agentId} status to ${status}...`);

  try {
    const response = await makeRequest(`${API_BASE_URL}/api/admin/status`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent_id: agentId,
        status: status,
        reason: reason,
      }),
    });

    if (response.status === 200) {
      console.log("✅ Status updated successfully:");
      console.log(JSON.stringify(response.data, null, 2));
    } else {
      console.log(`❌ Status update failed (${response.status}):`);
      console.log(JSON.stringify(response.data, null, 2));
    }
  } catch (error) {
    console.error("❌ Error updating status:", error.message);
  }
}

/**
 * Verify a policy decision
 *
 * Note: Policy verification automatically verifies the passport - no need to call verifyPassport() first
 */
async function verifyPolicy(
  packId,
  agentId,
  policyId,
  context,
  idempotencyKey = null
) {
  console.log(`\n🛡️ Verifying policy: ${packId} for agent: ${agentId}`);

  try {
    const requestBody = {
      context: {
        agent_id: agentId,
        policy_id: policyId,
        context: context,
      },
    };

    if (idempotencyKey) {
      requestBody.context.idempotency_key = idempotencyKey;
    }

    const response = await makeRequest(
      `${API_BASE_URL}/api/verify/policy/${packId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (response.status === 200) {
      const decision = response.data.decision || {};
      console.log("✅ Policy verification successful:");
      console.log(`   Decision ID: ${decision.decision_id || "N/A"}`);
      console.log(`   Allowed: ${decision.allow || false}`);
      if (decision.reasons) {
        console.log(`   Reasons:`, JSON.stringify(decision.reasons, null, 2));
      }
      if (decision.assurance_level) {
        console.log(`   Assurance Level: ${decision.assurance_level}`);
      }
    } else {
      console.log(`❌ Policy verification failed (${response.status}):`);
      console.log(JSON.stringify(response.data, null, 2));
    }
  } catch (error) {
    console.error("❌ Error verifying policy:", error.message);
  }
}

/**
 * Get system metrics
 */
async function getMetrics() {
  console.log("\n📊 Getting system metrics...");

  try {
    const response = await makeRequest(`${API_BASE_URL}/api/metrics`, {
      headers: {
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
    });

    if (response.status === 200) {
      console.log("✅ Metrics retrieved successfully:");
      console.log(JSON.stringify(response.data, null, 2));
    } else {
      console.log(`❌ Failed to get metrics (${response.status}):`);
      console.log(JSON.stringify(response.data, null, 2));
    }
  } catch (error) {
    console.error("❌ Error getting metrics:", error.message);
  }
}

/**
 * Handle rate limiting with exponential backoff
 */
async function verifyWithRetry(agentId, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await makeRequest(
        `${API_BASE_URL}/api/verify/${agentId}`
      );

      if (response.status === 200) {
        return response.data;
      } else if (response.status === 429) {
        // Rate limited
        const retryAfter = response.data.retryAfter || Math.pow(2, attempt);
        console.log(
          `⏳ Rate limited. Retrying in ${retryAfter} seconds... (attempt ${attempt}/${maxRetries})`
        );

        if (attempt < maxRetries) {
          await new Promise((resolve) =>
            setTimeout(resolve, retryAfter * 1000)
          );
          continue;
        }
      }

      throw new Error(`Request failed with status ${response.status}`);
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      console.log(`⚠️ Attempt ${attempt} failed: ${error.message}`);
    }
  }
}

/**
 * Demonstrate capabilities and limits enforcement
 */
async function demonstrateCapabilitiesAndLimits(agentId) {
  console.log(
    `\n🔐 Demonstrating capabilities and limits for agent: ${agentId}`
  );

  try {
    const response = await makeRequest(`${API_BASE_URL}/api/verify/${agentId}`);

    if (response.status === 200) {
      const passport = response.data;
      console.log("✅ Passport retrieved successfully");

      // Check capabilities
      console.log("\n📋 Capabilities:");
      if (passport.capabilities && passport.capabilities.length > 0) {
        passport.capabilities.forEach((cap) => {
          console.log(
            `  - ${cap.id}${
              cap.params ? ` (params: ${JSON.stringify(cap.params)})` : ""
            }`
          );
        });
      } else {
        console.log("  No capabilities defined");
      }

      // Check limits
      console.log("\n⚖️ Limits:");
      if (passport.limits) {
        Object.entries(passport.limits).forEach(([key, value]) => {
          console.log(`  - ${key}: ${value}`);
        });
      } else {
        console.log("  No limits defined");
      }

      // Demonstrate enforcement examples
      console.log("\n🛡️ Enforcement Examples:");

      // Refund capability check
      if (
        passport.capabilities?.some(
          (cap) => cap.id === "finance.payment.refund"
        )
      ) {
        console.log("  ✅ Agent has refund capability");

        // Check refund limits
        if (passport.limits?.refund_amount_max_per_tx) {
          const refundAmount = 5000; // $50.00 in cents
          if (refundAmount <= passport.limits.refund_amount_max_per_tx) {
            console.log(
              `  ✅ Refund amount $${
                refundAmount / 100
              } is within per-transaction limit of $${
                passport.limits.refund_amount_max_per_tx / 100
              }`
            );
          } else {
            console.log(
              `  ❌ Refund amount $${
                refundAmount / 100
              } exceeds per-transaction limit of $${
                passport.limits.refund_amount_max_per_tx / 100
              }`
            );
          }
        }
      } else {
        console.log("  ❌ Agent does not have refund capability");
      }

      // Data export capability check
      if (passport.capabilities?.some((cap) => cap.id === "data.export")) {
        console.log("  ✅ Agent has data export capability");

        // Check export limits
        if (passport.limits?.max_export_rows) {
          const requestedRows = 5000;
          if (requestedRows <= passport.limits.max_export_rows) {
            console.log(
              `  ✅ Export request for ${requestedRows} rows is within limit of ${passport.limits.max_export_rows}`
            );
          } else {
            console.log(
              `  ❌ Export request for ${requestedRows} rows exceeds limit of ${passport.limits.max_export_rows}`
            );
          }
        }

        // Check PII access
        if (passport.limits?.allow_pii !== undefined) {
          console.log(
            `  ${passport.limits.allow_pii ? "✅" : "❌"} PII access is ${
              passport.limits.allow_pii ? "allowed" : "not allowed"
            }`
          );
        }
      } else {
        console.log("  ❌ Agent does not have data export capability");
      }

      // Messaging capability check
      if (passport.capabilities?.some((cap) => cap.id === "messaging.send")) {
        console.log("  ✅ Agent has messaging capability");

        // Check message rate limits
        if (passport.limits?.msgs_per_min) {
          console.log(
            `  ✅ Message rate limit: ${passport.limits.msgs_per_min} per minute`
          );
        }
        if (passport.limits?.msgs_per_day) {
          console.log(
            `  ✅ Daily message limit: ${passport.limits.msgs_per_day} per day`
          );
        }

        // Check channel allowlist
        const messagingCap = passport.capabilities.find(
          (cap) => cap.id === "messaging.send"
        );
        if (messagingCap?.params?.channels_allowlist) {
          console.log(
            `  ✅ Allowed channels: ${messagingCap.params.channels_allowlist.join(
              ", "
            )}`
          );
        }
        if (messagingCap?.params?.mention_policy) {
          console.log(
            `  ✅ Mention policy: ${messagingCap.params.mention_policy}`
          );
        }
      } else {
        console.log("  ❌ Agent does not have messaging capability");
      }

      // Repository PR creation capability check
      if (passport.capabilities?.some((cap) => cap.id === "repo.pr.create")) {
        console.log("  ✅ Agent has PR creation capability");

        if (passport.limits?.max_prs_per_day) {
          console.log(
            `  ✅ Daily PR limit: ${passport.limits.max_prs_per_day} per day`
          );
        }

        const prCap = passport.capabilities.find(
          (cap) => cap.id === "repo.pr.create"
        );
        if (prCap?.params?.allowed_repos) {
          console.log(
            `  ✅ Allowed repositories: ${prCap.params.allowed_repos.join(
              ", "
            )}`
          );
        }
        if (prCap?.params?.allowed_base_branches) {
          console.log(
            `  ✅ Allowed base branches: ${prCap.params.allowed_base_branches.join(
              ", "
            )}`
          );
        }
      } else {
        console.log("  ❌ Agent does not have PR creation capability");
      }

      // Repository merge capability check
      if (passport.capabilities?.some((cap) => cap.id === "repo.merge")) {
        console.log("  ✅ Agent has merge capability");

        if (passport.limits?.max_merges_per_day) {
          console.log(
            `  ✅ Daily merge limit: ${passport.limits.max_merges_per_day} per day`
          );
        }
        if (passport.limits?.max_pr_size_kb) {
          console.log(`  ✅ Max PR size: ${passport.limits.max_pr_size_kb} KB`);
        }

        const mergeCap = passport.capabilities.find(
          (cap) => cap.id === "repo.merge"
        );
        if (mergeCap?.params?.required_reviews) {
          console.log(
            `  ✅ Required reviews: ${mergeCap.params.required_reviews}`
          );
        }
        if (mergeCap?.params?.required_labels) {
          console.log(
            `  ✅ Required labels: ${mergeCap.params.required_labels.join(
              ", "
            )}`
          );
        }
      } else {
        console.log("  ❌ Agent does not have merge capability");
      }

      // Assurance level check
      if (passport.assurance_level) {
        console.log(`\n🛡️ Assurance Level: ${passport.assurance_level}`);
        console.log(`  Method: ${passport.assurance_method || "N/A"}`);
        console.log(`  Verified: ${passport.assurance_verified_at || "N/A"}`);

        // Example assurance requirements
        const requiredLevels = {
          refunds: "L2",
          payouts: "L3",
          admin: "L4KYC",
        };

        console.log("\n🔒 Route Access Requirements:");
        Object.entries(requiredLevels).forEach(([route, requiredLevel]) => {
          const hasAccess = compareAssuranceLevels(
            passport.assurance_level,
            requiredLevel
          );
          console.log(
            `  ${route}: ${
              hasAccess ? "✅" : "❌"
            } (requires ${requiredLevel}, has ${passport.assurance_level})`
          );
        });
      }

      // Taxonomy information
      if (passport.categories || passport.framework) {
        console.log("\n🏷️ Taxonomy:");
        if (passport.categories && passport.categories.length > 0) {
          console.log(`  Categories: ${passport.categories.join(", ")}`);
        }
        if (passport.framework && passport.framework.length > 0) {
          console.log(`  Frameworks: ${passport.framework.join(", ")}`);
        }
      }
    } else {
      console.log(`❌ Failed to retrieve passport (${response.status}):`);
      console.log(JSON.stringify(response.data, null, 2));
    }
  } catch (error) {
    console.error(
      "❌ Error demonstrating capabilities and limits:",
      error.message
    );
  }
}

/**
 * Simple assurance level comparison helper
 */
function compareAssuranceLevels(current, required) {
  const levels = ["L0", "L1", "L2", "L3", "L4KYC", "L4FIN"];
  const currentIndex = levels.indexOf(current);
  const requiredIndex = levels.indexOf(required);
  return currentIndex >= requiredIndex;
}

// Example usage
async function main() {
  console.log("🚀 The Passport for AI Agents - JavaScript Examples\n");

  // Verify existing passports
  await verifyPassport("ap_a2d10232c6534523812423eec8a1425c");
  await verifyPassport("ap_a2d10232c6534523812423eec8a1425c");

  // Demonstrate capabilities and limits enforcement
  await demonstrateCapabilitiesAndLimits("ap_a2d10232c6534523812423eec8a1425c");

  // Create a new passport
  const newPassport = {
    agent_id: "ap_js_example",
    owner: "JavaScript Example",
    role: "Tier-1",
    permissions: ["read:data", "create:reports"],
    limits: {
      api_calls_per_hour: 500,
      ticket_creation_daily: 25,
    },
    regions: ["US-CA"],
    status: "active",
    contact: "example@javascript.com",
    version: "1.0.0",
  };

  await createPassport(newPassport);

  // Create a passport with new capabilities
  const newCapabilitiesPassport = {
    agent_id: "ap_js_new_caps",
    owner: "JavaScript New Capabilities Example",
    role: "agent",
    capabilities: [
      {
        id: "messaging.send",
        params: {
          channels_allowlist: ["slack", "discord", "email"],
          mention_policy: "limited",
        },
      },
      {
        id: "repo.pr.create",
        params: {
          allowed_repos: ["company/public-repo", "company/docs"],
          allowed_base_branches: ["main", "develop"],
          path_allowlist: ["src/**", "docs/**"],
          max_files_changed: 20,
          max_total_added_lines: 500,
        },
      },
      {
        id: "repo.merge",
        params: {
          allowed_repos: ["company/public-repo"],
          allowed_base_branches: ["develop"],
          required_labels: ["approved", "tested"],
          required_reviews: 2,
        },
      },
    ],
    limits: {
      msgs_per_min: 30,
      msgs_per_day: 1000,
      max_prs_per_day: 10,
      max_merges_per_day: 5,
      max_pr_size_kb: 512,
    },
    regions: ["global"],
    status: "active",
    contact: "newcaps@javascript.com",
    version: "1.0.0",
  };

  await createPassport(newCapabilitiesPassport);

  // List all agents
  await listAgents();

  // Update agent status
  await updateAgentStatus("ap_js_example", "suspended", "Testing suspension");

  // Get metrics
  await getMetrics();

  // Example with rate limiting
  console.log("\n🔄 Testing rate limiting with retry...");
  try {
    const result = await verifyWithRetry("ap_a2d10232c6534523812423eec8a1425c");
    console.log("✅ Verification with retry successful:", result);
  } catch (error) {
    console.log("❌ Verification with retry failed:", error.message);
  }

  // Policy verification examples
  console.log("\n" + "=".repeat(60));
  console.log("🛡️ Policy Verification Examples");
  console.log("=".repeat(60));
  console.log("Note: Policy verification automatically verifies the passport");
  console.log("      No need to call verifyPassport() first\n");

  // Example 1: Refund policy verification
  console.log("Example 1: Refund policy verification");
  await verifyPolicy(
    "finance.payment.refund.v1",
    "ap_a2d10232c6534523812423eec8a1425c",
    "finance.payment.refund.v1",
    {
      amount: 5000, // $50.00 in cents
      currency: "USD",
      customer_id: "cust_123",
      reason: "Customer request",
    }
  );

  // Example 2: Data export policy verification
  console.log("\nExample 2: Data export policy verification");
  await verifyPolicy(
    "data.export.create.v1",
    "ap_a2d10232c6534523812423eec8a1425c",
    "data.export.create.v1",
    {
      table_name: "users",
      row_limit: 1000,
      include_pii: false,
    }
  );

  // Example 3: Repository merge policy verification
  console.log("\nExample 3: Repository merge policy verification");
  await verifyPolicy(
    "code.repository.merge.v1",
    "ap_a2d10232c6534523812423eec8a1425c",
    "code.repository.merge.v1",
    {
      repo: "company/my-repo",
      base_branch: "main",
      files_changed: 5,
      lines_added: 100,
      labels: ["approved", "tested"],
      reviews: 2,
    }
  );

  console.log("\n✨ Examples completed!");
}

// Run examples if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  verifyPassport,
  createPassport,
  listAgents,
  updateAgentStatus,
  getMetrics,
  verifyWithRetry,
  verifyPolicy,
};
