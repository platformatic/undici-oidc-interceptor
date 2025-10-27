'use strict'

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const { request, Agent } = require('undici')
const { createOidcInterceptor } = require('../')
const { createToken } = require('./helper')

test('shouldAuthenticate callback - authenticate when returns true', async (t) => {
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
  const refreshToken = createToken(
    { name: 'refresh' },
    { expiresIn: '1d', iss: 'doesntmatter.com', sub: 'client-id' }
  )

  const server = http.createServer((req, res) => {
    assert.strictEqual(req.headers.authorization, `Bearer ${accessToken}`)
    res.writeHead(200)
    res.end()
  })
  server.listen(0)

  t.after(() => server.close())

  const targetUrl = `http://localhost:${server.address().port}`

  const dispatcher = new Agent().compose(createOidcInterceptor({
    accessToken,
    refreshToken,
    idpTokenUrl: 'http://doesntmatter.com/token',
    clientId: 'client-id',
    shouldAuthenticate: (opts) => opts.headers && opts.headers['x-auth'] === 'required'
  }))

  const { statusCode } = await request(targetUrl, {
    dispatcher,
    headers: { 'x-auth': 'required' }
  })
  assert.strictEqual(statusCode, 200)
})

test('shouldAuthenticate callback - skip authentication when returns false', async (t) => {
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
  const refreshToken = createToken(
    { name: 'refresh' },
    { expiresIn: '1d', iss: 'doesntmatter.com', sub: 'client-id' }
  )

  const server = http.createServer((req, res) => {
    assert.strictEqual(req.headers.authorization, undefined, 'should not have authorization header')
    res.writeHead(200)
    res.end()
  })
  server.listen(0)

  t.after(() => server.close())

  const targetUrl = `http://localhost:${server.address().port}`

  const dispatcher = new Agent().compose(createOidcInterceptor({
    accessToken,
    refreshToken,
    idpTokenUrl: 'http://doesntmatter.com/token',
    clientId: 'client-id',
    shouldAuthenticate: (opts) => opts.headers && opts.headers['x-auth'] === 'required'
  }))

  const { statusCode } = await request(targetUrl, {
    dispatcher,
    headers: { 'x-auth': 'not-required' }
  })
  assert.strictEqual(statusCode, 200)
})

test('shouldAuthenticate has higher priority than urls - authenticate with shouldAuthenticate true', async (t) => {
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
  const refreshToken = createToken(
    { name: 'refresh' },
    { expiresIn: '1d', iss: 'doesntmatter.com', sub: 'client-id' }
  )

  const server = http.createServer((req, res) => {
    assert.strictEqual(req.headers.authorization, `Bearer ${accessToken}`)
    res.writeHead(200)
    res.end()
  })
  server.listen(0)

  t.after(() => server.close())

  const targetUrl = `http://localhost:${server.address().port}`

  const dispatcher = new Agent().compose(createOidcInterceptor({
    accessToken,
    refreshToken,
    urls: [], // Empty urls, but shouldAuthenticate should take priority
    idpTokenUrl: 'http://doesntmatter.com/token',
    clientId: 'client-id',
    shouldAuthenticate: (opts) => opts.headers && opts.headers['x-auth'] === 'required'
  }))

  const { statusCode } = await request(targetUrl, {
    dispatcher,
    headers: { 'x-auth': 'required' }
  })
  assert.strictEqual(statusCode, 200)
})

test('shouldAuthenticate has higher priority than urls - skip authentication with shouldAuthenticate false', async (t) => {
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
  const refreshToken = createToken(
    { name: 'refresh' },
    { expiresIn: '1d', iss: 'doesntmatter.com', sub: 'client-id' }
  )

  const server = http.createServer((req, res) => {
    assert.strictEqual(req.headers.authorization, undefined, 'should not have authorization header')
    res.writeHead(200)
    res.end()
  })
  server.listen(0)

  t.after(() => server.close())

  const targetUrl = `http://localhost:${server.address().port}`

  const dispatcher = new Agent().compose(createOidcInterceptor({
    accessToken,
    refreshToken,
    urls: [targetUrl], // URL is in list, but shouldAuthenticate should take priority
    idpTokenUrl: 'http://doesntmatter.com/token',
    clientId: 'client-id',
    shouldAuthenticate: (opts) => opts.headers && opts.headers['x-auth'] === 'required'
  }))

  const { statusCode } = await request(targetUrl, {
    dispatcher,
    headers: { 'x-auth': 'not-required' }
  })
  assert.strictEqual(statusCode, 200)
})

