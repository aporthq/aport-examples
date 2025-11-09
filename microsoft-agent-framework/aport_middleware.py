"""
APort Middleware for Microsoft Agent Framework

This module provides middleware implementations for pre-action authorization
using APort with Microsoft Agent Framework.

Supports:
- Agent Run Middleware (function-based and class-based)
- Function Calling Middleware (for tool-level authorization)
- Proper error handling and audit trails
- Framework-compliant termination and result handling

Based on Microsoft Agent Framework middleware patterns:
https://learn.microsoft.com/en-us/agent-framework/user-guide/agents/agent-middleware
"""

import os
import logging
from typing import Callable, Awaitable, Dict, Any, Optional
from datetime import datetime

from aporthq_sdk_python import (
    APortClient,
    APortClientOptions,
    PolicyVerificationResponse,
    AportError,
)

# Type imports (adjust based on actual Microsoft Agent Framework types)
# These are placeholders - replace with actual imports when available
try:
    from agent_framework import AgentRunContext, FunctionInvocationContext
except ImportError:
    # Type stubs for development/documentation
    from typing import Protocol

    class AgentRunContext(Protocol):
        """Agent run context protocol."""
        messages: list
        metadata: Dict[str, Any]
        result: Any
        terminate: bool
        is_streaming: bool
        kwargs: Dict[str, Any]

    class FunctionInvocationContext(Protocol):
        """Function invocation context protocol."""
        function: Any
        arguments: Dict[str, Any]
        metadata: Dict[str, Any]
        result: Any
        terminate: bool
        kwargs: Dict[str, Any]

logger = logging.getLogger(__name__)


# ============================================================================
# Helper Functions
# ============================================================================

def extract_context_data(context: AgentRunContext) -> Dict[str, Any]:
    """
    Extract relevant context data for policy evaluation.
    
    Args:
        context: AgentRunContext from Microsoft Agent Framework
        
    Returns:
        Dictionary of context data for policy evaluation
    """
    return {
        "action": context.metadata.get("action", "unknown"),
        "resource": context.metadata.get("resource"),
        "amount": context.metadata.get("amount"),
        "currency": context.metadata.get("currency"),
        "region": context.metadata.get("region"),
        "customer_id": context.metadata.get("customer_id"),
        "order_id": context.metadata.get("order_id"),
        "timestamp": context.metadata.get("timestamp", datetime.utcnow().isoformat()),
        # Extract from messages if available
        "message_count": len(context.messages) if hasattr(context, "messages") else 0,
    }


def extract_function_context_data(context: FunctionInvocationContext) -> Dict[str, Any]:
    """
    Extract relevant context data from function invocation for policy evaluation.
    
    Args:
        context: FunctionInvocationContext from Microsoft Agent Framework
        
    Returns:
        Dictionary of context data for policy evaluation
    """
    # Extract from function arguments
    args = context.arguments if hasattr(context, "arguments") else {}
    
    return {
        "function_name": context.function.name if hasattr(context.function, "name") else "unknown",
        "action": context.metadata.get("action", "unknown"),
        **args,  # Include all function arguments
        "timestamp": context.metadata.get("timestamp", datetime.utcnow().isoformat()),
    }


async def generate_audit_trail(
    client: APortClient,
    agent_id: str,
    context: AgentRunContext,
    decision: Optional[PolicyVerificationResponse] = None,
) -> None:
    """
    Generate audit trail for agent execution.
    
    Args:
        client: APort client instance
        agent_id: Agent passport ID
        context: AgentRunContext with execution details
        decision: Optional policy decision for audit
    """
    try:
        audit_data = {
            "agent_id": agent_id,
            "action": context.metadata.get("action", "unknown"),
            "policy_id": context.metadata.get("policy_id"),
            "decision_id": decision.decision_id if decision else context.metadata.get("aport_decision", {}).get("decision_id"),
            "timestamp": datetime.utcnow().isoformat(),
            "terminated": context.terminate,
            "message_count": len(context.messages) if hasattr(context, "messages") else 0,
        }
        
        # Log audit trail (in production, send to audit service)
        logger.info(f"Audit trail: {audit_data}")
        
        # Note: When audit trail API is available, use:
        # await client.create_audit_trail(audit_data)
        
    except Exception as e:
        logger.error(f"Failed to generate audit trail: {e}", exc_info=True)


