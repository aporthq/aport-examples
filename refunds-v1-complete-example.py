"""
Complete Refunds v1 Policy Example
Demonstrates all features and edge cases using FastAPI
"""

from fastapi import FastAPI, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import asyncio
from datetime import datetime
import uuid

from agent_passport_middleware import require_refunds_policy

app = FastAPI(
    title="Refunds v1 Example Service",
    description="Complete example demonstrating finance.payment.refund.v1 policy features",
    version="1.0.0"
)

# Mock Agent ID for demonstration
AGENT_ID = "agents/ap_complete_refund_agent"

# Pydantic models for request/response
class RefundRequest(BaseModel):
    order_id: str
    customer_id: str
    amount_minor: int
    currency: str
    reason_code: str
    region: str
    idempotency_key: str
    order_currency: Optional[str] = None
    order_total_minor: Optional[int] = None
    already_refunded_minor: Optional[int] = None
    note: Optional[str] = None
    merchant_case_id: Optional[str] = None

class RefundResponse(BaseModel):
    success: bool
    refund_id: Optional[str] = None
    order_id: Optional[str] = None
    customer_id: Optional[str] = None
    amount_minor: Optional[int] = None
    currency: Optional[str] = None
    reason_code: Optional[str] = None
    region: Optional[str] = None
    status: Optional[str] = None
    processed_at: Optional[str] = None
    decision_id: Optional[str] = None
    remaining_daily_cap: Optional[dict] = None
    expires_in: Optional[int] = None
    error: Optional[str] = None
    message: Optional[str] = None
    reasons: Optional[list] = None

# Complete Refund Endpoint with Policy Protection
@app.post("/refund", response_model=RefundResponse)
async def process_refund(
    request: RefundRequest,
    policy_result = Depends(require_refunds_policy(AGENT_ID, fail_closed=True, log_violations=True))
):
    """
    Process a refund request with finance.payment.refund.v1 policy protection.
    
    The policy is automatically enforced by the middleware dependency.
    If the request passes policy validation, process the refund.
    """
    try:
        # Policy is already verified by middleware
        # Process the refund
        refund_id = f"ref_{int(datetime.now().timestamp())}_{uuid.uuid4().hex[:8]}"
        
        print(f"Refund Processed: {refund_id}", {
            "order_id": request.order_id,
            "customer_id": request.customer_id,
            "amount_minor": request.amount_minor,
            "currency": request.currency,
            "reason_code": request.reason_code,
            "region": request.region,
            "decision_id": getattr(policy_result, 'evaluation', {}).get('decision_id'),
            "remaining_daily_cap": getattr(policy_result, 'evaluation', {}).get('remaining_daily_cap')
        })

        # Simulate refund processing
        refund = RefundResponse(
            success=True,
            refund_id=refund_id,
            order_id=request.order_id,
            customer_id=request.customer_id,
            amount_minor=request.amount_minor,
            currency=request.currency,
            reason_code=request.reason_code,
            region=request.region,
            status="processed",
            processed_at=datetime.now().isoformat(),
            decision_id=getattr(policy_result, 'evaluation', {}).get('decision_id'),
            remaining_daily_cap=getattr(policy_result, 'evaluation', {}).get('remaining_daily_cap'),
            expires_in=getattr(policy_result, 'evaluation', {}).get('expires_in')
        )

        return refund

    except Exception as error:
        print(f"Refund processing error: {error}")
        raise HTTPException(
            status_code=500,
            detail={
                "success": False,
                "error": "refund_processing_error",
                "message": "Failed to process refund"
            }
        )

# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "refunds-v1-example",
        "timestamp": datetime.now().isoformat()
    }

# Error handling
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    """Handle HTTP exceptions"""
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.detail
    )

@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    """Handle general exceptions"""
    print(f"Unhandled error: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": "internal_server_error",
            "message": "Internal server error"
        }
    )

