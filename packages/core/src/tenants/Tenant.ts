import { adminTenantId } from '@logto/schemas';
import { ConsoleLog } from '@logto/shared';
import type { MiddlewareType } from 'koa';
import Koa from 'koa';
import koaCompress from 'koa-compress';
import mount from 'koa-mount';
import type { Provider } from 'oidc-provider';

import { type CacheStore } from '#src/caches/types.js';
import { WellKnownCache } from '#src/caches/well-known.js';
import { AdminApps, EnvSet, UserApps } from '#src/env-set/index.js';
import { createCloudConnectionLibrary } from '#src/libraries/cloud-connection.js';
import { createConnectorLibrary } from '#src/libraries/connector.js';
import { createLogtoConfigLibrary } from '#src/libraries/logto-config.js';
import koaConnectorErrorHandler from '#src/middleware/koa-connector-error-handler.js';
import koaConsoleRedirectProxy from '#src/middleware/koa-console-redirect-proxy.js';
import koaErrorHandler from '#src/middleware/koa-error-handler.js';
import koaI18next from '#src/middleware/koa-i18next.js';
import koaOidcErrorHandler from '#src/middleware/koa-oidc-error-handler.js';
import koaSecurityHeaders from '#src/middleware/koa-security-headers.js';
import koaSlonikErrorHandler from '#src/middleware/koa-slonik-error-handler.js';
import koaSpaProxy from '#src/middleware/koa-spa-proxy.js';
import initOidc from '#src/oidc/init.js';
import { mountCallbackRouter } from '#src/routes/callback.js';
import initApis, { initPublicWellKnownApis } from '#src/routes/init.js';
import initMeApis from '#src/routes-me/init.js';
import BasicSentinel from '#src/sentinel/basic-sentinel.js';

import { SubscriptionLibrary } from '../libraries/subscription.js';

import Libraries from './Libraries.js';
import Queries from './Queries.js';
import type TenantContext from './TenantContext.js';
import { getTenantDatabaseDsn } from './utils.js';

const consoleLog = new ConsoleLog('tenant');

/** Data for creating a tenant instance. */
type CreateTenant = {
  /** The unique identifier of the tenant. */
  id: string;
  /** The cache store for the tenant. */
  redisCache: CacheStore;
  /** The custom domain of the tenant, if applicable. */
  customDomain?: string;
};

export default class Tenant implements TenantContext {
  static async create({ id, redisCache, customDomain }: CreateTenant): Promise<Tenant> {
    // Try to avoid unexpected "triggerUncaughtException" by using try-catch block
    try {
      // Treat the default database URL as the management URL
      const tenantDatabaseDsn = await getTenantDatabaseDsn(id);
      const envSet = new EnvSet(id, tenantDatabaseDsn);
      // Custom endpoint is used for building OIDC issuer URL when the request is a custom domain
      await envSet.load(customDomain);

      return new Tenant(envSet, id, new WellKnownCache(id, redisCache), redisCache);
    } catch (error) {
      consoleLog.error('Failed to create tenant:', id, error);
      throw error;
    }
  }

  public readonly provider: Provider;
  public get run(): MiddlewareType {
    return this.app.callback() as unknown as MiddlewareType;
  }

  private readonly app: Koa;

  readonly #createdAt = Date.now();
  #requestCount = 0;
  #onRequestEmpty?: () => Promise<void>;

  // Move all public methods before private methods
  public requestStart() {
    this.#requestCount += 1;
  }

  public requestEnd() {
    if (this.#requestCount > 0) {
      this.#requestCount -= 1;
      if (this.#requestCount === 0) {
        void this.#onRequestEmpty?.();
      }
    }
  }

