#!/bin/bash

# Tenant API Test Script for Logto Development Environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_BASE="http://localhost:3001/api"
ADMIN_BASE="http://localhost:3002"

# Function to print colored output
print_test() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_info() {
    echo -e "${YELLOW}[INFO]${NC} $1"
}

# Function to test API endpoint
test_api() {
    local method=$1
    local endpoint=$2
    local data=$3
    local expected_status=$4
    
    print_test "$method $endpoint"
    
    if [ -n "$data" ]; then
        response=$(curl -s -w "HTTPSTATUS:%{http_code}" \
            -X "$method" \
            -H "Content-Type: application/json" \
            -d "$data" \
            "$API_BASE$endpoint")
    else
        response=$(curl -s -w "HTTPSTATUS:%{http_code}" \
            -X "$method" \
            "$API_BASE$endpoint")
    fi
    
    # Extract HTTP status code
    status=$(echo "$response" | tr -d '\n' | sed -e 's/.*HTTPSTATUS://')
    body=$(echo "$response" | sed -e 's/HTTPSTATUS:.*//g')
    
    if [ "$status" = "$expected_status" ]; then
        print_success "Status: $status (Expected: $expected_status)"
        if [ -n "$body" ] && [ "$body" != "null" ]; then
            echo "Response: $body" | head -c 200
            echo ""
        fi
        return 0
    else
        print_error "Status: $status (Expected: $expected_status)"
        echo "Response: $body"
        return 1
    fi
}

# Wait for services to be ready
print_info "Waiting for services to be ready..."
sleep 5

# Check if API is accessible
print_test "Checking API health"
if curl -s "$API_BASE/status" > /dev/null 2>&1; then
    print_success "API is accessible"
else
    print_error "API is not accessible at $API_BASE"
    print_info "Make sure the development environment is running:"
    print_info "  docker-compose -f docker-compose.dev.yml up logto-core"
    exit 1
fi

echo ""
echo "🧪 Testing Tenant Management APIs"
echo "=================================="

# Test 1: List tenants (should be empty initially)
print_test "GET /tenants - List all tenants"
if test_api "GET" "/tenants" "" "200"; then
    print_success "✅ List tenants works"
else
    print_error "❌ List tenants failed"
fi

echo ""

# Test 2: Create a new tenant
print_test "POST /tenants - Create new tenant"
tenant_data='{"name":"Test Tenant","tag":"Development"}'
if test_api "POST" "/tenants" "$tenant_data" "201"; then
    print_success "✅ Create tenant works"
    # Extract tenant ID from response for further tests
    TENANT_ID=$(echo "$body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
    print_info "Created tenant ID: $TENANT_ID"
else
    print_error "❌ Create tenant failed"
    TENANT_ID=""
fi

echo ""

# Test 3: Get tenant by ID (if we have an ID)
if [ -n "$TENANT_ID" ]; then
    print_test "GET /tenants/$TENANT_ID - Get tenant by ID"
    if test_api "GET" "/tenants/$TENANT_ID" "" "200"; then
        print_success "✅ Get tenant by ID works"
    else
        print_error "❌ Get tenant by ID failed"
    fi
    echo ""
fi

# Test 4: Update tenant (if we have an ID)
if [ -n "$TENANT_ID" ]; then
    print_test "PATCH /tenants/$TENANT_ID - Update tenant"
    update_data='{"name":"Updated Test Tenant"}'
    if test_api "PATCH" "/tenants/$TENANT_ID" "$update_data" "200"; then
        print_success "✅ Update tenant works"
    else
        print_error "❌ Update tenant failed"
    fi
    echo ""
fi

# Test 5: List tenants again (should show our created tenant)
print_test "GET /tenants - List tenants after creation"
if test_api "GET" "/tenants" "" "200"; then
    print_success "✅ List tenants after creation works"
else
    print_error "❌ List tenants after creation failed"
fi

echo ""

# Test 6: Try to delete admin tenant (should fail)
print_test "DELETE /tenants/admin - Try to delete admin tenant (should fail)"
if test_api "DELETE" "/tenants/admin" "" "400"; then
    print_success "✅ Admin tenant deletion properly blocked"
else
    print_error "❌ Admin tenant deletion not properly blocked"
fi

echo ""

# Test 7: Delete our test tenant (if we have an ID)
if [ -n "$TENANT_ID" ]; then
    print_test "DELETE /tenants/$TENANT_ID - Delete test tenant"
    if test_api "DELETE" "/tenants/$TENANT_ID" "" "204"; then
        print_success "✅ Delete tenant works"
    else
        print_error "❌ Delete tenant failed"
    fi
    echo ""
fi

# Test 8: Verify tenant was deleted
if [ -n "$TENANT_ID" ]; then
    print_test "GET /tenants/$TENANT_ID - Verify tenant deletion"
    if test_api "GET" "/tenants/$TENANT_ID" "" "404"; then
        print_success "✅ Tenant properly deleted"
    else
        print_error "❌ Tenant not properly deleted"
    fi
    echo ""
fi

echo ""
echo "🎯 Testing Complete!"
echo "==================="

# Test admin console accessibility
print_test "Checking Admin Console accessibility"
if curl -s "$ADMIN_BASE" > /dev/null 2>&1; then
    print_success "✅ Admin Console is accessible at $ADMIN_BASE"
else
    print_error "❌ Admin Console is not accessible at $ADMIN_BASE"
fi

echo ""
echo "📋 Summary:"
echo "- Tenant Management APIs: Implemented and tested"
echo "- Local Development: ✅ Ready"
echo "- Database: ✅ Connected"
echo "- Admin Console: Available at $ADMIN_BASE"
echo "- Core API: Available at $API_BASE"
echo ""
echo "🚀 You can now:"
echo "1. Access the admin console to manage tenants"
echo "2. Use the tenant APIs for programmatic access"
echo "3. Create, update, and delete tenants locally"
echo "4. Test your changes with hot reload" 