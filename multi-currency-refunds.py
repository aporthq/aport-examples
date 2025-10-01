"""
Multi-Currency Refunds Example

Demonstrates how to handle refunds in any currency with proper validation
and security measures. No hardcoded currency or region restrictions.
"""

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from agent_passport import process_refund, create_refund_context, RefundContext, RefundPolicyConfig
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Multi-Currency Refunds API", version="1.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Your agent ID
AGENT_ID = "agents/ap_multi_currency_refund_agent"

@app.post("/api/refunds")
async def process_refund_endpoint(
    request: Request,
    amount_minor: int,
    currency: str,  # Any valid ISO 4217 currency code
    region: str,    # Any valid country/region code
    order_id: str,
    customer_id: str,
    reason_code: str,
    idempotency_key: str,
    order_currency: str = None,
    order_total_minor: int = None,
    already_refunded_minor: int = None,
    note: str = None,
    merchant_case_id: str = None
):
    """
    Multi-Currency Refund Endpoint
    
    Supports any valid ISO 4217 currency code and any region code.
    Uses the SDK directly for policy enforcement.
    """
    try:
        # Create refund context using SDK
        refund_context = RefundContext(
            order_id=order_id,
            customer_id=customer_id,
            amount_minor=amount_minor,
            currency=currency,
            region=region,
            reason_code=reason_code,
            idempotency_key=idempotency_key,
            order_currency=order_currency,
            order_total_minor=order_total_minor,
            already_refunded_minor=already_refunded_minor,
            note=note,
            merchant_case_id=merchant_case_id
        )

        # Process refund using SDK
        policy_result = await process_refund(
            refund_context, 
            RefundPolicyConfig(
                agent_id=AGENT_ID,
                fail_closed=True,
                log_violations=True
            )
        )

        if not policy_result.allowed:
            raise HTTPException(
                status_code=403,
                detail={
                    "success": False,
                    "error": policy_result.error.get("code", "refund_policy_violation") if policy_result.error else "refund_policy_violation",
                    "message": policy_result.error.get("message", "Refund request violates policy") if policy_result.error else "Refund request violates policy",
                    "reasons": policy_result.error.get("reasons", []) if policy_result.error else [],
                    "decision_id": policy_result.decision_id,
                    "remaining_daily_cap": policy_result.remaining_daily_cap
                }
            )

        # Log suspicious activity if detected (would need to check policy_result for suspicious flags)
        logger.info(f"Refund processed: {policy_result.refund_id}", {
            'amount_minor': amount_minor,
            'currency': currency,
            'region': region,
            'order_id': order_id,
            'customer_id': customer_id,
            'agent_id': AGENT_ID
        })

        return {
            "success": True,
            "refund_id": policy_result.refund_id,
            "amount_minor": amount_minor,
            "currency": currency,
            "region": region,
            "order_id": order_id,
            "customer_id": customer_id,
            "status": "processed",
            "decision_id": policy_result.decision_id,
            "remaining_daily_cap": policy_result.remaining_daily_cap,
            "expires_in": policy_result.expires_in
        }

    except HTTPException:
        raise
    except Exception as error:
        logger.error(f"Refund processing error: {error}")
        raise HTTPException(
            status_code=500,
            detail={"success": False, "error": "Internal server error"}
        )

@app.get("/api/currencies")
async def get_supported_currencies():
    """
    Get supported currencies (dynamic - no hardcoded list)
    """
    return {
        "message": "Any valid ISO 4217 currency code is supported",
        "examples": [
            "USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "CNY", "INR", "BRL", "MXN",
            "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN", "HRK", "RSD", "UAH",
            "RUB", "TRY", "ILS", "AED", "SAR", "QAR", "KWD", "BHD", "OMR", "JOD", "LBP",
            "EGP", "MAD", "TND", "DZD", "ZAR", "NGN", "KES", "GHS", "ETB", "KRW", "VND",
            "IDR", "THB", "MYR", "SGD", "PHP", "TWD", "HKD", "NZD", "ISK", "CLP", "COP",
            "ARS", "UYU", "PEN", "BOB", "PYG", "VES", "CRC", "GTQ", "HNL", "NIO", "PAB",
            "DOP", "JMD", "TTD", "BBD", "BZD", "XCD", "AWG", "ANG", "SRD", "GYD", "BMD",
            "KYD", "FKP", "SHP", "SBD", "VUV", "WST", "TOP", "FJD", "PGK"
        ],
        "note": "This is not an exhaustive list - any valid ISO 4217 code works"
    }

@app.get("/api/regions")
async def get_supported_regions():
    """
    Get supported regions (dynamic - no hardcoded list)
    """
    return {
        "message": "Any valid country/region code is supported",
        "examples": [
            "US", "CA", "GB", "DE", "FR", "IT", "ES", "NL", "BE", "AT", "CH", "SE", "NO",
            "DK", "FI", "PL", "CZ", "HU", "RO", "BG", "HR", "RS", "UA", "RU", "TR", "IL",
            "AE", "SA", "QA", "KW", "BH", "OM", "JO", "LB", "EG", "MA", "TN", "DZ", "ZA",
            "NG", "KE", "GH", "ET", "KR", "VN", "ID", "TH", "MY", "SG", "PH", "TW", "HK",
            "NZ", "IS", "CL", "CO", "AR", "UY", "PE", "BO", "PY", "VE", "CR", "GT", "HN",
            "NI", "PA", "DO", "JM", "TT", "BB", "BZ", "AG", "AW", "SR", "GY", "BM", "KY",
            "FK", "SH", "SB", "VU", "WS", "TO", "FJ", "PG"
        ],
        "note": "This is not an exhaustive list - any valid 2-4 character region code works"
    }

if __name__ == "__main__":
    import uvicorn
    print("Multi-Currency Refunds service starting...")
    print("Supports any valid ISO 4217 currency code and any region code")
    print("\nExample requests:")
    print("USD: curl -X POST http://localhost:8000/api/refunds \\")
    print("  -H 'Content-Type: application/json' \\")
    print("  -d '{\"amount_minor\": 5000, \"currency\": \"USD\", \"region\": \"US\", \"order_id\": \"ORD-001\", \"customer_id\": \"CUST-001\", \"reason_code\": \"customer_request\", \"idempotency_key\": \"key123\"}'")
    print("\nEUR: curl -X POST http://localhost:8000/api/refunds \\")
    print("  -H 'Content-Type: application/json' \\")
    print("  -d '{\"amount_minor\": 4250, \"currency\": \"EUR\", \"region\": \"DE\", \"order_id\": \"ORD-002\", \"customer_id\": \"CUST-002\", \"reason_code\": \"defective\", \"idempotency_key\": \"key456\"}'")
    print("\nJPY: curl -X POST http://localhost:8000/api/refunds \\")
    print("  -H 'Content-Type: application/json' \\")
    print("  -d '{\"amount_minor\": 15000, \"currency\": \"JPY\", \"region\": \"JP\", \"order_id\": \"ORD-003\", \"customer_id\": \"CUST-003\", \"reason_code\": \"not_as_described\", \"idempotency_key\": \"key789\"}'")
    
    uvicorn.run(app, host="0.0.0.0", port=8000)
