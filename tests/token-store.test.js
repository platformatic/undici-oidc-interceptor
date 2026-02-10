'use strict'

const { test, describe, before, after, afterEach } = require('node:test')
const assert = require('node:assert')
const Redis = require('ioredis')
const TokenStore = require('../lib/token-store')
const { setGlobalDispatcher, MockAgent } = require('undici')

const mockAgent = new MockAgent()
setGlobalDispatcher(mockAgent)
mockAgent.disableNetConnect()

const redisClient = new Redis('redis://localhost:6379?db=1')

describe('cache store', async () => {
  before(async () => {
    await redisClient.flushdb()
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
})
