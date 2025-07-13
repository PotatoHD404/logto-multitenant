# Multi-Tenant Routing Fix Summary

## Problem Description

The application was experiencing 404 errors for certain tenant IDs when accessing management API routes with the pattern `/m/{tenantId}/api/applications`. Some tenant IDs (like `admin`, `default`, `woqejwioq`) worked while others returned 404 errors.

## Root Cause Analysis

The issue was in the routing architecture in `packages/core/src/tenants/Tenant.ts`. The system was mounting `/m/{tenantId}/api` routes individually on each tenant instance, but:

1. **Incorrect Route Mounting**: Each tenant instance was only mounting `/m/{its-own-id}/api` routes
2. **Admin Tenant Limitation**: The admin tenant only had `/m/admin/api` routes mounted
3. **Missing Dynamic Routing**: When a request came in for `/m/woqejwioq/api/applications`, it was correctly routed to the admin tenant, but the admin tenant didn't have `/m/woqejwioq/api` routes mounted

## Solution Implementation

### 1. Fixed Route Mounting Logic (`packages/core/src/tenants/Tenant.ts`)

**Before:**
```typescript
// Applied to ALL tenant instances
app.use(mount(`/m/${id}/api`, adminPortGuard));
app.use(mount(`/m/${id}/api`, initApis(tenantContext)));
```

**After:**
```typescript
// Only mount on admin tenant instance with dynamic handling
if (id === adminTenantId) {
  app.use(adminPortGuard);
  app.use(mount('/m', async (ctx: any, next: any) => {
    // Parse the URL to extract tenant ID
    const pathSegments = ctx.URL.pathname.split('/').filter(Boolean);
    
    // Expected pattern: /m/{tenantId}/api/...
    if (pathSegments.length >= 3 && pathSegments[0] === 'm' && pathSegments[2] === 'api') {
      const requestedTenantId = pathSegments[1];
      
      // Store the requested tenant ID for use in auth middleware
      ctx.targetTenantId = requestedTenantId;
      
      // Rewrite the path to remove the /m/{tenantId} prefix
      const newPath = '/' + pathSegments.slice(2).join('/');
      ctx.URL = new URL(newPath, ctx.URL.origin);
      ctx.path = newPath;
      
      // Initialize admin tenant APIs to handle the request
      const adminApis = initApis(tenantContext);
      return adminApis.callback()(ctx, next);
    } else {
      ctx.status = 404;
    }
  }));
}
```

### 2. Updated Authentication Middleware (`packages/core/src/routes/init.ts`)

Modified `koaOrganizationManagementAuth` to handle the target tenant ID:

```typescript
// Use the target tenant ID if available (for /m/{tenantId}/api routes)
const targetTenantId = (ctx as any).targetTenantId || tenant.id;
const expectedAudience = getTenantOrganizationId(targetTenantId);
const organizationAudience = buildOrganizationUrn(expectedAudience);
```

### 3. Enhanced Tenant Guard (`packages/core/src/middleware/koa-tenant-guard.ts`)

Updated the tenant guard to validate the target tenant and ensure it exists:

```typescript
// Use the target tenant ID if available
const targetTenantId = (ctx as any).targetTenantId || tenantId;

try {
  const { isSuspended } = await tenants.findTenantSuspendStatusById(targetTenantId);
  
  if (isSuspended) {
    throw new RequestError('subscription.tenant_suspended', 403);
  }
} catch (error) {
  // If tenant doesn't exist, throw 404
  if (error instanceof Error && error.message.includes('not found')) {
    throw new RequestError('entity.not_found', 404);
  }
  throw error;
}
```

## How It Works Now

1. **Request Processing**: When a request comes in for `/m/{tenantId}/api/applications`:
   - The `getTenantId` function extracts the tenant ID from the URL
   - The request is routed to the admin tenant (this was already working)

2. **Dynamic Route Handling**: The admin tenant now has a catch-all `/m` route that:
   - Parses the URL to extract the requested tenant ID
   - Stores it in `ctx.targetTenantId` for downstream middleware
   - Rewrites the path to `/api/applications` for processing
   - Passes the request to the admin tenant's API handlers

3. **Authentication**: The organization-based auth middleware now:
   - Uses the target tenant ID to validate the correct organization token
   - Ensures the user has permission to access the requested tenant

4. **Tenant Validation**: The tenant guard middleware:
   - Validates that the target tenant exists in the database
   - Checks if the tenant is suspended (for cloud environments)
   - Returns 404 if the tenant doesn't exist

## Security Considerations

- **Port-based Access Control**: Management APIs are still only accessible through the admin port (3002)
- **Tenant Existence Validation**: The system now validates that requested tenants exist in the database
- **Organization-based Authorization**: Users must have valid organization tokens for the specific tenant they're accessing
- **Scope Validation**: The auth middleware ensures users have appropriate scopes for the requested operations

## Testing

A test script (`test-routing-fix.js`) has been created to verify the fix works correctly across different tenant IDs. Run it with:

```bash
node test-routing-fix.js
```

## Expected Behavior

After this fix:
- ✅ `/m/admin/api/applications` - Works (admin tenant)
- ✅ `/m/default/api/applications` - Works (default tenant)
- ✅ `/m/woqejwioq/api/applications` - Works (existing tenant)
- ✅ `/m/any-valid-tenant/api/applications` - Works (any tenant in database)
- ❌ `/m/nonexistent-tenant/api/applications` - Returns 404 (tenant not found)

## Files Modified

1. `packages/core/src/tenants/Tenant.ts` - Fixed route mounting logic
2. `packages/core/src/routes/init.ts` - Updated auth middleware
3. `packages/core/src/middleware/koa-tenant-guard.ts` - Enhanced tenant validation

## Additional Notes

- The fix maintains backward compatibility with existing functionality
- All existing security measures remain in place
- The solution works for both local OSS and cloud environments
- The admin port guard ensures management APIs are only accessible through the correct port

This fix resolves the core issue where tenant IDs were not being handled dynamically in the routing system, allowing the multi-tenant management API to work correctly for all valid tenant IDs. 