'use strict'

const { test, describe, before, after, afterEach } = require('node:test')
const assert = require('node:assert')
const Redis = require('ioredis')
const TokenStore = require('../lib/token-store')
const { setGlobalDispatcher, MockAgent } = require('undici')

const mockAgent = new MockAgent()
setGlobalDispatcher(mockAgent)
mockAgent.disableNetConnect()

const redisClient = new Redis('redis://localhost:6379')

describe('cache store', async () => {
  before(async () => {
    await redisClient.flushall()
  })

  after(async () => {
    redisClient.quit()
  })

  describe('instance', async () => {
    test('creates a cache instance', async () => {
      const cacheStore = new TokenStore({
        ttl: 30000,
        storage: { type: 'memory' }
      })

      assert.ok(cacheStore)
      assert.ok(cacheStore.token)
    })

    test('creates a cache instance with in-memory store', async () => {
      const cacheStore = new TokenStore({
        ttl: 30000,
        storage: { type: 'memory' },
        useInMemoryCache: true,
        inMemoryCacheTTL: 10000
      })

      assert.ok(cacheStore.token)
    })
  })

  describe('token', async () => {
    afterEach(async () => {
      await redisClient.flushall()
    })

    test('retrieve token with key serialization', async (t) => {
      const refreshMock = mockAgent.get('https://example.com')
      refreshMock.intercept({
        method: 'POST',
        path: '/token',
        body: body => {
          const { refresh_token, grant_type, client_id } = Object.fromEntries(new URLSearchParams(body))
          assert.strictEqual(refresh_token, 'refresh-token')
          assert.strictEqual(grant_type, 'refresh_token')
          assert.strictEqual(client_id, 'client-id')
          return true
        }
      }).reply(200, {
        access_token: 'new-access-token'
      })

      const cacheStore = new TokenStore({
        name: 'test-cache',
        ttl: 100,
        storage: { type: 'redis', options: { client: redisClient } },
        serialize: (key) => key.clientId
      })

      await cacheStore.token({
        idpTokenUrl: 'https://example.com/token',
        clientId: 'client-id',
        refreshToken: 'refresh-token'
      })

      assert.deepStrictEqual(JSON.parse(await redisClient.get('test-cache~client-id')), { accessToken: 'new-access-token' })
    })

    test('clear token', async (t) => {
      // const plan = tspl(t, { plan: 9 })
      const refreshMock = mockAgent.get('https://example.com')
      refreshMock.intercept({
        method: 'POST',
        path: '/token',
        body: body => {
          const { refresh_token, grant_type, client_id } = Object.fromEntries(new URLSearchParams(body))
          assert.strictEqual(refresh_token, 'refresh-token')
          assert.strictEqual(grant_type, 'refresh_token')
          assert.strictEqual(client_id, 'client-id')
          return true
        }
      }).reply(200, {
        access_token: 'new-access-token'
      })

      const cacheStore = new TokenStore({
        name: 'test-cache',
        ttl: 100,
        storage: { type: 'redis', options: { client: redisClient } },
        serialize: (key) => key.clientId
      })

      await cacheStore.token({
        idpTokenUrl: 'https://example.com/token',
        clientId: 'client-id',
        refreshToken: 'refresh-token'
      })

      await cacheStore.clear({
        idpTokenUrl: 'https://example.com/token',
        clientId: 'client-id',
        refreshToken: 'refresh-token'
      })

      assert.strictEqual(JSON.parse(await redisClient.get('test-cache~client-id')), null)
    })

    test('should clear token specific options', async (t) => {
      const refreshMock = mockAgent.get('https://example.com')
      refreshMock.intercept({
        method: 'POST',
        path: '/token',
        body: body => {
          const { refresh_token, grant_type, client_id } = Object.fromEntries(new URLSearchParams(body))
          assert.strictEqual(refresh_token, 'refresh-token')
          assert.strictEqual(grant_type, 'refresh_token')
          assert.ok(['client-id', 'client-id-2'].includes(client_id))
          return true
        }
      }).reply(200, {
        access_token: 'new-access-token'
      }).times(2)

      let requestCount = 0
      const cacheStore = new TokenStore({
        name: 'test-cache',
        ttl: 100,
        storage: { type: 'redis', options: { client: redisClient } },
        serialize: (key) => key.clientId,
        onMiss: (key) => {
          requestCount++
          if (requestCount == 1) {
            assert.equal(key, 'client-id')
          } else {
            assert.equal(key, 'client-id-2')
          }
        }
      })

      await cacheStore.token({
        idpTokenUrl: 'https://example.com/token',
        clientId: 'client-id',
        refreshToken: 'refresh-token'
      })

      await cacheStore.token({
        idpTokenUrl: 'https://example.com/token',
        clientId: 'client-id-2',
        refreshToken: 'refresh-token'
      })

      await cacheStore.clear({
        idpTokenUrl: 'https://example.com/token',
        clientId: 'client-id',
        refreshToken: 'refresh-token'
      })

      assert.strictEqual(JSON.parse(await redisClient.get('test-cache~client-id')), null)
      assert.deepStrictEqual(JSON.parse(await redisClient.get('test-cache~client-id-2')), { accessToken: 'new-access-token' })
    })

    test('custom ttl based on exprires', async (t) => {
      const refreshMock = mockAgent.get('https://example.com')
      refreshMock.intercept({
        method: 'POST',
        path: '/token',
        body: body => {
          const { refresh_token, grant_type, client_id } = Object.fromEntries(new URLSearchParams(body))
          assert.strictEqual(refresh_token, 'refresh-token')
          assert.strictEqual(grant_type, 'refresh_token')
          assert.strictEqual(client_id, 'client-id')
          return true
        }
      }).reply(200, {
        access_token: 'new-access-token',
        expires_in: 200
      })

      const cacheStore = new TokenStore({
        name: 'test-cache',
        storage: { type: 'redis', options: { client: redisClient } },
        ttl: (result) => {
          assert.deepStrictEqual(result, { expiresIn: 200, accessToken: 'new-access-token' })
          return result.expiresIn * 50 / 100
        },
        serialize: (key) => key.clientId
      })

      await cacheStore.token({
        idpTokenUrl: 'https://example.com/token',
        clientId: 'client-id',
        refreshToken: 'refresh-token'
      })

      assert.deepStrictEqual(JSON.parse(await redisClient.get('test-cache~client-id')), { accessToken: 'new-access-token', expiresIn: 200 })
      assert.strictEqual(Math.ceil(await redisClient.pttl('test-cache~client-id') / 1000), 100)
    })

    test('default ttl should be 80%', async (t) => {
      const refreshMock = mockAgent.get('https://example.com')
      refreshMock.intercept({
        method: 'POST',
        path: '/token',
        body: body => {
          const { refresh_token, grant_type, client_id } = Object.fromEntries(new URLSearchParams(body))
          assert.strictEqual(refresh_token, 'refresh-token')
          assert.strictEqual(grant_type, 'refresh_token')
          assert.strictEqual(client_id, 'client-id-default')
          return true
        }
      }).reply(200, {
        access_token: 'new-access-token',
        expires_in: 200
      })

      const cacheStore = new TokenStore({
        name: 'test-cache',
        storage: { type: 'redis', options: { client: redisClient } },
        serialize: (key) => key.clientId
      })

      await cacheStore.token({
        idpTokenUrl: 'https://example.com/token',
        clientId: 'client-id-default',
        refreshToken: 'refresh-token'
      })

      assert.deepStrictEqual(JSON.parse(await redisClient.get('test-cache~client-id-default')), { accessToken: 'new-access-token', expiresIn: 200 })
      assert.strictEqual(Math.ceil(await redisClient.pttl('test-cache~client-id-default') / 1000), 160)
    })
  })

  describe('in-memory cache with Redis', async () => {
    afterEach(async () => {
      await redisClient.flushall()
    })

    test('should fetch from in-memory cache on second call', async (t) => {
      let callCount = 0
      const refreshMock = mockAgent.get('https://example.com')
      refreshMock.intercept({
        method: 'POST',
        path: '/token',
        body: body => {
          callCount++
          const { refresh_token, grant_type, client_id } = Object.fromEntries(new URLSearchParams(body))
          assert.strictEqual(refresh_token, 'refresh-token')
          assert.strictEqual(grant_type, 'refresh_token')
          assert.strictEqual(client_id, 'client-id')
          return true
        }
      }).reply(200, {
        access_token: 'new-access-token',
        expires_in: 200
      })

      const cacheStore = new TokenStore({
        name: 'test-cache-mem',
        ttl: 100,
        storage: { type: 'redis', options: { client: redisClient } },
        serialize: (key) => key.clientId,
        useInMemoryCache: true,
        inMemoryCacheTTL: 5000
      })

      const options = {
        idpTokenUrl: 'https://example.com/token',
        clientId: 'client-id',
        refreshToken: 'refresh-token'
      }

      // First call - fetches from IDP and stores in both Redis and memory
      const result1 = await cacheStore.token(options)
      assert.deepStrictEqual(result1, { accessToken: 'new-access-token', expiresIn: 200 })
      assert.strictEqual(callCount, 1)

      // Second call - should fetch from in-memory cache (not Redis or IDP)
      const result2 = await cacheStore.token(options)
      assert.deepStrictEqual(result2, { accessToken: 'new-access-token', expiresIn: 200 })
      assert.strictEqual(callCount, 1) // Should not have called IDP again
    })

    test('should fallback to Redis when in-memory cache expires', async (t) => {
      let callCount = 0
      const refreshMock = mockAgent.get('https://example.com')
      refreshMock.intercept({
        method: 'POST',
        path: '/token',
        body: body => {
          callCount++
          const { refresh_token, grant_type, client_id } = Object.fromEntries(new URLSearchParams(body))
          assert.strictEqual(refresh_token, 'refresh-token')
          assert.strictEqual(grant_type, 'refresh_token')
          assert.strictEqual(client_id, 'client-id')
          return true
        }
      }).reply(200, {
        access_token: 'new-access-token',
        expires_in: 200
      })

      const cacheStore = new TokenStore({
        name: 'test-cache-mem-expire',
        ttl: 10000, // Redis TTL is 10 seconds
        storage: { type: 'redis', options: { client: redisClient } },
        serialize: (key) => key.clientId,
        useInMemoryCache: true,
        inMemoryCacheTTL: 100 // In-memory TTL is only 100ms
      })

      const options = {
        idpTokenUrl: 'https://example.com/token',
        clientId: 'client-id',
        refreshToken: 'refresh-token'
      }

      // First call - fetches from IDP
      await cacheStore.token(options)
      assert.strictEqual(callCount, 1)

      // Wait for in-memory cache to expire
      await new Promise(resolve => setTimeout(resolve, 150))

      // Second call - in-memory expired, should fetch from Redis (not IDP)
      const result2 = await cacheStore.token(options)
      assert.deepStrictEqual(result2, { accessToken: 'new-access-token', expiresIn: 200 })
      assert.strictEqual(callCount, 1) // Should not have called IDP again (still in Redis)
    })

    test('should clear both in-memory and Redis cache', async (t) => {
      let callCount = 0
      const refreshMock = mockAgent.get('https://example.com')
      refreshMock.intercept({
        method: 'POST',
        path: '/token',
        body: body => {
          callCount++
          return true
        }
      }).reply(200, {
        access_token: 'new-access-token',
        expires_in: 200
      }).times(2)

      const cacheStore = new TokenStore({
        name: 'test-cache-clear',
        ttl: 10000,
        storage: { type: 'redis', options: { client: redisClient } },
        serialize: (key) => key.clientId,
        useInMemoryCache: true,
        inMemoryCacheTTL: 10000
      })

      const options = {
        idpTokenUrl: 'https://example.com/token',
        clientId: 'client-id',
        refreshToken: 'refresh-token'
      }

      // First call - stores in both caches
      await cacheStore.token(options)
      assert.strictEqual(callCount, 1)

      // Clear the cache
      await cacheStore.clear(options)

      // Next call should fetch from IDP again (both caches cleared)
      await cacheStore.token(options)
      assert.strictEqual(callCount, 2)
    })

    test('should work with multiple different tokens', async (t) => {
      let callCount = 0
      const refreshMock = mockAgent.get('https://example.com')
      refreshMock.intercept({
        method: 'POST',
        path: '/token',
        body: body => {
          callCount++
          const { client_id } = Object.fromEntries(new URLSearchParams(body))
          return ['client-id-1', 'client-id-2'].includes(client_id)
        }
      }).reply(200, {
        access_token: 'new-access-token',
        expires_in: 200
      }).times(2)

      const cacheStore = new TokenStore({
        name: 'test-cache-multi',
        ttl: 10000,
        storage: { type: 'redis', options: { client: redisClient } },
        serialize: (key) => key.clientId,
        useInMemoryCache: true,
        inMemoryCacheTTL: 10000
      })

      const options1 = {
        idpTokenUrl: 'https://example.com/token',
        clientId: 'client-id-1',
        refreshToken: 'refresh-token'
      }

      const options2 = {
        idpTokenUrl: 'https://example.com/token',
        clientId: 'client-id-2',
        refreshToken: 'refresh-token'
      }

      // Fetch two different tokens
      await cacheStore.token(options1)
      await cacheStore.token(options2)
      assert.strictEqual(callCount, 2)

      // Fetch again - should come from in-memory cache
      await cacheStore.token(options1)
      await cacheStore.token(options2)
      assert.strictEqual(callCount, 2)
    })
  })
})
