#!/usr/bin/env node

/**
 * Test script to verify the multi-tenant routing fix
 * This script tests the /m/{tenantId}/api/applications endpoint
 */

const http = require('http');

// Test cases for different tenant IDs
const testCases = [
  { tenantId: 'admin', description: 'Admin tenant' },
  { tenantId: 'default', description: 'Default tenant' },
  { tenantId: 'woqejwioq', description: 'Existing tenant' },
  { tenantId: 'test-tenant-1', description: 'Test tenant 1' },
  { tenantId: 'test-tenant-2', description: 'Test tenant 2' },
];

async function testRoute(tenantId, description) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 3002, // Admin port
      path: `/m/${tenantId}/api/applications?page=1&page_size=20&isThirdParty=false`,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer your-organization-token-here',
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          tenantId,
          description,
          status: res.statusCode,
          success: res.statusCode !== 404,
          headers: res.headers,
          body: data.length > 0 ? data : null,
        });
      });
    });

    req.on('error', (error) => {
      resolve({
        tenantId,
        description,
        status: null,
        success: false,
        error: error.message,
      });
    });

    req.end();
  });
}

async function runTests() {
  console.log('🚀 Testing multi-tenant routing fix...\n');
  
  const results = await Promise.all(
    testCases.map(({ tenantId, description }) => testRoute(tenantId, description))
  );

  console.log('📊 Test Results:');
  console.log('================');
  
  results.forEach((result) => {
    const status = result.success ? '✅ PASS' : '❌ FAIL';
    const statusCode = result.status || 'ERROR';
    console.log(`${status} ${result.description} (${result.tenantId}): ${statusCode}`);
    
    if (result.error) {
      console.log(`    Error: ${result.error}`);
    }
  });

  const passedCount = results.filter(r => r.success).length;
  const totalCount = results.length;
  
  console.log(`\n📈 Summary: ${passedCount}/${totalCount} tests passed`);
  
  if (passedCount === totalCount) {
    console.log('🎉 All tests passed! The routing fix is working correctly.');
  } else {
    console.log('⚠️  Some tests failed. The routing may still need fixes.');
  }
}

if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testRoute, runTests }; 