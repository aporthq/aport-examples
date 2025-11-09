"""
MCP (Model Context Protocol) Enforcement Example

✅ CURRENT STATUS:
- ✅ Passport MCP configuration is supported (passport.mcp.servers, passport.mcp.tools)
- ✅ Policy verification validates MCP against passport allowlist
- ✅ MCP context can be passed in policy verification requests
- ✅ Supports multiple MCP servers/tools per request (arrays)

This example demonstrates:
1. Extracting MCP headers from requests (application-level)
2. Passing MCP context to policy verification
3. Using arrays for multiple MCP servers/tools

ACTUAL SDK LOCATION: /sdk/python
ACTUAL MIDDLEWARE LOCATION: /middleware/fastapi
"""

import os
from typing import Optional, Dict, Any
from fastapi import FastAPI, Request, HTTPException, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Import APort SDK (actual location: /sdk/python)
# In production: pip install aporthq-sdk-python
from aporthq_sdk_python import APortClient, APortClientOptions, AportError

app = FastAPI(title="MCP Enforcement Example", version="1.0.0")

# Initialize APort client
client = APortClient(
    APortClientOptions(
        base_url=os.getenv("APORT_API_BASE_URL", "https://api.aport.io"),
        api_key=os.getenv("APORT_API_KEY"),
        timeout_ms=5000,
    )
)

# Request models
class RefundRequest(BaseModel):
    amount: int  # Amount in cents
    currency: str
    customer_id: str
    order_id: str
    reason_code: str = "customer_request"
    region: str = "US"
    idempotency_key: Optional[str] = None


class ExportRequest(BaseModel):
    table_name: str
    row_limit: int = 1000
    include_pii: bool = False


def extract_mcp_headers(request: Request) -> Dict[str, Any]:
    """
    Extract MCP headers from request.
    
    Supports both single values and arrays for multiple MCP servers/tools.
    Arrays are preferred for multiple MCP usage.
    """
    # Support array format (preferred): X-MCP-Servers, X-MCP-Tools
    servers_header = request.headers.get("X-MCP-Servers") or request.headers.get("X-MCP-Server")
    tools_header = request.headers.get("X-MCP-Tools") or request.headers.get("X-MCP-Tool")
    
    # Parse arrays if comma-separated, otherwise treat as single value
    servers = []
    if servers_header:
        servers = [s.strip() for s in servers_header.split(",")] if "," in servers_header else [servers_header]
    
    tools = []
    if tools_header:
        tools = [t.strip() for t in tools_header.split(",")] if "," in tools_header else [tools_header]
    
    return {
        "servers": servers,
        "tools": tools,
        "session": request.headers.get("X-MCP-Session"),
        # Backward compatibility: single values
        "server": servers[0] if servers else None,
        "tool": tools[0] if tools else None,
    }


async def validate_mcp_against_passport(
    agent_id: str, mcp_headers: Dict[str, Any]
) -> bool:
    """
    Validate MCP headers against passport allowlist.
    
    Validates ALL servers/tools in the request against passport allowlist.
    The verify endpoint also validates MCP context, but this provides
    early validation before making the API call.
    """
    try:
        # Get passport to check MCP allowlist
        passport = await client.get_passport_view(agent_id)
        allowed_servers = passport.get("mcp", {}).get("servers", [])
        allowed_tools = passport.get("mcp", {}).get("tools", [])

        # Validate all servers (array support)
        if mcp_headers.get("servers"):
            unauthorized_servers = [
                server for server in mcp_headers["servers"]
                if server not in allowed_servers
            ]
            if unauthorized_servers:
                raise HTTPException(
                    status_code=403,
                    detail={
                        "error": "mcp_server_not_allowed",
                        "message": f"MCP server(s) {', '.join(unauthorized_servers)} not in passport allowlist. "
                        f"Allowed servers: {', '.join(allowed_servers)}",
                    },
                )

        # Validate all tools (array support)
        if mcp_headers.get("tools"):
            unauthorized_tools = [
                tool for tool in mcp_headers["tools"]
                if tool not in allowed_tools
            ]
            if unauthorized_tools:
                raise HTTPException(
                    status_code=403,
                    detail={
                        "error": "mcp_tool_not_allowed",
                        "message": f"MCP tool(s) {', '.join(unauthorized_tools)} not in passport allowlist. "
                        f"Allowed tools: {', '.join(allowed_tools)}",
                    },
                )

        return True
    except AportError as e:
        raise HTTPException(
            status_code=e.status if hasattr(e, "status") else 500,
            detail={"error": "passport_fetch_failed", "message": str(e)},
        )


# Example 1: Basic endpoint that logs MCP headers
@app.post("/api/basic-mcp")
async def basic_mcp_endpoint(
    request: Request,
    x_agent_passport_id: Optional[str] = Header(None, alias="X-Agent-Passport-Id"),
):
    """Basic endpoint that demonstrates MCP header extraction."""
    if not x_agent_passport_id:
        raise HTTPException(
            status_code=401,
            detail={"error": "missing_agent_id", "message": "Agent ID is required"},
        )

    mcp_headers = extract_mcp_headers(request)

    # Validate MCP headers (application-level)
    # The verify endpoint also validates MCP, but this provides early validation
    if mcp_headers.get("servers") or mcp_headers.get("tools"):
        await validate_mcp_against_passport(x_agent_passport_id, mcp_headers)

    return {
        "success": True,
        "agent_id": x_agent_passport_id,
        "mcp_context": mcp_headers,
    }


