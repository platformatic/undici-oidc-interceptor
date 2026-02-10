'use strict'

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const { request, Agent } = require('undici')
const { createOidcInterceptor } = require('../')
const { createToken } = require('./helper')

test('error when refreshing', async (t) => {
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1ms' })

  const mainServer = http.createServer((req, res) => {
    assert.fail('should not be called')
  })
  mainServer.listen(0)

  const tokenServer = http.createServer((req, res) => {
    assert.strictEqual(req.method, 'POST')
    assert.strictEqual(req.url, '/token')

    res.writeHead(400)
    res.end(JSON.stringify({ message: 'kaboom' }))
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
    urls: [`http://localhost:${mainServer.address().port}`],
    idpTokenUrl: `http://localhost:${tokenServer.address().port}/token`,
    clientId: 'client-id'
  }))

  await assert.rejects(request(`http://localhost:${mainServer.address().port}`, { dispatcher }))
})

test('after service rejects the token, token service reject token, error request', async (t) => {
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
  const mainServer = http.createServer((req, res) => {
    res.writeHead(401)
    return res.end()
  })
  mainServer.listen(0)

  const tokenServer = http.createServer((req, res) => {
    assert.strictEqual(req.method, 'POST')
    assert.strictEqual(req.url, '/token')

    res.writeHead(403)
    res.end(JSON.stringify({ message: 'kaboom' }))
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
    idpTokenUrl: `http://localhost:${tokenServer.address().port}`,
    clientId: 'client-id',
    urls: [`http://localhost:${mainServer.address().port}`]
  }))

  assert.rejects(request(`http://localhost:${mainServer.address().port}`, { dispatcher }))
})

test('missing token', async (t) => {
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1ms' })

  const mainServer = http.createServer((req, res) => {
    assert.fail('should not be called')
  })
  mainServer.listen(0)

  const tokenServer = http.createServer((req, res) => {
    assert.strictEqual(req.method, 'POST')
    assert.strictEqual(req.url, '/token')

    res.end(JSON.stringify({ message: 'kaboom' }))
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
    urls: [`http://localhost:${mainServer.address().port}`]
  }))

  await assert.rejects(request(`http://localhost:${mainServer.address().port}`, { dispatcher }))
})

test('201 status code', async (t) => {
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1ms' })

  const mainServer = http.createServer((req, res) => {
    assert.fail('should not be called')
  })
  mainServer.listen(0)

  const tokenServer = http.createServer((req, res) => {
    assert.strictEqual(req.method, 'POST')
    assert.strictEqual(req.url, '/token')

    res.writeHead(201)
    // the response does not matter
    res.end(JSON.stringify({ access_token: 'kaboom' }))
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
    urls: [`http://localhost:${mainServer.address().port}`]
  }))

  await assert.rejects(request(`http://localhost:${mainServer.address().port}`, { dispatcher }))
})

test('wrong token_type', async (t) => {
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1ms' })

  const mainServer = http.createServer((req, res) => {
    assert.fail('should not be called')
  })
  mainServer.listen(0)

  const tokenServer = http.createServer((req, res) => {
    assert.strictEqual(req.method, 'POST')
    assert.strictEqual(req.url, '/token')

    res.writeHead(200)
    res.end(JSON.stringify({ access_token: accessToken, token_type: 'kaboom' }))
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
    urls: [`http://localhost:${mainServer.address().port}`],
    idpTokenUrl: `http://localhost:${tokenServer.address().port}/token`,
    clientId: 'client-id'
  }))

  await assert.rejects(request(`http://localhost:${mainServer.address().port}`, { dispatcher }))
})
