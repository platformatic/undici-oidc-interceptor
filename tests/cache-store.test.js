'use strict'

const { test, describe, before, beforeEach, after } = require('node:test')
const assert = require('node:assert')
const Redis = require('ioredis')
const { createTokenStore } = require('../cache-store')
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
      const cacheStore = createTokenStore({
        ttl: 30000,
        storage: { type: 'memory' }
      })

      assert.ok(cacheStore)
      assert.ok(cacheStore.token)
    })

    test('creates a cache instance with in-memory store', async () => {
      const cacheStore = createTokenStore({
        ttl: 30000,
        storage: { type: 'memory' },
        inMemoryCacheTTL: 10000
      })

      assert.ok(cacheStore.token)
    })
  })

  describe('token retrieval', async () => {
    test('retrieve token with key serialization', async (t) => {
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

      const cacheStore = createTokenStore({
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

      assert.strictEqual(JSON.parse(await redisClient.get('test-cache~client-id')), 'new-access-token')
    })
  })
})