# Example 2: Refund with MCP enforcement + policy verification
@app.post("/api/refunds/create")
async def create_refund(
    request: Request,
    refund_data: RefundRequest,
    x_agent_passport_id: Optional[str] = Header(None, alias="X-Agent-Passport-Id"),
):
    """
    Create a refund with policy and MCP enforcement.
    
    This endpoint is protected by:
    1. Agent passport verification (via policy verification)
    2. MCP allowlist checks (application-level, if headers present)
    3. finance.payment.refund.v1 policy requirements
    """
    if not x_agent_passport_id:
        raise HTTPException(
            status_code=401,
            detail={"error": "missing_agent_id", "message": "Agent ID is required"},
        )

    # Extract and validate MCP headers (application-level)
    mcp_headers = extract_mcp_headers(request)
    if mcp_headers.get("servers") or mcp_headers.get("tools"):
        await validate_mcp_against_passport(x_agent_passport_id, mcp_headers)

    try:
        # Policy verification (validates MCP against passport allowlist)
        # Use new API endpoint: /api/verify/policy/{pack_id}
        context = {
            "amount": refund_data.amount,
            "currency": refund_data.currency,
            "customer_id": refund_data.customer_id,
            "order_id": refund_data.order_id,
            "reason_code": refund_data.reason_code,
            "region": refund_data.region,
            "idempotency_key": refund_data.idempotency_key
            or f"refund_{request.headers.get('X-Request-ID', 'unknown')}",
        }
        
        # Include MCP context (arrays preferred, single values supported)
        if mcp_headers.get("servers"):
            context["mcp_servers"] = mcp_headers["servers"]
        if mcp_headers.get("tools"):
            context["mcp_tools"] = mcp_headers["tools"]
        # Backward compatibility: single values
        if mcp_headers.get("server"):
            context["mcp_server"] = mcp_headers["server"]
        if mcp_headers.get("tool"):
            context["mcp_tool"] = mcp_headers["tool"]
        if mcp_headers.get("session"):
            context["mcp_session"] = mcp_headers["session"]
        
        decision = await client.verify_policy(
            x_agent_passport_id,
            "finance.payment.refund.v1",
            context,
        )

        if not decision.allow:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "policy_violation",
                    "message": "Policy verification denied",
                    "decision_id": decision.decision_id,
                    "reasons": decision.reasons,
                },
            )

        print(
            f"Processing refund: ${refund_data.amount/100:.2f} {refund_data.currency} for {refund_data.customer_id}"
        )
        print(f"MCP Context: {mcp_headers}")

        # Process refund (your business logic here)
        import random
        import string

        refund_id = f"ref_{''.join(random.choices(string.ascii_lowercase + string.digits, k=9))}"

        return {
            "success": True,
            "refund_id": refund_id,
            "amount": refund_data.amount,
            "currency": refund_data.currency,
            "customer_id": refund_data.customer_id,
            "order_id": refund_data.order_id,
            "decision_id": decision.decision_id,
            "processed_via_mcp": bool(mcp_headers.get("servers") or mcp_headers.get("tools")),
            "mcp_servers": mcp_headers.get("servers", []),
            "mcp_tools": mcp_headers.get("tools", []),
            "mcp_session": mcp_headers.get("session"),
        }

    except AportError as e:
        raise HTTPException(
            status_code=e.status if hasattr(e, "status") else 500,
            detail={
                "error": "policy_verification_failed",
                "message": str(e),
                "decision_id": getattr(e, "decision_id", None),
            },
        )


