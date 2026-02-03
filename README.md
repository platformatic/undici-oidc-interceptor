# undici-oidc-interceptor


[![NPM version](https://img.shields.io/npm/v/undici-oidc-interceptor.svg?style=flat)](https://www.npmjs.com/package/undici-oidc-interceptor)

`undici-oidc-interceptor` manages an [OIDC](https://openid.net/specs/openid-connect-core-1_0.html) access token and transparently sets the `Authorization` header on any
request that is going to a limited set of domains.

The token is automatically renewed after it expires. It supports both a `refresh_token`
and `client_credentials` grants.

## Install

```bash
npm i undici undici-oidc-interceptor
```

## Usage with client credentials

```js
const { Agent } = require('undici')
const { createOidcInterceptor } = require('undici-oidc-interceptor')
const dispatcher = new Agent().compose(createOidcInterceptor({
      // The paramerts for the cliend_credentials grant of OIDC
      clientId: 'FILLME',
      clientSecret: 'FILLME',
      idpTokenUrl: 'https://your-idp.com/token',

      // Set an array of status codes that the interceptor should refresh and
      // retry the request on
      retryOnStatusCodes: [401],

      // The array of urls that this interceptor will be appending `Authorization` header
      // for automatically
      urls: ['FILLME'],

      // OPTIONAL: an initial access token
      accessToken: ''
    }))
``` 

## Usage with refresh token

```js
const { Agent } = require('undici')
const { createOidcInterceptor } = require('undici-oidc-interceptor')
const dispatcher = new Agent().compose(createOidcInterceptor({
      // Provide a refresh token so the interceptor can manage the access token
      // The refresh token must include an issuer (`iss`)
      refreshToken: '',
      idpTokenUrl: 'https://your-idp.com/token',
      clientId: 'FILLME',

      // Set an array of status codes that the interceptor should refresh and
      // retry the request on
      retryOnStatusCodes: [401],

      // The array of urls that this interceptor will be appending `Authorization` header
      // for automatically
      urls: [],

      // OPTIONAL: an initial access token
      accessToken: ''
    }))
```

## Custom authentication decision

```js
const { Agent } = require('undici')
const { createOidcInterceptor } = require('undici-oidc-interceptor')
const dispatcher = new Agent().compose(createOidcInterceptor({
      // Provide a refresh token so the interceptor can manage the access token
      // The refresh token must include an issuer (`iss`)
      refreshToken: '',
      idpTokenUrl: 'https://your-idp.com/token',
      clientId: 'FILLME',

      // Set an array of status codes that the interceptor should refresh and
      // retry the request on
      retryOnStatusCodes: [401],

      // OPTIONAL: a callback function, if return 'true' then this interceptor will include `Authorization` header
      shouldAuthenticate: (opts) => opts.header['something'] === 'test',

      // OPTIONAL: an initial access token
      accessToken: ''
    }))
```

> Note: `shouldAuthenticate` has higher priority than urls. Fallback to urls behavior when shouldAuthenticate is not provided

## Token store

This interceptor uses the [async-cache-dedupe](https://github.com/mcollina/async-cache-dedupe) package to cache access tokens. This improves efficiency by enabling token reuse across processes or instances and avoids unnecessary token refresh requests.

- **Default:** In-memory storage.
- **Custom storage:** You can provide your own backend (e.g., Redis) by supplying a compatible async-cache-dedupe configuration.

Example: Using Redis as the token store
```js
const Redis = require('ioredis')
const { Agent } = require('undici')
const { createOidcInterceptor } = require('undici-oidc-interceptor')

const redisClient = new Redis()

const dispatcher = new Agent().compose(createOidcInterceptor({
  ...options,
  tokenStore: {
    name: 'test-cache',
    ttl: 100,
    storage: {
      type: 'redis',
      options: {
        client: redisClient
      }
    }
  }
}))
```

### Two-tier caching with in-memory layer

When using Redis (or another external storage) as your token store, you can enable an additional in-memory cache layer for even faster token access. This creates a two-tier caching system:

1. **First tier (in-memory):** Fast local cache that stores tokens in process memory
2. **Second tier (Redis):** Shared cache that enables token reuse across processes/instances

This is particularly useful in distributed systems where you want the benefits of shared caching via Redis, but also want to minimize network latency for frequently accessed tokens.

Example: Using two-tier caching with Redis
```js
const Redis = require('ioredis')
const { Agent } = require('undici')
const { createOidcInterceptor } = require('undici-oidc-interceptor')

const redisClient = new Redis()

const dispatcher = new Agent().compose(createOidcInterceptor({
  ...options,
  tokenStore: {
    name: 'test-cache',
    ttl: 3600, // Redis TTL in seconds
    storage: {
      type: 'redis',
      options: {
        client: redisClient
      }
    },
    // Enable in-memory cache layer
    useInMemoryCache: true,
    inMemoryCacheTTL: 60000 // In-memory TTL in milliseconds (60 seconds)
  }
}))
```

**Configuration options:**
- `useInMemoryCache` (boolean): Set to `true` to enable the in-memory cache layer. Default: `false`
- `inMemoryCacheTTL` (number): Time-to-live for in-memory cached tokens in milliseconds. Default: `60000` (60 seconds)

**How it works:**
- On first token request: Fetches from IDP → stores in both Redis and memory
- On subsequent requests: Checks memory first → if expired, checks Redis → if not in Redis, fetches from IDP
- When cache is cleared: Both memory and Redis caches are cleared

### Custom TTL
If you want to customize the TTL for tokens based on the `expiresIn` value from the OIDC response, you can provide a custom function.

Example:
```js
const Redis = require('ioredis')
const { Agent } = require('undici')
const { createOidcInterceptor } = require('undici-oidc-interceptor')

const redisClient = new Redis()

const dispatcher = new Agent().compose(createOidcInterceptor({
  ...options,
  tokenStore: {
    name: 'test-cache',
    ttl: (tokenPayload) => tokenPayload.expiresIn * 80 / 100, // Sets token TTL to 80% of the OIDC expiry time
    storage: { 
      type: 'redis', 
      options: { 
        client: redisClient 
      } 
    }
  }
}))
```

## License

MIT