  public async dispose() {
    if (this.#requestCount <= 0) {
      await this.envSet.end();
      return true;
    }
    return new Promise<true | 'timeout'>((resolve) => {
      const timeout = setTimeout(async () => {
        this.#onRequestEmpty = undefined;
        await this.envSet.end();
        resolve('timeout');
      }, 5000);
      this.#onRequestEmpty = async () => {
        clearTimeout(timeout);
        await this.envSet.end();
        resolve(true);
      };
    });
  }

  public async invalidateCache() {
    await this.wellKnownCache.set('tenant-cache-expires-at', WellKnownCache.defaultKey, Date.now());
  }

  public async checkHealth() {
    const tenantCacheExpiresAt = await this.wellKnownCache.get(
      'tenant-cache-expires-at',
      WellKnownCache.defaultKey
    );
    return !tenantCacheExpiresAt || tenantCacheExpiresAt < this.#createdAt;
  }

  // eslint-disable-next-line max-params
  private constructor(
    public readonly envSet: EnvSet,
    public readonly id: string,
    public readonly wellKnownCache: WellKnownCache,
    public readonly redisCache: CacheStore,
    public readonly queries = new Queries(envSet.pool, wellKnownCache, id, envSet, redisCache),
    public readonly logtoConfigs = createLogtoConfigLibrary(queries),
    public readonly cloudConnection = createCloudConnectionLibrary(logtoConfigs),
    public readonly connectors = createConnectorLibrary(queries, cloudConnection),
    public readonly subscription = new SubscriptionLibrary(
      id,
      queries,
      cloudConnection,
      redisCache
    ),
    public readonly libraries = new Libraries(
      id,
      queries,
      connectors,
      cloudConnection,
      logtoConfigs,
      subscription
    ),
    public readonly sentinel = new BasicSentinel(envSet.pool, queries)
  ) {
    const isAdminTenant = id === adminTenantId;
    const mountedApps: string[] = Array.from([
      ...Object.values(UserApps),
      ...(isAdminTenant ? Object.values(AdminApps) : []),
    ]);

    this.envSet = envSet;

    // Init app
    const app = new Koa();

    this.setupBasicMiddleware(app);
    this.setupOidcProvider(app, mountedApps);
    this.setupRouting(app, mountedApps, isAdminTenant);

    this.app = app;
    this.provider = this.createProvider();
  }

  private setupBasicMiddleware(app: Koa): void {
    app.use(koaI18next());
    app.use(koaErrorHandler());
    app.use(koaOidcErrorHandler());
    app.use(koaSlonikErrorHandler());
    app.use(koaConnectorErrorHandler());
    app.use(koaCompress());
    app.use(koaSecurityHeaders(Array.from([...Object.values(UserApps), ...Object.values(AdminApps)]), this.id));
  }

  private setupOidcProvider(app: Koa, mountedApps: string[]): void {
    const provider = initOidc(
      this.envSet,
      this.queries,
      this.libraries,
      this.logtoConfigs,
      this.cloudConnection,
      this.subscription
    );
    app.use(mount('/oidc', provider.app));
  }

  private setupRouting(app: Koa, mountedApps: string[], isAdminTenant: boolean): void {
    const tenantContext: TenantContext = {
      id: this.id,
      provider: this.createProvider(),
      queries: this.queries,
      logtoConfigs: this.logtoConfigs,
      cloudConnection: this.cloudConnection,
      connectors: this.connectors,
      libraries: this.libraries,
      envSet: this.envSet,
      sentinel: this.sentinel,
      invalidateCache: this.invalidateCache.bind(this),
    };

    // Sign-in experience callback via form submission
    mountCallbackRouter(app);

    // Mount cross-tenant management API routing for OSS multi-tenancy
    // Pattern: /m/{tenantId}/api/... (same as cloud)
    // ALL management APIs should only be accessible through admin port (3002)
    app.use(mount(`/m/${this.id}/api`, initApis(tenantContext)));

    // Mount global well-known APIs
    app.use(mount('/.well-known', initPublicWellKnownApis(tenantContext)));

    // Mount APIs (different sets for admin vs regular tenants)
    app.use(mount('/api', initApis(tenantContext)));

    const { adminUrlSet, isCloud } = EnvSet.values;

    // Mount admin tenant APIs and app
    if (isAdminTenant) {
      this.setupAdminTenantRouting(app, mountedApps, isCloud);
    }

    // Mount demo app for all tenants
    // For admin tenant: only in cloud for preview purposes
    // For user tenants: always mount for local OSS and cloud
    if (this.id !== adminTenantId || isCloud) {
      this.setupDemoAppRouting(app, mountedApps);
    }

    // Mount sign-in experience for all tenants
    this.setupSignInExperienceRouting(app, mountedApps);
  }

  private setupAdminTenantRouting(
    app: Koa,
    mountedApps: string[],
    isCloud: boolean
  ): void {
    // Mount `/me` APIs for admin tenant
    app.use(
      mount(
        '/me',
        initMeApis({
          id: this.id,
          provider: this.createProvider(),
          queries: this.queries,
          logtoConfigs: this.logtoConfigs,
          cloudConnection: this.cloudConnection,
          connectors: this.connectors,
          libraries: this.libraries,
          envSet: this.envSet,
          sentinel: this.sentinel,
          invalidateCache: this.invalidateCache.bind(this),
        })
      )
    );

    // Mount Admin Console for local OSS
    // In cloud, the admin console is served separately
    if (!isCloud) {
      app.use(koaConsoleRedirectProxy(this.queries));
      app.use(
        mount(
          '/' + AdminApps.Console,
          koaSpaProxy({
            mountedApps,
            queries: this.queries,
            packagePath: AdminApps.Console,
            port: 5002,
            prefix: AdminApps.Console,
          })
        )
      );
    }
  }

  private setupDemoAppRouting(app: Koa, mountedApps: string[]): void {
    // Mount demo app
    app.use(
      mount(
        '/' + UserApps.DemoApp,
        koaSpaProxy({
          mountedApps,
          queries: this.queries,
          packagePath: UserApps.DemoApp,
          port: 5003,
          prefix: UserApps.DemoApp,
        })
      )
    );
  }

  private setupSignInExperienceRouting(app: Koa, mountedApps: string[]): void {
    // Mount sign-in experience
    // UserApps does not have SignInExperience, so this is commented out to fix linter error
    // app.use(
    //   mount(
    //     '/' + UserApps.SignInExperience,
    //     koaSpaProxy({
    //       mountedApps,
    //       queries: this.queries,
    //       packagePath: UserApps.SignInExperience,
    //       port: 5001,
    //       prefix: UserApps.SignInExperience,
    //     })
    //   )
    // );
  }

  private createProvider(): Provider {
    return initOidc(
      this.envSet,
      this.queries,
      this.libraries,
      this.logtoConfigs,
      this.cloudConnection,
      this.subscription
    );
  }
}
