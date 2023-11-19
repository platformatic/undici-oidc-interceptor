'use strict'

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const { once, EventEmitter } = require('node:events')
const { request, Agent } = require('undici')
const { createDecoder } = require('fast-jwt')
const { createOAuthInterceptor } = require('../OAuthDispatcher')
const { createToken } = require('./helper.js')

test('attach provided access token to the request', async (t) => {
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
  const server = http.createServer((req, res) => {
    assert.strictEqual(req.headers.authorization, `Bearer ${accessToken}`)
    res.writeHead(200)
    res.end()
  })
  server.listen(0)

  t.after(() => server.close())

  const dispatcher = new Agent({
    interceptors: {
      Pool: [createOAuthInterceptor({ accessToken })]
    }
  })

  const { statusCode } = await request(`http://localhost:${server.address().port}`, { dispatcher })
  assert.strictEqual(statusCode, 200)
})

test('get an access token if no token provided', async (t) => {
  const refreshToken = createToken({ name: 'refresh' }, { expiresIn: '1d' })

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

  const dispatcher = new Agent({
    interceptors: {
      Pool: [createOAuthInterceptor({
        refreshToken,
        clientId: 'client-id',
        refreshHost: `http://localhost:${tokenServer.address().port}`
      })]
    }
  })

  const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
  assert.strictEqual(statusCode, 200)
})

test('refresh access token if expired', async (t) => {
  let accessToken = createToken({ name: 'access' }, { expiresIn: '1ms' })
  const refreshToken = createToken({ name: 'refresh' }, { expiresIn: '1d' })

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

  const dispatcher = new Agent({
    interceptors: {
      Pool: [createOAuthInterceptor({
        accessToken,
        refreshToken,
        clientId: 'client-id',
        refreshHost: `http://localhost:${tokenServer.address().port}`
      })]
    }
  })

  const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
  assert.strictEqual(statusCode, 200)
})

test('refresh access token if server rejects, retry request', { only: true }, async (t) => {
  let accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
  const refreshToken = createToken({ name: 'refresh' }, { expiresIn: '1d' })
  const ee = new EventEmitter()

  let rejectRequest = true
  const mainServer = http.createServer((req, res) => {
    if (rejectRequest) {
      rejectRequest = false
      res.writeHead(401)
      return res.end()
    }

    assert.ok(req.headers.authorization.length > 'Bearer '.length)
    assert.strictEqual(req.headers.authorization, `Bearer ${accessToken}`)
    res.writeHead(200)
    res.end()
    ee.emit('request-processed')
  })
  mainServer.listen(0)

  const tokenServer = http.createServer((req, res) => {
    console.log('tokenServer', req.url)
    assert.strictEqual(req.method, 'POST')
    assert.strictEqual(req.url, '/token')

    accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
    res.writeHead(200)
    res.end(JSON.stringify({ access_token: accessToken }))
    ee.emit('token-refreshed')
  })
  tokenServer.listen(0)

  t.after(() => {
    mainServer.close()
    tokenServer.close()
  })

  const dispatcher = new Agent({
    interceptors: {
      Pool: [createOAuthInterceptor({
        accessToken,
        refreshToken,
        clientId: 'client-id',
        refreshHost: `http://localhost:${tokenServer.address().port}`
      })]
    }
  })

  const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
  assert.strictEqual(statusCode, 200)
  await once(ee, 'token-refreshed')
  await once(ee, 'request-processed')
})
