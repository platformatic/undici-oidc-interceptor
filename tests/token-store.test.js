'use strict'

const { test, describe, before, beforeEach, after } = require('node:test')
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
        inMemoryCacheTTL: 10000
      })

      assert.ok(cacheStore.token)
    })
  })

  describe('token', async () => {
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

      assert.strictEqual(JSON.parse(await redisClient.get('test-cache~client-id')), 'new-access-token')
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
      let requestCount = 0
      const refreshMock = mockAgent.get('https://example.com')
      refreshMock.intercept({
        method: 'POST',
        path: '/token',
        body: body => {
          requestCount++
          const { refresh_token, grant_type, client_id } = Object.fromEntries(new URLSearchParams(body))
          assert.strictEqual(refresh_token, 'refresh-token')
          assert.strictEqual(grant_type, 'refresh_token')
          if(requestCount === 1) {
            assert.strictEqual(client_id, 'client-id')
          } else {
            assert.strictEqual(client_id, 'client-id-2')
          }
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
      assert.strictEqual(JSON.parse(await redisClient.get('test-cache~client-id-2')), 'new-access-token')
    })
  })
})
