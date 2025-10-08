# Usage Examples

This directory contains practical examples and tutorials for using The Passport for AI Agents.

## 📚 Examples

### Basic Usage
- [JavaScript/Node.js](./javascript/) - Node.js client examples
- [Python](./python/) - Python client examples
- [cURL](./curl/) - Command-line examples
- [Postman](./postman/) - Postman collection

### MCP (Model Context Protocol) Examples
- [JavaScript MCP Enforcement](./javascript/mcp-enforcement.js) - Express.js MCP middleware example
- [Python MCP Enforcement](./python/mcp_enforcement.py) - FastAPI MCP middleware example

### Integration Examples
- [Webhook Integration](./webhooks/) - Webhook handling examples
- [Rate Limiting](./rate-limiting/) - Rate limiting best practices
- [Error Handling](./error-handling/) - Error handling patterns

### Advanced Usage
- [Bulk Operations](./bulk-operations/) - Batch processing examples
- [Monitoring](./monitoring/) - Observability and metrics
- [Security](./security/) - Security best practices

## 🚀 Quick Start Examples

### Verify an Agent Passport
```bash
curl "https://api.aport.io/api/verify/ap_a2d10232c6534523812423eec8a1425c"
```

### Create a New Passport
```bash
curl -X POST "https://api.aport.io/api/admin/create" \
  -H "Authorization: Bearer your-admin-token" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "ap_my_agent",
    "owner": "My Company",
    "role": "Tier-1",
    "permissions": ["read:data", "create:reports"],
    "limits": {
      "api_calls_per_hour": 1000
    },
    "regions": ["US-CA", "EU-DE"],
    "status": "active",
    "contact": "admin@mycompany.com"
  }'
```

## 📖 Tutorials

1. [Getting Started](./tutorials/getting-started.md) - Your first API call
2. [Building a Client](./tutorials/building-a-client.md) - Create a custom client
3. [Webhook Integration](./tutorials/webhook-integration.md) - Set up webhooks
4. [Rate Limiting](./tutorials/rate-limiting.md) - Handle rate limits properly
5. [Error Handling](./tutorials/error-handling.md) - Robust error handling

## 🔧 Development Examples

- [Local Development](./development/) - Running locally
- [Testing](./testing/) - Writing tests
- [Deployment](./deployment/) - Deployment examples

## 📊 Monitoring Examples

- [Metrics Collection](./monitoring/metrics.md) - Collecting metrics
- [Alerting](./monitoring/alerting.md) - Setting up alerts
- [Dashboards](./monitoring/dashboards.md) - Creating dashboards

## 🤝 Contributing Examples

If you have a useful example, please contribute it! See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

## 📞 Support

- **GitHub Issues**: [Report issues](github.com/aporthq/agent-passport/issues)
- **GitHub Discussions**: [Ask questions](github.com/aporthq/agent-passport/discussions)
- **Documentation**: [Full documentation](../docs/)

---
**Last Updated**: 2025-09-24 23:02:26 UTC
