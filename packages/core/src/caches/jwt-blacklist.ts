import { z } from 'zod';

import { BaseCache } from './base-cache.js';

/**
 * Cache keys for JWT blacklist operations
 */
export enum JwtBlacklistCacheKey {
  /** Cache for checking if a specific JWT (by jti) is blacklisted */
  JwtBlacklist = 'jwt-blacklist',
}

type JwtBlacklistCacheMap = {
  [JwtBlacklistCacheKey.JwtBlacklist]: boolean;
};

const getValueGuard = (key: JwtBlacklistCacheKey) => {
  switch (key) {
    case JwtBlacklistCacheKey.JwtBlacklist: {
      return z.boolean();
    }
  }
};

export class JwtBlacklistCache extends BaseCache<JwtBlacklistCacheMap> {
  name = 'JwtBlacklistCache';

  getValueGuard(key: JwtBlacklistCacheKey) {
    return getValueGuard(key);
  }
} 