# Example usage and test cases
def print_examples():
    """Print example curl commands for testing"""
    print("\n=== Refunds v1 Example Service ===")
    print("Service running with finance.payment.refund.v1 policy protection")
    print("\n=== Test Examples ===\n")
    
    # Example 1: Valid refund
    print("1. Valid Refund (L2 assurance):")
    print("curl -X POST http://localhost:8000/refund \\")
    print("  -H 'Content-Type: application/json' \\")
    print("  -d '{")
    print('    "order_id": "ORD-001",')
    print('    "customer_id": "CUST-001",')
    print('    "amount_minor": 7500,')
    print('    "currency": "USD",')
    print('    "reason_code": "customer_request",')
    print('    "region": "US",')
    print('    "idempotency_key": "test_key_001"')
    print("  }'\n")

    # Example 2: High amount refund (L3 assurance)
    print("2. High Amount Refund (L3 assurance):")
    print("curl -X POST http://localhost:8000/refund \\")
    print("  -H 'Content-Type: application/json' \\")
    print("  -d '{")
    print('    "order_id": "ORD-002",')
    print('    "customer_id": "CUST-002",')
    print('    "amount_minor": 25000,')
    print('    "currency": "USD",')
    print('    "reason_code": "defective",')
    print('    "region": "US",')
    print('    "idempotency_key": "test_key_002"')
    print("  }'\n")

    # Example 3: Multi-currency refund
    print("3. Multi-Currency Refund (EUR):")
    print("curl -X POST http://localhost:8000/refund \\")
    print("  -H 'Content-Type: application/json' \\")
    print("  -d '{")
    print('    "order_id": "ORD-003",')
    print('    "customer_id": "CUST-003",')
    print('    "amount_minor": 8500,')
    print('    "currency": "EUR",')
    print('    "reason_code": "not_as_described",')
    print('    "region": "EU",')
    print('    "idempotency_key": "test_key_003"')
    print("  }'\n")

    # Example 4: Refund with order balance validation
    print("4. Refund with Order Balance Validation:")
    print("curl -X POST http://localhost:8000/refund \\")
    print("  -H 'Content-Type: application/json' \\")
    print("  -d '{")
    print('    "order_id": "ORD-004",')
    print('    "customer_id": "CUST-004",')
    print('    "amount_minor": 3000,')
    print('    "currency": "USD",')
    print('    "reason_code": "duplicate",')
    print('    "region": "US",')
    print('    "idempotency_key": "test_key_004",')
    print('    "order_currency": "USD",')
    print('    "order_total_minor": 10000,')
    print('    "already_refunded_minor": 2000')
    print("  }'\n")

    # Example 5: Invalid refund (missing required fields)
    print("5. Invalid Refund (Missing Required Fields):")
    print("curl -X POST http://localhost:8000/refund \\")
    print("  -H 'Content-Type: application/json' \\")
    print("  -d '{")
    print('    "order_id": "ORD-005"')
    print("    // Missing required fields will be rejected")
    print("  }'\n")

    # Example 6: Duplicate idempotency key
    print("6. Duplicate Idempotency Key (Should be rejected):")
    print("curl -X POST http://localhost:8000/refund \\")
    print("  -H 'Content-Type: application/json' \\")
    print("  -d '{")
    print('    "order_id": "ORD-006",')
    print('    "customer_id": "CUST-006",')
    print('    "amount_minor": 1000,')
    print('    "currency": "USD",')
    print('    "reason_code": "customer_request",')
    print('    "region": "US",')
    print('    "idempotency_key": "duplicate_key"')
    print("  }'")
    print("// Run the same request again to test idempotency protection\n")

    # Example 7: Cross-currency refund (should be rejected)
    print("7. Cross-Currency Refund (Should be rejected):")
    print("curl -X POST http://localhost:8000/refund \\")
    print("  -H 'Content-Type: application/json' \\")
    print("  -d '{")
    print('    "order_id": "ORD-007",')
    print('    "customer_id": "CUST-007",')
    print('    "amount_minor": 5000,')
    print('    "currency": "USD",')
    print('    "order_currency": "EUR",')
    print('    "reason_code": "customer_request",')
    print('    "region": "US",')
    print('    "idempotency_key": "test_key_007"')
    print("  }'\n")

    # Example 8: Health check
    print("8. Health Check:")
    print("curl http://localhost:8000/health\n")

    print("=== Error Response Examples ===\n")
    print("Policy violations will return structured error responses:")
    print("""
{
  "success": false,
  "error": "daily_cap_exceeded",
  "message": "Daily cap 50000 USD exceeded for USD; current 48000 + 5000 > 50000",
  "reasons": [
    {
      "code": "daily_cap_exceeded",
      "message": "Daily cap 50000 USD exceeded for USD; current 48000 + 5000 > 50000"
    }
  ],
  "decision_id": "dec_01HJ...8",
  "remaining_daily_cap": {
    "USD": 2000
  }
}
    """)

if __name__ == "__main__":
    import uvicorn
    
    print_examples()
    
    uvicorn.run(
        "refunds_v1_complete_example:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
