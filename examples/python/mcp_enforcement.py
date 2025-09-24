"""
MCP (Model Context Protocol) Enforcement Example

This example demonstrates how to use the Agent Passport middleware
with MCP header validation and allowlist enforcement in FastAPI.
"""

import os
from typing import Optional
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Import Agent Passport middleware components
from agent_passport_middleware import (
    AgentPassportMiddleware,
    MCPEnforcementMiddleware,
    MCPEnforcementConfig,
    AgentPassportMiddlewareOptions,
    extract_mcp_headers,
    is_mcp_server_allowed,
    is_mcp_tool_allowed,
    get_mcp_headers,
    has_mcp_headers,
    create_mcp_aware_policy_middleware
)

app = FastAPI(title="MCP Enforcement Example", version="1.0.0")

# Request models
class RefundRequest(BaseModel):
    amount: float
    customer_id: str

class ExportRequest(BaseModel):
    table: str
    filters: dict = {}
    include_pii: bool = False

# Configure Agent Passport middleware
options = AgentPassportMiddlewareOptions(
    base_url=os.getenv('APORT_API_BASE_URL', 'https://api.aport.io'),
    fail_closed=True,
    skip_paths=["/health", "/docs", "/openapi.json"]
)

# Add Agent Passport middleware first
app.add_middleware(AgentPassportMiddleware, options=options)

# Configure and add MCP enforcement middleware
mcp_config = MCPEnforcementConfig(
    enabled=True,
    strict_mode=True,
    log_violations=True
)
app.add_middleware(MCPEnforcementMiddleware, config=mcp_config)

# Example 1: Basic endpoint that logs MCP headers
@app.post("/api/basic-mcp")
async def basic_mcp_endpoint(request: Request, data: dict = {}):
    """Basic endpoint that demonstrates MCP header extraction."""
    agent = getattr(request.state, 'agent', None)
    mcp_headers = getattr(request.state, 'mcp', None)
    
    print(f"Agent ID: {getattr(agent, 'agent_id', 'None')}")
    print(f"MCP Headers: {mcp_headers.to_dict() if mcp_headers else 'None'}")
    
    return {
        "success": True,
        "agent_id": getattr(agent, 'agent_id', None),
        "mcp_context": mcp_headers.to_dict() if mcp_headers else None
    }

# Example 2: Custom MCP validation
@app.post("/api/custom-mcp-validation")
async def custom_mcp_validation(request: Request, data: dict = {}):
    """Endpoint with custom MCP validation logic."""
    agent = getattr(request.state, 'agent', None)
    mcp_headers = extract_mcp_headers(request)
    
    # Custom server validation
    if mcp_headers.server:
        if not is_mcp_server_allowed(mcp_headers.server, agent):
            allowed_servers = []
            if hasattr(agent, 'mcp') and agent.mcp:
                allowed_servers = getattr(agent.mcp, 'servers', [])
            
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "mcp_denied",
                    "reason": "server_not_allowlisted",
                    "server": mcp_headers.server,
                    "allowed_servers": allowed_servers
                }
            )
    
    # Custom tool validation
    if mcp_headers.tool:
        if not is_mcp_tool_allowed(mcp_headers.tool, agent):
            allowed_tools = []
            if hasattr(agent, 'mcp') and agent.mcp:
                allowed_tools = getattr(agent.mcp, 'tools', [])
            
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "mcp_denied",
                    "reason": "tool_not_allowlisted",
                    "tool": mcp_headers.tool,
                    "allowed_tools": allowed_tools
                }
            )
    
    return {
        "success": True,
        "message": "MCP validation passed",
        "validated_headers": mcp_headers.to_dict()
    }

# Example 3: Policy-specific MCP enforcement for refunds
refunds_policy_middleware = create_mcp_aware_policy_middleware('refunds.v1')

@app.middleware("http")
async def refunds_policy_handler(request: Request, call_next):
    """Apply refunds.v1 policy with MCP checks to refund endpoints."""
    if request.url.path.startswith("/api/refunds/"):
        return await refunds_policy_middleware(request, call_next)
    return await call_next(request)

@app.post("/api/refunds/create")
async def create_refund(request: Request, refund_data: RefundRequest):
    """
    Create a refund with policy and MCP enforcement.
    
    This endpoint is protected by:
    1. Agent passport verification
    2. MCP allowlist checks (if headers present)
    3. refunds.v1 policy requirements
    """
    agent = getattr(request.state, 'agent', None)
    mcp_headers = get_mcp_headers(request)
    
    print(f"Processing refund: ${refund_data.amount} for customer {refund_data.customer_id}")
    if mcp_headers:
        print(f"MCP Context: {mcp_headers.to_dict()}")
    
    refund_id = f"rf_{''.join(__import__('random').choices('abcdefghijklmnopqrstuvwxyz0123456789', k=9))}"
    
    return {
        "success": True,
        "refund_id": refund_id,
        "amount": refund_data.amount,
        "customer_id": refund_data.customer_id,
        "processed_via_mcp": has_mcp_headers(request)
    }

@app.get("/api/refunds/status/{refund_id}")
async def get_refund_status(request: Request, refund_id: str):
    """Get refund status with MCP session tracking."""
    mcp_headers = get_mcp_headers(request)
    
    return {
        "refund_id": refund_id,
        "status": "completed",
        "mcp_session": mcp_headers.session if mcp_headers else None
    }

# Example 4: Data export with MCP enforcement
export_policy_middleware = create_mcp_aware_policy_middleware('data_export.v1')

@app.middleware("http")
async def export_policy_handler(request: Request, call_next):
    """Apply data_export.v1 policy with MCP checks to export endpoints."""
    if request.url.path.startswith("/api/export/"):
        return await export_policy_middleware(request, call_next)
    return await call_next(request)