# ============================================================================
# Function-Based Agent Run Middleware
# ============================================================================

async def aport_agent_middleware(
    context: AgentRunContext,
    next: Callable[[AgentRunContext], Awaitable[None]],
) -> None:
    """
    APort agent run middleware for pre-execution authorization.
    
    This middleware:
    1. Verifies agent passport before execution
    2. Enforces policy if policy_id is provided
    3. Terminates execution if authorization fails
    4. Stores decision metadata for audit trails
    5. Generates audit trail after successful execution
    
    Usage:
        from aport_middleware import aport_agent_middleware
        
        agent = AzureAIAgentClient(...).create_agent(
            middleware=[aport_agent_middleware],
            ...
        )
    
    Args:
        context: AgentRunContext from Microsoft Agent Framework
        next: Next middleware or agent execution callable
    """
    # Initialize APort client
    client = APortClient(
        APortClientOptions(
            base_url=os.getenv("APORT_API_URL", "https://api.aport.io"),
            api_key=os.getenv("APORT_API_KEY"),  # Optional for public endpoints
            timeout_ms=int(os.getenv("APORT_TIMEOUT_MS", "800")),
        )
    )
    
    try:
        # Extract agent ID from metadata
        agent_id = context.metadata.get("agent_id") or context.metadata.get("agent_passport_id")
        
        if not agent_id:
            # Fail closed - terminate execution if no agent ID provided
            logger.warning("Agent ID missing in context metadata")
            context.terminate = True
            # Set proper result format for Microsoft Agent Framework
            if not context.is_streaming:
                from agent_framework import AgentRunResponse, ChatMessage, Role
                context.result = AgentRunResponse(
                    messages=[
                        ChatMessage(
                            role=Role.ASSISTANT,
                            text="Authorization failed: Agent ID is required. Please provide 'agent_id' in metadata."
                        )
                    ]
                )
            else:
                # For streaming, set error in metadata
                context.metadata["error"] = "missing_agent_id"
                context.metadata["error_message"] = "Agent ID is required for authorization"
            return
        
        # Extract policy ID from metadata
        policy_id = context.metadata.get("policy_id")
        decision: Optional[PolicyVerificationResponse] = None
        
        if policy_id:
            # Policy verification includes passport verification automatically
            try:
                decision = await client.verify_policy(
                    agent_id=agent_id,
                    policy_id=policy_id,
                    context=extract_context_data(context),
                    idempotency_key=context.metadata.get("idempotency_key"),
                )
                
                # Store decision in metadata for audit trail
                context.metadata["aport_decision"] = {
                    "decision_id": decision.decision_id,
                    "allow": decision.allow,
                    "assurance_level": decision.assurance_level,
                    "reasons": decision.reasons,
                }
                
                if not decision.allow:
                    # Policy violation - terminate execution
                    logger.warning(
                        f"Policy violation for agent {agent_id}: "
                        f"decision_id={decision.decision_id}, reasons={decision.reasons}"
                    )
                    context.terminate = True
                    
                    # Set proper error response
                    if not context.is_streaming:
                        try:
                            from agent_framework import AgentRunResponse, ChatMessage, Role
                            reasons_list = []
                            for r in (decision.reasons or []):
                                if isinstance(r, dict):
                                    reasons_list.append(r.get("message", r.get("code", "")))
                                else:
                                    reasons_list.append(str(r))
                            reasons_text = ", ".join(reasons_list)
                            context.result = AgentRunResponse(
                                messages=[
                                    ChatMessage(
                                        role=Role.ASSISTANT,
                                        text=f"Authorization denied: {reasons_text or 'Policy check failed'}. "
                                             f"Decision ID: {decision.decision_id}"
                                    )
                                ]
                            )
                        except ImportError:
                            # Fallback if framework types not available
                            context.result = {
                                "error": "policy_violation",
                                "decision_id": decision.decision_id,
                                "reasons": decision.reasons,
                                "message": f"Authorization denied: Decision ID {decision.decision_id}"
                            }
                    else:
                        context.metadata["error"] = "policy_violation"
                        context.metadata["error_message"] = f"Policy violation: {decision.reasons}"
                    
                    return
                    
            except AportError as e:
                # APort API error - terminate execution
                logger.error(f"APort API error: {e}", exc_info=True)
                context.terminate = True
                
                if not context.is_streaming:
                    try:
                        from agent_framework import AgentRunResponse, ChatMessage, Role
                        context.result = AgentRunResponse(
                            messages=[
                                ChatMessage(
                                    role=Role.ASSISTANT,
                                    text=f"Authorization failed: {str(e)}. "
                                         f"Decision ID: {getattr(e, 'decision_id', 'unknown')}"
                                )
                            ]
                        )
                    except ImportError:
                        context.result = {
                            "error": "agent_verification_failed",
                            "status": getattr(e, "status", None),
                            "message": str(e),
                            "decision_id": getattr(e, "decision_id", None),
                        }
                else:
                    context.metadata["error"] = "agent_verification_failed"
                    context.metadata["error_message"] = str(e)
                
                return
        else:
            # Only verify passport if no policy specified
            try:
                passport_view = await client.get_passport_view(agent_id)
                context.metadata["agent_passport"] = passport_view
                logger.info(f"Passport verified for agent {agent_id}")
            except AportError as e:
                logger.error(f"Passport verification failed: {e}", exc_info=True)
                context.terminate = True
                
                if not context.is_streaming:
                    try:
                        from agent_framework import AgentRunResponse, ChatMessage, Role
                        context.result = AgentRunResponse(
                            messages=[
                                ChatMessage(
                                    role=Role.ASSISTANT,
                                    text=f"Agent verification failed: {str(e)}"
                                )
                            ]
                        )
                    except ImportError:
                        context.result = {
                            "error": "agent_verification_failed",
                            "message": str(e),
                        }
                else:
                    context.metadata["error"] = "agent_verification_failed"
                    context.metadata["error_message"] = str(e)
                
                return
        
        # Continue to next middleware or agent execution
        await next(context)
        
        # Generate audit trail after successful execution
        if context.result and not context.terminate:
            await generate_audit_trail(client, agent_id, context, decision)
            
    except Exception as e:
        # Unexpected error - terminate execution
        logger.error(f"Unexpected error in APort middleware: {e}", exc_info=True)
        context.terminate = True
        
        if not context.is_streaming:
            try:
                from agent_framework import AgentRunResponse, ChatMessage, Role
                context.result = AgentRunResponse(
                    messages=[
                        ChatMessage(
                            role=Role.ASSISTANT,
                            text=f"Authorization error: {str(e)}"
                        )
                    ]
                )
            except ImportError:
                context.result = {
                    "error": "internal_error",
                    "message": f"Authorization failed: {str(e)}"
                }
        else:
            context.metadata["error"] = "internal_error"
            context.metadata["error_message"] = f"Authorization failed: {str(e)}"
    
    finally:
        # Clean up client resources
        await client.close()