test('shouldAuthenticate callback with token refresh on 401', async (t) => {
  let accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })

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

  const refreshToken = createToken(
    { name: 'refresh' },
    { expiresIn: '1d' }
  )

  const dispatcher = new Agent().compose(createOidcInterceptor({
    accessToken,
    refreshToken,
    retryOnStatusCodes: [401],
    idpTokenUrl: `http://localhost:${tokenServer.address().port}/token`,
    clientId: 'client-id',
    shouldAuthenticate: (opts) => opts.headers && opts.headers['x-auth'] === 'required'
  }))

  const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, {
    dispatcher,
    headers: { 'x-auth': 'required' }
  })
  assert.strictEqual(statusCode, 200)
})

test('shouldAuthenticate callback with expired token', async (t) => {
  let accessToken = createToken({ name: 'access' }, { expiresIn: '1ms' })

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

  const refreshToken = createToken(
    { name: 'refresh' },
    { expiresIn: '1d', sub: 'client-id' }
  )

  const dispatcher = new Agent().compose(createOidcInterceptor({
    accessToken,
    refreshToken,
    retryOnStatusCodes: [401],
    idpTokenUrl: `http://localhost:${tokenServer.address().port}/token`,
    clientId: 'client-id',
    shouldAuthenticate: (opts) => opts.headers && opts.headers['x-auth'] === 'required'
  }))

  const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, {
    dispatcher,
    headers: { 'x-auth': 'required' }
  })
  assert.strictEqual(statusCode, 200)
})

test('without shouldAuthenticate, fallback to urls behavior', async (t) => {
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
  const refreshToken = createToken(
    { name: 'refresh' },
    { expiresIn: '1d' }
  )

  const server = http.createServer((req, res) => {
    assert.strictEqual(req.headers.authorization, `Bearer ${accessToken}`)
    res.writeHead(200)
    res.end()
  })
  server.listen(0)

  t.after(() => server.close())

  const targetUrl = `http://localhost:${server.address().port}`

  const dispatcher = new Agent().compose(createOidcInterceptor({
    accessToken,
    refreshToken,
    urls: [targetUrl],
    idpTokenUrl: 'http://doesntmatter.com/token',
    clientId: 'client-id'
    // No shouldAuthenticate provided, should use urls
  }))

  const { statusCode } = await request(targetUrl, { dispatcher })
  assert.strictEqual(statusCode, 200)
})

test('without shouldAuthenticate, fallback to urls behavior - no match', async (t) => {
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
  const refreshToken = createToken(
    { name: 'refresh' },
    { expiresIn: '1d' }
  )

  const server = http.createServer((req, res) => {
    assert.strictEqual(req.headers.authorization, undefined, 'should not have authorization header')
    res.writeHead(200)
    res.end()
  })
  server.listen(0)

  t.after(() => server.close())

  const targetUrl = `http://localhost:${server.address().port}`

  const dispatcher = new Agent().compose(createOidcInterceptor({
    accessToken,
    refreshToken,
    urls: ['http://different-host.com'],
    idpTokenUrl: 'http://doesntmatter.com/token',
    clientId: 'client-id'
    // No shouldAuthenticate provided, should use urls
  }))

  const { statusCode } = await request(targetUrl, { dispatcher })
  assert.strictEqual(statusCode, 200)
})

test('shouldAuthenticate callback with various request properties', async (t) => {
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
  const refreshToken = createToken(
    { name: 'refresh' },
    { expiresIn: '1d' }
  )

  let requestCount = 0
  const server = http.createServer((req, res) => {
    requestCount++
    if (requestCount === 1) {
      // First request should have auth header
      assert.strictEqual(req.headers.authorization, `Bearer ${accessToken}`)
    } else {
      // Second request should not have auth header
      assert.strictEqual(req.headers.authorization, undefined)
    }
    res.writeHead(200)
    res.end()
  })
  server.listen(0)

  t.after(() => server.close())

  const targetUrl = `http://localhost:${server.address().port}`

  const dispatcher = new Agent().compose(createOidcInterceptor({
    accessToken,
    refreshToken,
    idpTokenUrl: 'http://doesntmatter.com/token',
    clientId: 'client-id',
    shouldAuthenticate: (opts) => {
      // Authenticate only for POST requests
      return opts.method === 'POST'
    }
  }))

  // First request with POST
  const { statusCode: statusCode1 } = await request(targetUrl, {
    dispatcher,
    method: 'POST',
    body: 'test'
  })
  assert.strictEqual(statusCode1, 200)

  // Second request with GET
  const { statusCode: statusCode2 } = await request(targetUrl, {
    dispatcher,
    method: 'GET'
  })
  assert.strictEqual(statusCode2, 200)

  assert.strictEqual(requestCount, 2)
})