@app.post("/api/export/csv")
async def export_csv(request: Request, export_data: ExportRequest):
    """Export data to CSV with policy and MCP enforcement."""
    agent = getattr(request.state, 'agent', None)
    mcp_headers = get_mcp_headers(request)
    
    print(f"Exporting {export_data.table} with filters: {export_data.filters}")
    if mcp_headers:
        print(f"MCP Context: {mcp_headers.to_dict()}")
    
    # Simulate CSV export
    email_value = "john@example.com" if export_data.include_pii else "[REDACTED]"
    csv_data = f"id,name,email\n1,John Doe,{email_value}\n"
    
    export_id = f"exp_{''.join(__import__('random').choices('abcdefghijklmnopqrstuvwxyz0123456789', k=9))}"
    
    return {
        "success": True,
        "export_id": export_id,
        "format": "csv",
        "rows": 1,
        "mcp_tool_used": mcp_headers.tool if mcp_headers else None,
        "data": csv_data
    }

# Example 5: Health check (no MCP enforcement)
@app.get("/health")
async def health_check():
    """Health check endpoint (bypasses all middleware)."""
    return {
        "status": "healthy",
        "timestamp": __import__('datetime').datetime.now().isoformat(),
        "mcp_enforcement": "enabled"
    }

# Example 6: MCP header inspection endpoint
@app.get("/api/inspect-mcp")
async def inspect_mcp_headers(request: Request):
    """Inspect current MCP headers and agent allowlists."""
    agent = getattr(request.state, 'agent', None)
    mcp_headers = get_mcp_headers(request)
    
    agent_mcp_config = None
    if agent and hasattr(agent, 'mcp') and agent.mcp:
        agent_mcp_config = {
            'servers': getattr(agent.mcp, 'servers', []),
            'tools': getattr(agent.mcp, 'tools', [])
        }
    
    return {
        "has_mcp_headers": has_mcp_headers(request),
        "mcp_headers": mcp_headers.to_dict() if mcp_headers else None,
        "agent_id": getattr(agent, 'agent_id', None),
        "agent_mcp_allowlists": agent_mcp_config,
        "validation_status": {
            "server_allowed": (
                is_mcp_server_allowed(mcp_headers.server, agent) 
                if mcp_headers and mcp_headers.server else None
            ),
            "tool_allowed": (
                is_mcp_tool_allowed(mcp_headers.tool, agent) 
                if mcp_headers and mcp_headers.tool else None
            )
        }
    }

# Global exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Handle all exceptions with proper error responses."""
    print(f"Error: {exc}")
    
    if "MCP" in str(exc):
        return JSONResponse(
            status_code=403,
            content={
                "error": "mcp_enforcement_failed",
                "message": str(exc)
            }
        )
    
    if "Agent Passport" in str(exc):
        return JSONResponse(
            status_code=401,
            content={
                "error": "authentication_failed", 
                "message": str(exc)
            }
        )
    
    return JSONResponse(
        status_code=500,
        content={
            "error": "internal_server_error",
            "message": "An unexpected error occurred"
        }
    )

if __name__ == "__main__":
    import uvicorn
    
    print("🚀 MCP-enabled FastAPI server starting...")
    print("📋 Try these endpoints:")
    print("   POST /api/basic-mcp - Basic MCP header logging")
    print("   POST /api/custom-mcp-validation - Custom MCP validation") 
    print("   POST /api/refunds/create - Refunds with policy + MCP")
    print("   POST /api/export/csv - Data export with policy + MCP")
    print("   GET /api/inspect-mcp - Inspect MCP headers and allowlists")
    print("   GET /health - Health check (no auth required)")
    print("")
    print("📦 Required headers:")
    print("   X-Agent-Passport-Id: your-agent-id")
    print("   X-MCP-Server: https://mcp.stripe.com (optional)")
    print("   X-MCP-Tool: stripe.refunds.create (optional)")
    print("   X-MCP-Session: session-id (optional)")
    print("")
    print("📖 API docs available at: http://localhost:8000/docs")
    
    uvicorn.run(app, host="0.0.0.0", port=8000)

"""
Example curl commands:

# Basic MCP test
curl -X POST http://localhost:8000/api/basic-mcp \
  -H "Content-Type: application/json" \
  -H "X-Agent-Passport-Id: ap_your_agent_id" \
  -H "X-MCP-Server: https://mcp.stripe.com" \
  -H "X-MCP-Tool: stripe.refunds.create" \
  -H "X-MCP-Session: session_123" \
  -d '{"test": true}'

# Refund with MCP
curl -X POST http://localhost:8000/api/refunds/create \
  -H "Content-Type: application/json" \
  -H "X-Agent-Passport-Id: ap_your_agent_id" \
  -H "X-MCP-Server: https://mcp.stripe.com" \
  -H "X-MCP-Tool: stripe.refunds.create" \
  -d '{"amount": 100, "customer_id": "cust_123"}'

# Export with MCP  
curl -X POST http://localhost:8000/api/export/csv \
  -H "Content-Type: application/json" \
  -H "X-Agent-Passport-Id: ap_your_agent_id" \
  -H "X-MCP-Server: https://mcp.notion.com" \
  -H "X-MCP-Tool: notion.pages.export" \
  -d '{"table": "users", "filters": {}, "include_pii": false}'

# Inspect MCP headers
curl -X GET http://localhost:8000/api/inspect-mcp \
  -H "X-Agent-Passport-Id: ap_your_agent_id" \
  -H "X-MCP-Server: https://mcp.stripe.com" \
  -H "X-MCP-Tool: stripe.refunds.create"

# Health check (no auth)
curl http://localhost:8000/health
"""