# ============================================================================
# Function-Based Function Calling Middleware
# ============================================================================

async def aport_function_middleware(
    context: FunctionInvocationContext,
    next: Callable[[FunctionInvocationContext], Awaitable[None]],
) -> None:
    """
    APort function calling middleware for tool-level authorization.
    
    This middleware:
    1. Verifies authorization before each function/tool call
    2. Maps function names to policy IDs
    3. Terminates function call if authorization fails
    4. Stores decision metadata for audit trails
    
    Usage:
        from aport_middleware import aport_function_middleware
        
        agent = AzureAIAgentClient(...).create_agent(
            middleware=[aport_function_middleware],  # Function middleware
            ...
        )
    
    Args:
        context: FunctionInvocationContext from Microsoft Agent Framework
        next: Next middleware or function execution callable
    """
    # Initialize APort client
    client = APortClient(
        APortClientOptions(
            base_url=os.getenv("APORT_API_URL", "https://api.aport.io"),
            api_key=os.getenv("APORT_API_KEY"),
            timeout_ms=int(os.getenv("APORT_TIMEOUT_MS", "800")),
        )
    )
    
    try:
        # Extract agent ID from metadata
        agent_id = context.metadata.get("agent_id") or context.metadata.get("agent_passport_id")
        
        if not agent_id:
            logger.warning("Agent ID missing in function context")
            context.terminate = True
            context.result = {
                "error": "missing_agent_id",
                "message": "Agent ID is required for function authorization"
            }
            return
        
        # Map function name to policy ID
        # This can be configured via metadata or a mapping function
        function_name = context.function.name if hasattr(context.function, "name") else "unknown"
        policy_id = context.metadata.get("policy_id") or context.metadata.get(
            f"policy_{function_name}"
        ) or _default_policy_mapping(function_name)
        
        if not policy_id:
            logger.warning(f"No policy ID found for function {function_name}")
            # Continue without authorization if no policy specified
            await next(context)
            return
        
        # Verify authorization for this function call
        try:
            decision = await client.verify_policy(
                agent_id=agent_id,
                policy_id=policy_id,
                context=extract_function_context_data(context),
                idempotency_key=context.metadata.get("idempotency_key"),
            )
            
            # Store decision in metadata
            context.metadata["aport_decision"] = {
                "decision_id": decision.decision_id,
                "allow": decision.allow,
                "function_name": function_name,
                "policy_id": policy_id,
            }
            
            if not decision.allow:
                # Authorization denied - terminate function call
                logger.warning(
                    f"Function {function_name} denied for agent {agent_id}: "
                    f"decision_id={decision.decision_id}"
                )
                context.terminate = True
                context.result = {
                    "error": "authorization_denied",
                    "decision_id": decision.decision_id,
                    "reasons": decision.reasons,
                    "function_name": function_name,
                }
                return
                
        except AportError as e:
            logger.error(f"APort API error in function middleware: {e}", exc_info=True)
            context.terminate = True
            context.result = {
                "error": "authorization_failed",
                "message": str(e),
                "function_name": function_name,
            }
            return
        
        # Continue to function execution
        await next(context)
        
    except Exception as e:
        logger.error(f"Unexpected error in function middleware: {e}", exc_info=True)
        context.terminate = True
        context.result = {
            "error": "internal_error",
            "message": f"Authorization failed: {str(e)}"
        }
    
    finally:
        await client.close()