# Example 3: Data export with MCP enforcement + policy verification
@app.post("/api/export/csv")
async def export_csv(
    request: Request,
    export_data: ExportRequest,
    x_agent_passport_id: Optional[str] = Header(None, alias="X-Agent-Passport-Id"),
):
    """Export data to CSV with policy and MCP enforcement."""
    if not x_agent_passport_id:
        raise HTTPException(
            status_code=401,
            detail={"error": "missing_agent_id", "message": "Agent ID is required"},
        )

    # Extract and validate MCP headers (application-level)
    mcp_headers = extract_mcp_headers(request)
    if mcp_headers.get("servers") or mcp_headers.get("tools"):
        await validate_mcp_against_passport(x_agent_passport_id, mcp_headers)

    try:
        # Policy verification (validates MCP against passport allowlist)
        context = {
            "table_name": export_data.table_name,
            "row_limit": export_data.row_limit,
            "include_pii": export_data.include_pii,
        }
        
        # Include MCP context (arrays preferred)
        if mcp_headers.get("servers"):
            context["mcp_servers"] = mcp_headers["servers"]
        if mcp_headers.get("tools"):
            context["mcp_tools"] = mcp_headers["tools"]
        if mcp_headers.get("server"):
            context["mcp_server"] = mcp_headers["server"]
        if mcp_headers.get("tool"):
            context["mcp_tool"] = mcp_headers["tool"]
        if mcp_headers.get("session"):
            context["mcp_session"] = mcp_headers["session"]
        
        decision = await client.verify_policy(
            x_agent_passport_id,
            "data.export.create.v1",
            context,
        )

        if not decision.allow:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "policy_violation",
                    "message": "Policy verification denied",
                    "decision_id": decision.decision_id,
                    "reasons": decision.reasons,
                },
            )

        print(f"Exporting {export_data.table_name} with limit: {export_data.row_limit}")
        print(f"MCP Context: {mcp_headers}")

        # Simulate CSV export
        email_value = "john@example.com" if export_data.include_pii else "[REDACTED]"
        csv_data = f"id,name,email\n1,John Doe,{email_value}\n"

        import random
        import string

        export_id = f"exp_{''.join(random.choices(string.ascii_lowercase + string.digits, k=9))}"

        return {
            "success": True,
            "export_id": export_id,
            "format": "csv",
            "rows": 1,
            "mcp_servers": mcp_headers.get("servers", []),
            "mcp_tools": mcp_headers.get("tools", []),
            "decision_id": decision.decision_id,
            "data": csv_data,
        }

    except AportError as e:
        raise HTTPException(
            status_code=e.status if hasattr(e, "status") else 500,
            detail={
                "error": "policy_verification_failed",
                "message": str(e),
            },
        )


# Example 4: Health check (no auth required)
@app.get("/health")
async def health_check():
    """Health check endpoint (bypasses all middleware)."""
    return {
        "status": "healthy",
        "timestamp": __import__("datetime").datetime.now().isoformat(),
        "mcp_enforcement": "enabled (validates MCP context in policy verification)",
    }


# Global exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Handle all exceptions with proper error responses."""
    print(f"Error: {exc}")

    if "MCP" in str(exc):
        return JSONResponse(
            status_code=403,
            content={"error": "mcp_enforcement_failed", "message": str(exc)},
        )

    if "Agent Passport" in str(exc) or "agent" in str(exc).lower():
        return JSONResponse(
            status_code=401,
            content={"error": "authentication_failed", "message": str(exc)},
        )

    return JSONResponse(
        status_code=500,
        content={"error": "internal_server_error", "message": "An unexpected error occurred"},
    )


if __name__ == "__main__":
    import uvicorn

    print("🚀 MCP-enabled FastAPI server starting...")
    print("📋 Try these endpoints:")
    print("   POST /api/basic-mcp - Basic MCP header logging")
    print("   POST /api/refunds/create - Refunds with policy + MCP")
    print("   POST /api/export/csv - Data export with policy + MCP")
    print("   GET /health - Health check (no auth required)")
    print("")
    print("📦 Required headers:")
    print("   X-Agent-Passport-Id: your-agent-id")
    print("   X-MCP-Servers: https://mcp.stripe.com,https://mcp.notion.com (optional, comma-separated)")
    print("   X-MCP-Tools: stripe.refunds.create,notion.pages.export (optional, comma-separated)")
    print("   X-MCP-Session: session-id (optional)")
    print("")
    print("   Alternative (single values, backward compatible):")
    print("   X-MCP-Server: https://mcp.stripe.com (optional)")
    print("   X-MCP-Tool: stripe.refunds.create (optional)")
    print("")
    print("✅ MCP validation: Policy verification validates MCP context against passport allowlist")
    print("   See MCP_PRIMER.md and MCP_MULTIPLE_SERVERS.md for details.")
    print("")
    print("📖 API docs available at: http://localhost:8000/docs")

    uvicorn.run(app, host="0.0.0.0", port=8000)

"""
Example curl commands:

# Basic MCP test (single server/tool)
curl -X POST http://localhost:8000/api/basic-mcp \
  -H "Content-Type: application/json" \
  -H "X-Agent-Passport-Id: ap_your_agent_id" \
  -H "X-MCP-Server: https://mcp.stripe.com" \
  -H "X-MCP-Tool: stripe.refunds.create" \
  -H "X-MCP-Session: session_123" \
  -d '{"test": true}'

# Basic MCP test (multiple servers/tools - preferred)
curl -X POST http://localhost:8000/api/basic-mcp \
  -H "Content-Type: application/json" \
  -H "X-Agent-Passport-Id: ap_your_agent_id" \
  -H "X-MCP-Servers: https://mcp.stripe.com,https://mcp.notion.com" \
  -H "X-MCP-Tools: stripe.refunds.create,notion.pages.export" \
  -H "X-MCP-Session: session_123" \
  -d '{"test": true}'

# Refund with MCP (single server/tool)
curl -X POST http://localhost:8000/api/refunds/create \
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
curl -X POST http://localhost:8000/api/refunds/create \
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
curl -X POST http://localhost:8000/api/export/csv \
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
curl http://localhost:8000/health
"""
