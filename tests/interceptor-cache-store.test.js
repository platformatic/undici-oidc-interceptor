'use strict'

const { test, describe, before, after, afterEach, beforeEach } = require('node:test')
const assert = require('node:assert')
const Redis = require('ioredis')
const http = require('node:http')
const { request, Agent } = require('undici')
const { setTimeout: sleep } = require('node:timers/promises')
const { createToken } = require('./helper')
const createOidcInterceptor = require('../oidc-interceptor')

const redisClient = new Redis()

describe('interceptor cache store', async () => {
  beforeEach(async () => {
    await redisClient.flushall()
  })

  after(async () => {
    redisClient.quit()
  })

  test('create an access token and store it in cache', async (t) => {
    let accessToken = ''
    const mainServer = http.createServer((req, res) => {
      assert.ok(req.headers.authorization.length > 'Bearer '.length)
      assert.strictEqual(req.headers.authorization, `Bearer ${accessToken}`)
      res.writeHead(200)
      res.end()
    })
    mainServer.listen(0)

    const tokenServer = http.createServer((req, res) => {
      assert.strictEqual(req.method, 'POST')
      assert.strictEqual(req.url, '/token')

      accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
      res.writeHead(200)
      res.end(JSON.stringify({ access_token: accessToken }))
    })
    tokenServer.listen(0)

    t.after(() => {
      mainServer.close()
      tokenServer.close()
    })


    const dispatcher = new Agent().compose(createOidcInterceptor({
      retryOnStatusCodes: [401],
      clientId: 'client-id',
      idpTokenUrl: `http://localhost:${tokenServer.address().port}/token`,
      urls: [`http://localhost:${mainServer.address().port}`],
      tokenStore: {
        ttl: 100,
        storage: { type: 'memory' }
      }
    }))

    const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
    assert.strictEqual(statusCode, 200)
  })

  test('create an access token and store it in redis cache', async (t) => {
    let accessToken = ''
    const mainServer = http.createServer((req, res) => {
      assert.ok(req.headers.authorization.length > 'Bearer '.length)
      assert.strictEqual(req.headers.authorization, `Bearer ${accessToken}`)
      res.writeHead(200)
      res.end()
    })
    mainServer.listen(0)

    const tokenServer = http.createServer((req, res) => {
      assert.strictEqual(req.method, 'POST')
      assert.strictEqual(req.url, '/token')

      accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
      res.writeHead(200)
      res.end(JSON.stringify({ access_token: accessToken }))
    })
    tokenServer.listen(0)

    t.after(() => {
      mainServer.close()
      tokenServer.close()
    })

    const dispatcher = new Agent().compose(createOidcInterceptor({
      retryOnStatusCodes: [401],
      clientId: 'client-id',
      idpTokenUrl: `http://localhost:${tokenServer.address().port}/token`,
      urls: [`http://localhost:${mainServer.address().port}`],
      tokenStore: {
        name: 'test-cache',
        ttl: 100,
        storage: { type: 'redis', options: { client: redisClient } },
        serialize: (key) => key.clientId
      }
    }))

    const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
    assert.strictEqual(statusCode, 200)
    assert.deepStrictEqual(JSON.parse(await redisClient.get('test-cache~client-id')), {accessToken})
  })

  test('regenerate access token as the store cache is expiried', async (t) => {
    let accessToken = ''
    const mainServer = http.createServer((req, res) => {
      assert.ok(req.headers.authorization.length > 'Bearer '.length)
      assert.strictEqual(req.headers.authorization, `Bearer ${accessToken}`)
      res.writeHead(200)
      res.end()
    })
    mainServer.listen(0)

    const tokenServer = http.createServer((req, res) => {
      assert.strictEqual(req.method, 'POST')
      assert.strictEqual(req.url, '/token')

      accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
      res.writeHead(200)
      res.end(JSON.stringify({ access_token: accessToken }))
    })
    tokenServer.listen(0)

    t.after(() => {
      mainServer.close()
      tokenServer.close()
    })

    const dispatcher = new Agent().compose(createOidcInterceptor({
      retryOnStatusCodes: [401],
      clientId: 'client-id',
      idpTokenUrl: `http://localhost:${tokenServer.address().port}/token`,
      urls: [`http://localhost:${mainServer.address().port}`],
      tokenStore: {
        name: 'test-cache',
        ttl: 1,
        storage: { type: 'redis', options: { client: redisClient } },
        serialize: (key) => key.clientId
      }
    }))

    const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
    const oldAccessToken = accessToken

    assert.strictEqual(statusCode, 200)
    assert.deepStrictEqual(JSON.parse(await redisClient.get('test-cache~client-id')), {accessToken: oldAccessToken})

    await sleep(1000)
    assert.strictEqual(JSON.parse(await redisClient.get('test-cache~client-id')), null)

    const { statusCode: statusCode2 } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
    const newAccessToken = accessToken

    assert.strictEqual(statusCode2, 200)
    assert.deepStrictEqual(JSON.parse(await redisClient.get('test-cache~client-id')), {accessToken: newAccessToken})
    assert.notStrictEqual(oldAccessToken, newAccessToken)
  })

  test('should invalidate access token after fetching from cache', async (t) => {
    let accessToken = ''
    const mainServer = http.createServer((req, res) => {
      assert.ok(req.headers.authorization.length > 'Bearer '.length)
      assert.strictEqual(req.headers.authorization, `Bearer ${accessToken}`)
      res.writeHead(200)
      res.end()
    })
    mainServer.listen(0)

    let tokenRequestCount = 0
    const tokenServer = http.createServer((req, res) => {
      assert.strictEqual(req.method, 'POST')
      assert.strictEqual(req.url, '/token')
      tokenRequestCount += 1
      accessToken = createToken({ name: 'access' }, { expiresIn: '31s' })
      res.writeHead(200)
      res.end(JSON.stringify({ access_token: accessToken }))
    })
    tokenServer.listen(0)

    t.after(() => {
      mainServer.close()
      tokenServer.close()
    })

    const dispatcher = new Agent().compose(createOidcInterceptor({
      retryOnStatusCodes: [401],
      clientId: 'client-id',
      idpTokenUrl: `http://localhost:${tokenServer.address().port}/token`,
      urls: [`http://localhost:${mainServer.address().port}`],
      tokenStore: {
        name: 'test-cache',
        ttl: 1,
        storage: { type: 'redis', options: { client: redisClient } },
        serialize: (key) => key.clientId
      }
    }))

    const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
    assert.strictEqual(statusCode, 200)

    await sleep(1000)

    const { statusCode: statusCode2 } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
    assert.strictEqual(statusCode2, 200)

    assert.strictEqual(tokenRequestCount, 2)
  })

  test('should regenerate access token before expiration', async (t) => {
    let accessToken = ''
    const mainServer = http.createServer((req, res) => {
      assert.ok(req.headers.authorization.length > 'Bearer '.length)
      assert.strictEqual(req.headers.authorization, `Bearer ${accessToken}`)
      res.writeHead(200)
      res.end()
    })
    mainServer.listen(0)

    let tokenRequestCount = 0
    const tokenServer = http.createServer((req, res) => {
      assert.strictEqual(req.method, 'POST')
      assert.strictEqual(req.url, '/token')
      tokenRequestCount += 1
      accessToken = createToken({ name: 'access' }, { expiresIn: '29s' })
      res.writeHead(200)
      res.end(JSON.stringify({ access_token: accessToken }))
    })
    tokenServer.listen(0)

    t.after(() => {
      mainServer.close()
      tokenServer.close()
    })

    const dispatcher = new Agent().compose(createOidcInterceptor({
      retryOnStatusCodes: [401],
      clientId: 'client-id',
      idpTokenUrl: `http://localhost:${tokenServer.address().port}/token`,
      urls: [`http://localhost:${mainServer.address().port}`],
      tokenStore: {
        name: 'test-cache',
        ttl: 1,
        storage: { type: 'redis', options: { client: redisClient } },
        serialize: (key) => key.clientId
      }
    }))

    const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
    assert.strictEqual(statusCode, 200)
    assert.strictEqual(tokenRequestCount, 1)
  })

  test('should regenerate access token after expiration and request with new token only', async (t) => {
    const accessToken = ''; let oldAccessToken = ''; let newAccessToken = ''
    let tokenRequestCount = 0
    const mainServer = http.createServer((req, res) => {
      assert.ok(req.headers.authorization.length > 'Bearer '.length)
      assert.strictEqual(req.headers.authorization, `Bearer ${newAccessToken}`)
      res.writeHead(200)
      res.end()
    })
    mainServer.listen(0)

    const tokenServer = http.createServer((req, res) => {
      assert.strictEqual(req.method, 'POST')
      assert.strictEqual(req.url, '/token')
      tokenRequestCount += 1

      if (tokenRequestCount === 1) {
        oldAccessToken = createToken({ name: 'access' }, { expiresIn: '1s' })
        res.writeHead(200)
        res.end(JSON.stringify({ access_token: oldAccessToken }))
      } else {
        newAccessToken = createToken({ name: 'access' }, { expiresIn: '32s' })
        res.writeHead(200)
        res.end(JSON.stringify({ access_token: newAccessToken }))
      }
    })
    tokenServer.listen(0)

    t.after(() => {
      mainServer.close()
      tokenServer.close()
    })

    const dispatcher = new Agent().compose(createOidcInterceptor({
      retryOnStatusCodes: [401],
      clientId: 'client-id',
      idpTokenUrl: `http://localhost:${tokenServer.address().port}/token`,
      urls: [`http://localhost:${mainServer.address().port}`],
      tokenStore: {
        name: 'test-cache',
        ttl: 1,
        storage: { type: 'redis', options: { client: redisClient } },
        serialize: (key) => key.clientId
      }
    }))

    const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
    assert.strictEqual(statusCode, 200)
    assert.strictEqual(tokenRequestCount, 2)
  })
})
