"""
Anthropic Tool Use with MCP and APort Passport

This example shows how to integrate MCP client with Anthropic's tool use API,
automatically attaching agent passports for authorization.

Prerequisites:
    pip install anthropic
    pip install aporthq-sdk-python
    pip install mcp  # Optional, for direct MCP integration
"""

import os
import asyncio
from typing import Dict, Any, List, Optional

try:
    import anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False
    print("⚠️  Anthropic SDK not installed. Install with: pip install anthropic")

from aporthq_sdk_python import APortClient, APortClientOptions
from client_example import MCPClientWithPassport, PolicyDeniedError


# Configuration
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
AGENT_ID = os.getenv("APORT_AGENT_ID", "ap_a2d10232c6534523812423eec8a1425c")
APORT_BASE_URL = os.getenv("APORT_BASE_URL", "https://api.aport.io")


class AnthropicWithMCPPassport:
    """
    Anthropic client wrapper that integrates MCP tools with passport support
    """
    
    def __init__(self, agent_id: str, anthropic_client: Optional[anthropic.Anthropic] = None):
        self.agent_id = agent_id
        self.anthropic_client = anthropic_client or (
            anthropic.Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_AVAILABLE else None
        )
        self.mcp_client: Optional[MCPClientWithPassport] = None
        self.aport_client = APortClient(APortClientOptions(base_url=APORT_BASE_URL))
    
    async def initialize_mcp(self):
        """Initialize MCP client connection"""
        self.mcp_client = MCPClientWithPassport(self.agent_id)
        await self.mcp_client.connect()
    
    async def close(self):
        """Close connections"""
        if self.mcp_client:
            await self.mcp_client.close()
        await self.aport_client.close()
    
    def _map_anthropic_tool_to_mcp_tool(self, tool_name: str) -> str:
        """
        Map Anthropic tool name to MCP tool name
        
        In a real implementation, you would maintain a mapping of
        Anthropic tool names to MCP tool names.
        """
        mapping = {
            "merge_pull_request": "merge_pull_request",
            "process_refund": "process_refund",
            "export_customer_data": "export_customer_data",
        }
        return mapping.get(tool_name, tool_name)
    
    async def handle_tool_use(
        self,
        tool_use: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Handle Anthropic tool use by routing to MCP tool with passport
        
        This is called when Anthropic requests a tool execution.
        """
        if not self.mcp_client:
            await self.initialize_mcp()
        
        tool_name = tool_use.get("name")
        tool_input = tool_use.get("input", {})
        
        # Map Anthropic tool to MCP tool
        mcp_tool_name = self._map_anthropic_tool_to_mcp_tool(tool_name)
        
        try:
            # Call MCP tool with passport attached
            result = await self.mcp_client.call_tool(
                mcp_tool_name,
                tool_input,
                retry_on_denial=False,  # Anthropic handles retries differently
                max_retries=1,
            )
            
            # Format result for Anthropic
            if result.content:
                text_content = next(
                    (c.get("text", "") for c in result.content if c.get("type") == "text"),
                    ""
                )
                return {
                    "tool_use_id": tool_use.get("id"),
                    "content": text_content,
                }
            
            return {
                "tool_use_id": tool_use.get("id"),
                "content": "Tool executed successfully",
            }
            
        except PolicyDeniedError as error:
            # Return policy denial to Anthropic
            return {
                "tool_use_id": tool_use.get("id"),
                "content": f"Policy denied: {error}",
            }
        except Exception as error:
            return {
                "tool_use_id": tool_use.get("id"),
                "content": f"Error: {error}",
            }
    
    async def messages_with_tools(
        self,
        messages: List[Dict[str, Any]],
        tools: List[Dict[str, Any]],
        model: str = "claude-3-5-sonnet-20241022"
    ) -> Dict[str, Any]:
        """
        Messages API with tool use, routing to MCP tools with passport
        
        This demonstrates the full flow:
        1. Anthropic decides to use a tool
        2. We route it to MCP tool with agent_id attached
        3. MCP server verifies passport via APort
        4. Result is returned to Anthropic
        """
        if not self.anthropic_client:
            raise RuntimeError("Anthropic client not initialized")
        
        if not self.mcp_client:
            await self.initialize_mcp()
        
        # Make initial messages request
        response = self.anthropic_client.messages.create(
            model=model,
            max_tokens=1024,
            messages=messages,
            tools=tools,
        )
        
        # Process tool use requests
        if response.stop_reason == "tool_use":
            tool_results = []
            
            for content in response.content:
                if content.type == "tool_use":
                    # Handle tool use via MCP with passport
                    tool_result = await self.handle_tool_use({
                        "id": content.id,
                        "name": content.name,
                        "input": content.input,
                    })
                    tool_results.append(tool_result)
            
            # Add tool results to messages
            messages.append({
                "role": "assistant",
                "content": response.content,
            })
            messages.append({
                "role": "user",
                "content": tool_results,
            })
            
            # Get final response
            final_response = self.anthropic_client.messages.create(
                model=model,
                max_tokens=1024,
                messages=messages,
                tools=tools,
            )
            
            return final_response
        
        return response


async def example_anthropic_merge():
    """Example: Merge PR via Anthropic tool use"""
    print("=" * 60)
    print("Example: Anthropic Tool Use with MCP Passport")
    print("=" * 60)
    
    wrapper = AnthropicWithMCPPassport(AGENT_ID)
    
    try:
        # Define tools available to Anthropic
        tools = [
            {
                "name": "merge_pull_request",
                "description": "Merge a pull request to a branch",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "repository": {"type": "string", "description": "Repository name (owner/repo)"},
                        "pr_number": {"type": "integer", "description": "Pull request number"},
                        "base_branch": {"type": "string", "description": "Base branch (e.g., main)"},
                    },
                    "required": ["repository", "pr_number"],
                },
            }
        ]
        
        # User request
        messages = [
            {
                "role": "user",
                "content": "Merge PR #123 in my-org/my-repo to main branch"
            }
        ]
        
        # Messages with tool use
        response = await wrapper.messages_with_tools(
            messages=messages,
            tools=tools,
        )
        
        print("✅ Anthropic response:", response.content[0].text)
        
    except Exception as error:
        print(f"❌ Error: {error}")
    finally:
        await wrapper.close()


async def main():
    """Main example"""
    if not ANTHROPIC_AVAILABLE:
        print("⚠️  Anthropic SDK not available. Install with: pip install anthropic")
        return
    
    if not ANTHROPIC_API_KEY:
        print("⚠️  ANTHROPIC_API_KEY environment variable not set")
        return
    
    await example_anthropic_merge()


if __name__ == "__main__":
    asyncio.run(main())