def _default_policy_mapping(function_name: str) -> Optional[str]:
    """
    Default mapping from function names to policy IDs.
    
    Args:
        function_name: Name of the function being called
        
    Returns:
        Policy ID or None if no mapping found
    """
    # Common function name to policy ID mappings
    policy_map = {
        "execute_refund": "finance.payment.refund.v1",
        "process_refund": "finance.payment.refund.v1",
        "refund": "finance.payment.refund.v1",
        "export_data": "data.export.create.v1",
        "create_export": "data.export.create.v1",
        "merge_pull_request": "code.repository.merge.v1",
        "deploy": "code.deployment.create.v1",
        "send_message": "messaging.message.send.v1",
    }
    
    return policy_map.get(function_name.lower())


# ============================================================================
# Class-Based Agent Run Middleware
# ============================================================================

class AportAgentMiddleware:
    """
    Class-based APort agent middleware for stateful operations.
    
    This class-based approach is useful when you need:
    - Stateful middleware (e.g., connection pooling, caching)
    - Dependency injection
    - Complex initialization logic
    - Reusable middleware instances
    
    Usage:
        from aport_middleware import AportAgentMiddleware
        
        middleware = AportAgentMiddleware(
            api_key=os.getenv("APORT_API_KEY"),
            base_url=os.getenv("APORT_API_URL", "https://api.aport.io"),
        )
        
        agent = AzureAIAgentClient(...).create_agent(
            middleware=[middleware.process],  # Use process method
            ...
        )
    """
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "https://api.aport.io",
        timeout_ms: int = 800,
    ):
        """
        Initialize APort agent middleware.
        
        Args:
            api_key: APort API key (optional for public endpoints)
            base_url: APort API base URL
            timeout_ms: Request timeout in milliseconds
        """
        self.client_options = APortClientOptions(
            base_url=base_url,
            api_key=api_key or os.getenv("APORT_API_KEY"),
            timeout_ms=timeout_ms,
        )
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
    
    async def process(
        self,
        context: AgentRunContext,
        next: Callable[[AgentRunContext], Awaitable[None]],
    ) -> None:
        """
        Process agent run with APort authorization.
        
        This method has the same signature and behavior as the function-based
        middleware, but allows for stateful operations and dependency injection.
        
        Args:
            context: AgentRunContext from Microsoft Agent Framework
            next: Next middleware or agent execution callable
        """
        async with APortClient(self.client_options) as client:
            try:
                agent_id = context.metadata.get("agent_id") or context.metadata.get("agent_passport_id")
                
                if not agent_id:
                    self.logger.warning("Agent ID missing in context metadata")
                context.terminate = True
                if not context.is_streaming:
                    try:
                        from agent_framework import AgentRunResponse, ChatMessage, Role
                        context.result = AgentRunResponse(
                            messages=[
                                ChatMessage(
                                    role=Role.ASSISTANT,
                                    text="Authorization failed: Agent ID is required."
                                )
                            ]
                        )
                    except ImportError:
                        context.result = {
                            "error": "missing_agent_id",
                            "message": "Agent ID is required for authorization"
                        }
                return
                
                policy_id = context.metadata.get("policy_id")
                decision: Optional[PolicyVerificationResponse] = None
                
                if policy_id:
                    decision = await client.verify_policy(
                        agent_id=agent_id,
                        policy_id=policy_id,
                        context=extract_context_data(context),
                        idempotency_key=context.metadata.get("idempotency_key"),
                    )
                    
                    context.metadata["aport_decision"] = {
                        "decision_id": decision.decision_id,
                        "allow": decision.allow,
                        "assurance_level": decision.assurance_level,
                    }
                    
                    if not decision.allow:
                        self.logger.warning(
                            f"Policy violation: decision_id={decision.decision_id}"
                        )
                        context.terminate = True
                        if not context.is_streaming:
                            try:
                                from agent_framework import AgentRunResponse, ChatMessage, Role
                                reasons_text = ", ".join(
                                    [r.get("message", "") for r in (decision.reasons or [])]
                                    if isinstance(decision.reasons, list) and decision.reasons
                                    else []
                                )
                                context.result = AgentRunResponse(
                                    messages=[
                                        ChatMessage(
                                            role=Role.ASSISTANT,
                                            text=f"Authorization denied: {reasons_text or 'Policy check failed'}"
                                        )
                                    ]
                                )
                            except ImportError:
                                context.result = {
                                    "error": "policy_violation",
                                    "decision_id": decision.decision_id,
                                    "reasons": decision.reasons,
                                }
                        return
                
                await next(context)
                
                if context.result and not context.terminate:
                    await generate_audit_trail(client, agent_id, context, decision)
                    
            except AportError as e:
                self.logger.error(f"APort API error: {e}", exc_info=True)
                context.terminate = True
                if not context.is_streaming:
                    try:
                        from agent_framework import AgentRunResponse, ChatMessage, Role
                        context.result = AgentRunResponse(
                            messages=[
                                ChatMessage(
                                    role=Role.ASSISTANT,
                                    text=f"Authorization failed: {str(e)}"
                                )
                            ]
                        )
                    except ImportError:
                        context.result = {
                            "error": "agent_verification_failed",
                            "message": str(e),
                        }
            except Exception as e:
                self.logger.error(f"Unexpected error: {e}", exc_info=True)
                context.terminate = True
                if not context.is_streaming:
                    try:
                        from agent_framework import AgentRunResponse, ChatMessage, Role
                        context.result = AgentRunResponse(
                            messages=[
                                ChatMessage(
                                    role=Role.ASSISTANT,
                                    text=f"Authorization error: {str(e)}"
                                )
                            ]
                        )
                    except ImportError:
                        context.result = {
                            "error": "internal_error",
                            "message": f"Authorization failed: {str(e)}"
                        }


