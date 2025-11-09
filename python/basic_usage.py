"""
Basic Python examples for The Passport for AI Agents
"""

import requests
import time
import json
import os
from typing import Dict, Any, Optional

# Configuration
API_BASE_URL = os.getenv('API_URL', 'https://api.aport.io')
ADMIN_TOKEN = os.getenv('ADMIN_TOKEN', 'your-admin-token')

class AgentPassportClient:
    """Client for interacting with The Passport for AI Agents API"""
    
    def __init__(self, base_url: str = API_BASE_URL, admin_token: str = ADMIN_TOKEN):
        self.base_url = base_url
        self.admin_token = admin_token
        self.session = requests.Session()
        
        # Set default headers
        self.session.headers.update({
            'User-Agent': 'Python-Client/1.0',
            'Accept': 'application/json'
        })
    
    def _make_request(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        """Make HTTP request with error handling"""
        url = f"{self.base_url}{endpoint}"
        
        try:
            response = self.session.request(method, url, **kwargs)
            
            # Try to parse JSON response
            try:
                data = response.json()
            except ValueError:
                data = response.text
            
            return {
                'status_code': response.status_code,
                'data': data,
                'headers': dict(response.headers)
            }
        except requests.RequestException as e:
            return {
                'status_code': 0,
                'data': {'error': str(e)},
                'headers': {}
            }
    
    def verify_passport(self, agent_id: str) -> Dict[str, Any]:
        """Verify an agent passport"""
        print(f"\n🔍 Verifying passport for agent: {agent_id}")
        
        response = self._make_request('GET', f'/api/verify/{agent_id}')
        
        if response['status_code'] == 200:
            print('✅ Passport verified successfully:')
            print(json.dumps(response['data'], indent=2))
            
            # Check rate limit headers
            headers = response['headers']
            print('\n📊 Rate Limit Info:')
            print(f"Limit: {headers.get('X-RateLimit-Limit', 'N/A')}")
            print(f"Remaining: {headers.get('X-RateLimit-Remaining', 'N/A')}")
            print(f"Reset: {headers.get('X-RateLimit-Reset', 'N/A')}")
        else:
            print(f"❌ Verification failed ({response['status_code']}):")
            print(json.dumps(response['data'], indent=2))
        
        return response
    
    def create_passport(self, passport_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new agent passport"""
        print('\n📝 Creating new passport...')
        
        response = self._make_request(
            'POST',
            '/api/admin/create',
            headers={'Authorization': f'Bearer {self.admin_token}'},
            json=passport_data
        )
        
        if response['status_code'] == 201:
            print('✅ Passport created successfully:')
            print(json.dumps(response['data'], indent=2))
        else:
            print(f"❌ Creation failed ({response['status_code']}):")
            print(json.dumps(response['data'], indent=2))
        
        return response
    
    def list_agents(self) -> Dict[str, Any]:
        """List all agents (admin only)"""
        print('\n📋 Listing all agents...')
        
        response = self._make_request(
            'GET',
            '/api/admin/agents',
            headers={'Authorization': f'Bearer {self.admin_token}'}
        )
        
        if response['status_code'] == 200:
            print('✅ Agents retrieved successfully:')
            print(json.dumps(response['data'], indent=2))
        else:
            print(f"❌ Failed to list agents ({response['status_code']}):")
            print(json.dumps(response['data'], indent=2))
        
        return response
    
    def update_agent_status(self, agent_id: str, status: str, reason: str = '') -> Dict[str, Any]:
        """Update agent status"""
        print(f'\n🔄 Updating agent {agent_id} status to {status}...')
        
        response = self._make_request(
            'POST',
            '/api/admin/status',
            headers={'Authorization': f'Bearer {self.admin_token}'},
            json={
                'agent_id': agent_id,
                'status': status,
                'reason': reason
            }
        )
        
        if response['status_code'] == 200:
            print('✅ Status updated successfully:')
            print(json.dumps(response['data'], indent=2))
        else:
            print(f"❌ Status update failed ({response['status_code']}):")
            print(json.dumps(response['data'], indent=2))
        
        return response
    
    def demonstrate_capabilities_and_limits(self, agent_id: str) -> Dict[str, Any]:
        """Demonstrate capabilities and limits enforcement"""
        print(f'\n🔐 Demonstrating capabilities and limits for agent: {agent_id}')
        
        response = self.verify_passport(agent_id)
        
        if response['status_code'] == 200:
            passport = response['data']
            print('✅ Passport retrieved successfully')
            
            # Check capabilities
            print('\n📋 Capabilities:')
            if passport.get('capabilities') and len(passport['capabilities']) > 0:
                for cap in passport['capabilities']:
                    params_str = f" (params: {json.dumps(cap.get('params', {}))})" if cap.get('params') else ''
                    print(f"  - {cap['id']}{params_str}")
            else:
                print('  No capabilities defined')
            
            # Check limits
            print('\n⚖️ Limits:')
            if passport.get('limits'):
                for key, value in passport['limits'].items():
                    print(f'  - {key}: {value}')
            else:
                print('  No limits defined')
            
            # Demonstrate enforcement examples
            print('\n🛡️ Enforcement Examples:')
            
            # Refund capability check
            has_refund_cap = any(cap['id'] == 'finance.payment.refund' for cap in passport.get('capabilities', []))
            if has_refund_cap:
                print('  ✅ Agent has refund capability')
                
                # Check refund limits
                if passport.get('limits', {}).get('refund_amount_max_per_tx'):
                    refund_amount = 5000  # $50.00 in cents
                    max_per_tx = passport['limits']['refund_amount_max_per_tx']
                    if refund_amount <= max_per_tx:
                        print(f'  ✅ Refund amount ${refund_amount/100} is within per-transaction limit of ${max_per_tx/100}')
                    else:
                        print(f'  ❌ Refund amount ${refund_amount/100} exceeds per-transaction limit of ${max_per_tx/100}')
            else:
                print('  ❌ Agent does not have refund capability')
            
            # Data export capability check
            has_export_cap = any(cap['id'] == 'data.export' for cap in passport.get('capabilities', []))
            if has_export_cap:
                print('  ✅ Agent has data export capability')
                
                # Check export limits
                if passport.get('limits', {}).get('max_export_rows'):
                    requested_rows = 5000
                    max_rows = passport['limits']['max_export_rows']
                    if requested_rows <= max_rows:
                        print(f'  ✅ Export request for {requested_rows} rows is within limit of {max_rows}')
                    else:
                        print(f'  ❌ Export request for {requested_rows} rows exceeds limit of {max_rows}')
                
                # Check PII access
                allow_pii = passport.get('limits', {}).get('allow_pii')
                if allow_pii is not None:
                    status = '✅' if allow_pii else '❌'
                    access = 'allowed' if allow_pii else 'not allowed'
                    print(f'  {status} PII access is {access}')
            else:
                print('  ❌ Agent does not have data export capability')
            
            # Messaging capability check
            has_messaging_cap = any(cap['id'] == 'messaging.send' for cap in passport.get('capabilities', []))
            if has_messaging_cap:
                print('  ✅ Agent has messaging capability')
                
                # Check message rate limits
                if passport.get('limits', {}).get('msgs_per_min'):
                    print(f'  ✅ Message rate limit: {passport["limits"]["msgs_per_min"]} per minute')
                if passport.get('limits', {}).get('msgs_per_day'):
                    print(f'  ✅ Daily message limit: {passport["limits"]["msgs_per_day"]} per day')
                
                # Check channel allowlist
                messaging_cap = next((cap for cap in passport.get('capabilities', []) if cap['id'] == 'messaging.send'), None)
                if messaging_cap and messaging_cap.get('params', {}).get('channels_allowlist'):
                    channels = ', '.join(messaging_cap['params']['channels_allowlist'])
                    print(f'  ✅ Allowed channels: {channels}')
                if messaging_cap and messaging_cap.get('params', {}).get('mention_policy'):
                    print(f'  ✅ Mention policy: {messaging_cap["params"]["mention_policy"]}')
            else:
                print('  ❌ Agent does not have messaging capability')
            
            # Repository PR creation capability check
            has_pr_cap = any(cap['id'] == 'repo.pr.create' for cap in passport.get('capabilities', []))
            if has_pr_cap:
                print('  ✅ Agent has PR creation capability')
                
                if passport.get('limits', {}).get('max_prs_per_day'):
                    print(f'  ✅ Daily PR limit: {passport["limits"]["max_prs_per_day"]} per day')
                
                pr_cap = next((cap for cap in passport.get('capabilities', []) if cap['id'] == 'repo.pr.create'), None)
                if pr_cap and pr_cap.get('params', {}).get('allowed_repos'):
                    repos = ', '.join(pr_cap['params']['allowed_repos'])
                    print(f'  ✅ Allowed repositories: {repos}')
                if pr_cap and pr_cap.get('params', {}).get('allowed_base_branches'):
                    branches = ', '.join(pr_cap['params']['allowed_base_branches'])
                    print(f'  ✅ Allowed base branches: {branches}')
            else:
                print('  ❌ Agent does not have PR creation capability')
            
            # Repository merge capability check
            has_merge_cap = any(cap['id'] == 'repo.merge' for cap in passport.get('capabilities', []))
            if has_merge_cap:
                print('  ✅ Agent has merge capability')
                
                if passport.get('limits', {}).get('max_merges_per_day'):
                    print(f'  ✅ Daily merge limit: {passport["limits"]["max_merges_per_day"]} per day')
                if passport.get('limits', {}).get('max_pr_size_kb'):
                    print(f'  ✅ Max PR size: {passport["limits"]["max_pr_size_kb"]} KB')
                
                merge_cap = next((cap for cap in passport.get('capabilities', []) if cap['id'] == 'repo.merge'), None)
                if merge_cap and merge_cap.get('params', {}).get('required_reviews'):
                    print(f'  ✅ Required reviews: {merge_cap["params"]["required_reviews"]}')
                if merge_cap and merge_cap.get('params', {}).get('required_labels'):
                    labels = ', '.join(merge_cap['params']['required_labels'])
                    print(f'  ✅ Required labels: {labels}')
            else:
                print('  ❌ Agent does not have merge capability')
            
            # Assurance level check
            if passport.get('assurance_level'):
                print(f'\n🛡️ Assurance Level: {passport["assurance_level"]}')
                print(f'  Method: {passport.get("assurance_method", "N/A")}')
                print(f'  Verified: {passport.get("assurance_verified_at", "N/A")}')
                
                # Example assurance requirements
                required_levels = {
                    'refunds': 'L2',
                    'payouts': 'L3',
                    'admin': 'L4KYC'
                }
                
                print('\n🔒 Route Access Requirements:')
                for route, required_level in required_levels.items():
                    has_access = self._compare_assurance_levels(passport['assurance_level'], required_level)
                    status = '✅' if has_access else '❌'
                    print(f'  {route}: {status} (requires {required_level}, has {passport["assurance_level"]})')
            
            # Taxonomy information
            if passport.get('categories') or passport.get('framework'):
                print('\n🏷️ Taxonomy:')
                if passport.get('categories'):
                    print(f'  Categories: {", ".join(passport["categories"])}')
                if passport.get('framework'):
                    print(f'  Frameworks: {", ".join(passport["framework"])}')
        
        return response
    
    def _compare_assurance_levels(self, current: str, required: str) -> bool:
        """Simple assurance level comparison helper"""
        levels = ['L0', 'L1', 'L2', 'L3', 'L4KYC', 'L4FIN']
        try:
            current_index = levels.index(current)
            required_index = levels.index(required)
            return current_index >= required_index
        except ValueError:
            return False
    
    def verify_policy(self, pack_id: str, agent_id: str, policy_id: str, context: Dict[str, Any], idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        """
        Verify a policy decision.
        
        Note: Policy verification automatically verifies the passport - no need to call verify_passport() first.
        
        Args:
            pack_id: Policy pack identifier (e.g., "finance.payment.refund.v1")
            agent_id: Agent passport ID
            policy_id: Policy ID (usually same as pack_id)
            context: Policy-specific context data
            idempotency_key: Optional idempotency key for duplicate request prevention
        """
        print(f'\n🛡️ Verifying policy: {pack_id} for agent: {agent_id}')
        
        request_body = {
            'context': {
                'agent_id': agent_id,
                'policy_id': policy_id,
                'context': context
            }
        }
        
        if idempotency_key:
            request_body['context']['idempotency_key'] = idempotency_key
        
        response = self._make_request(
            'POST',
            f'/api/verify/policy/{pack_id}',
            json=request_body
        )
        
        if response['status_code'] == 200:
            decision = response['data'].get('decision', {})
            print('✅ Policy verification successful:')
            print(f"   Decision ID: {decision.get('decision_id', 'N/A')}")
            print(f"   Allowed: {decision.get('allow', False)}")
            if decision.get('reasons'):
                print(f"   Reasons: {json.dumps(decision['reasons'], indent=2)}")
            if decision.get('assurance_level'):
                print(f"   Assurance Level: {decision.get('assurance_level')}")
        else:
            print(f"❌ Policy verification failed ({response['status_code']}):")
            print(json.dumps(response['data'], indent=2))
        
        return response
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get system metrics"""
        print('\n📊 Getting system metrics...')
        
        response = self._make_request(
            'GET',
            '/api/metrics',
            headers={'Authorization': f'Bearer {self.admin_token}'}
        )
        
        if response['status_code'] == 200:
            print('✅ Metrics retrieved successfully:')
            print(json.dumps(response['data'], indent=2))
        else:
            print(f"❌ Failed to get metrics ({response['status_code']}):")
            print(json.dumps(response['data'], indent=2))
        
        return response
    
    def verify_with_retry(self, agent_id: str, max_retries: int = 3) -> Optional[Dict[str, Any]]:
        """Verify passport with exponential backoff retry"""
        for attempt in range(1, max_retries + 1):
            try:
                response = self.verify_passport(agent_id)
                
                if response['status_code'] == 200:
                    return response['data']
                elif response['status_code'] == 429:
                    # Rate limited
                    retry_after = response['data'].get('retryAfter', 2 ** attempt)
                    print(f"⏳ Rate limited. Retrying in {retry_after} seconds... (attempt {attempt}/{max_retries})")
                    
                    if attempt < max_retries:
                        time.sleep(retry_after)
                        continue
                else:
                    print(f"❌ Request failed with status {response['status_code']}")
                    if attempt < max_retries:
                        time.sleep(2 ** attempt)
                        continue
                
            except Exception as e:
                print(f"⚠️ Attempt {attempt} failed: {str(e)}")
                if attempt < max_retries:
                    time.sleep(2 ** attempt)
                    continue
        
        return None

def main():
    """Run example usage"""
    print('🚀 The Passport for AI Agents - Python Examples\n')
    
    # Initialize client
    client = AgentPassportClient()
    
    # Verify existing passports
    client.verify_passport('ap_a2d10232c6534523812423eec8a1425c')
    client.verify_passport('ap_a2d10232c6534523812423eec8a1425c')

    # Demonstrate capabilities and limits enforcement
    client.demonstrate_capabilities_and_limits('ap_a2d10232c6534523812423eec8a1425c')
    
    # Create a new passport
    new_passport = {
        'agent_id': 'ap_python_example',
        'owner': 'Python Example',
        'role': 'Tier-1',
        'permissions': ['read:data', 'create:reports'],
        'limits': {
            'api_calls_per_hour': 500,
            'ticket_creation_daily': 25
        },
        'regions': ['US-CA'],
        'status': 'active',
        'contact': 'example@python.com',
        'version': '1.0.0'
    }
    
    client.create_passport(new_passport)
    
    # Create a passport with new capabilities
    new_capabilities_passport = {
        'agent_id': 'ap_python_new_caps',
        'owner': 'Python New Capabilities Example',
        'role': 'agent',
        'capabilities': [
            {
                'id': 'messaging.send',
                'params': {
                    'channels_allowlist': ['slack', 'discord', 'email'],
                    'mention_policy': 'limited'
                }
            },
            {
                'id': 'repo.pr.create',
                'params': {
                    'allowed_repos': ['company/public-repo', 'company/docs'],
                    'allowed_base_branches': ['main', 'develop'],
                    'path_allowlist': ['src/**', 'docs/**'],
                    'max_files_changed': 20,
                    'max_total_added_lines': 500
                }
            },
            {
                'id': 'repo.merge',
                'params': {
                    'allowed_repos': ['company/public-repo'],
                    'allowed_base_branches': ['develop'],
                    'required_labels': ['approved', 'tested'],
                    'required_reviews': 2
                }
            }
        ],
        'limits': {
            'msgs_per_min': 30,
            'msgs_per_day': 1000,
            'max_prs_per_day': 10,
            'max_merges_per_day': 5,
            'max_pr_size_kb': 512
        },
        'regions': ['global'],
        'status': 'active',
        'contact': 'newcaps@python.com',
        'version': '1.0.0'
    }
    
    client.create_passport(new_capabilities_passport)
    
    # List all agents
    client.list_agents()
    
    # Update agent status
    client.update_agent_status('ap_python_example', 'suspended', 'Testing suspension')
    
    # Get metrics
    client.get_metrics()
    
    # Example with rate limiting
    print('\n🔄 Testing rate limiting with retry...')
    result = client.verify_with_retry('ap_a2d10232c6534523812423eec8a1425c')
    if result:
        print('✅ Verification with retry successful:', result)
    else:
        print('❌ Verification with retry failed')
    
    # Policy verification examples
    print('\n' + '='*60)
    print('🛡️ Policy Verification Examples')
    print('='*60)
    print('Note: Policy verification automatically verifies the passport')
    print('      No need to call verify_passport() first\n')
    
    # Example 1: Refund policy verification
    print('Example 1: Refund policy verification')
    client.verify_policy(
        pack_id='finance.payment.refund.v1',
        agent_id='ap_a2d10232c6534523812423eec8a1425c',
        policy_id='finance.payment.refund.v1',
        context={
            'amount': 5000,  # $50.00 in cents
            'currency': 'USD',
            'customer_id': 'cust_123',
            'reason': 'Customer request'
        }
    )
    
    # Example 2: Data export policy verification
    print('\nExample 2: Data export policy verification')
    client.verify_policy(
        pack_id='data.export.create.v1',
        agent_id='ap_a2d10232c6534523812423eec8a1425c',
        policy_id='data.export.create.v1',
        context={
            'table_name': 'users',
            'row_limit': 1000,
            'include_pii': False
        }
    )
    
    # Example 3: Repository merge policy verification
    print('\nExample 3: Repository merge policy verification')
    client.verify_policy(
        pack_id='code.repository.merge.v1',
        agent_id='ap_a2d10232c6534523812423eec8a1425c',
        policy_id='code.repository.merge.v1',
        context={
            'repo': 'company/my-repo',
            'base_branch': 'main',
            'files_changed': 5,
            'lines_added': 100,
            'labels': ['approved', 'tested'],
            'reviews': 2
        }
    )
    
    print('\n✨ Examples completed!')

if __name__ == '__main__':
    main()