# ============================================================================
# Class-Based Function Calling Middleware
# ============================================================================

class AportFunctionMiddleware:
    """
    Class-based APort function calling middleware.
    
    Useful for stateful function-level authorization with connection pooling
    or caching.
    
    Usage:
        from aport_middleware import AportFunctionMiddleware
        
        middleware = AportFunctionMiddleware(
            api_key=os.getenv("APORT_API_KEY"),
        )
        
        agent = AzureAIAgentClient(...).create_agent(
            middleware=[middleware.process],  # Function middleware
            ...
        )
    """
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "https://api.aport.io",
        timeout_ms: int = 800,
        policy_mapping: Optional[Dict[str, str]] = None,
    ):
        """
        Initialize APort function middleware.
        
        Args:
            api_key: APort API key
            base_url: APort API base URL
            timeout_ms: Request timeout in milliseconds
            policy_mapping: Custom function name to policy ID mapping
        """
        self.client_options = APortClientOptions(
            base_url=base_url,
            api_key=api_key or os.getenv("APORT_API_KEY"),
            timeout_ms=timeout_ms,
        )
        self.policy_mapping = policy_mapping or {}
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
    
    async def process(
        self,
        context: FunctionInvocationContext,
        next: Callable[[FunctionInvocationContext], Awaitable[None]],
    ) -> None:
        """
        Process function call with APort authorization.
        
        Args:
            context: FunctionInvocationContext from Microsoft Agent Framework
            next: Next middleware or function execution callable
        """
        async with APortClient(self.client_options) as client:
            try:
                agent_id = context.metadata.get("agent_id") or context.metadata.get("agent_passport_id")
                
                if not agent_id:
                    self.logger.warning("Agent ID missing in function context")
                    context.terminate = True
                    context.result = {"error": "missing_agent_id"}
                    return
                
                function_name = context.function.name if hasattr(context.function, "name") else "unknown"
                policy_id = (
                    context.metadata.get("policy_id") or
                    context.metadata.get(f"policy_{function_name}") or
                    self.policy_mapping.get(function_name) or
                    _default_policy_mapping(function_name)
                )
                
                if not policy_id:
                    # Continue without authorization
                    await next(context)
                    return
                
                decision = await client.verify_policy(
                    agent_id=agent_id,
                    policy_id=policy_id,
                    context=extract_function_context_data(context),
                    idempotency_key=context.metadata.get("idempotency_key"),
                )
                
                context.metadata["aport_decision"] = {
                    "decision_id": decision.decision_id,
                    "allow": decision.allow,
                    "function_name": function_name,
                }
                
                if not decision.allow:
                    self.logger.warning(
                        f"Function {function_name} denied: decision_id={decision.decision_id}"
                    )
                    context.terminate = True
                    context.result = {
                        "error": "authorization_denied",
                        "decision_id": decision.decision_id,
                        "reasons": decision.reasons,
                    }
                    return
                
                await next(context)
                
            except AportError as e:
                self.logger.error(f"APort API error: {e}", exc_info=True)
                context.terminate = True
                context.result = {
                    "error": "authorization_failed",
                    "message": str(e),
                }
            except Exception as e:
                self.logger.error(f"Unexpected error: {e}", exc_info=True)
                context.terminate = True
                context.result = {
                    "error": "internal_error",
                    "message": f"Authorization failed: {str(e)}"
                }

