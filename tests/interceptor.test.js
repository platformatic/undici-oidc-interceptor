'use strict'

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const { request } = require('undici')
const { createDecoder } = require('fast-jwt')
const OAuthDispatcher = require('../OAuthDispatcher')
const { createToken } = require('./helper.js')

function echoServer () {
  return http.createServer((req, res) => {
    const { authorization } = req.headers
    const [, token] = authorization.split(' ')
    res.writeHead(200)
    res.end(JSON.stringify({ token }))
  })
}

test('attach provided access and refresh tokens to the request', async (t) => {
  const server = echoServer()
  t.after(() => server.close())

  server.listen(0)
  const { port } = server.address()
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
  const refreshToken = createToken({ name: 'refresh' }, { expiresIn: '1d' })

  const dispatcher = new OAuthDispatcher({
    affected: [`http://localhost:${port}`],
    accessToken,
    refreshToken,
    clientId: 'client-id'
  })

  const { statusCode, body } = await request(`http://localhost:${port}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ hello: 'world' }),
    dispatcher
  })

  assert.strictEqual(statusCode, 200)

  const { token } = await body.json()
  assert.strictEqual(token, accessToken)
})

test('refresh access token if expired', async (t) => {
  const refreshServer = http.createServer((req, res) => {
    const accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
    res.writeHead(200)
    res.end(JSON.stringify({ access_token: accessToken }))
  })
  refreshServer.listen(0)

  const server = echoServer()
  t.after(() => {
    refreshServer.close()
    server.close()
  })

  server.listen(0)
  const { port } = server.address()
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1ms' })
  const refreshToken = createToken({ name: 'refresh' }, { expiresIn: '1d' })

  const dispatcher = new OAuthDispatcher({
    affected: [`http://localhost:${port}`],
    accessToken,
    refreshToken,
    clientId: 'client-id',
    refreshEndpoint: `http://localhost:${refreshServer.address().port}/refresh`
  })

  const { statusCode, body } = await request(`http://localhost:${port}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ hello: 'world' }),
    dispatcher
  })

  assert.strictEqual(statusCode, 200)

  const { token } = await body.json()
  assert.notStrictEqual(token, accessToken)
})

test('fail if refresh token is broken', async (t) => {
  const refreshServer = http.createServer((req, res) => {
    res.writeHead(400)
    res.end(JSON.stringify({
      code: 'PLT_JWT_EXPIRED',
      statusCode: 400,
      message: 'JWT expired: refresh_token',
      error: 'Bad Request'
    }))
  })

  const server = echoServer()
  t.after(() => {
    refreshServer.close()
    server.close()
  })

  server.listen(0)
  refreshServer.listen(0)

  const { port } = server.address()
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1ms' })
  const refreshToken = createToken({ name: 'refresh' }, { expiresIn: '1ms' })

  const dispatcher = new OAuthDispatcher({
    affected: [`http://localhost:${port}`],
    accessToken,
    refreshToken,
    clientId: 'client-id',
    refreshEndpoint: `http://localhost:${refreshServer.address().port}/refresh`
  })

  await assert.rejects(request(`http://localhost:${port}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ hello: 'world' }),
    dispatcher
  }), /Failed to refresh access token - JWT expired: refresh_token/)
})

test('access token expired and refreshed client-side', async (t) => {
  const decode = createDecoder()
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1ms' })
  const refreshToken = createToken({ name: 'refresh' }, { expiresIn: '1ms' })

  const tokenServer = http.createServer((req, res) => {
    assert.strictEqual(req.method, 'POST')
    assert.strictEqual(req.url, '/token')

    let body = ''
    req.on('data', chunk => body += chunk.toString())
    req.on('end', () => {
      const result = JSON.parse(body)
      assert.strictEqual(result.grant_type, 'refresh_token')
    })

    const accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
    res.writeHead(200)
    res.end(JSON.stringify({ access_token: accessToken }))
  })
  tokenServer.listen(0)

  const server = http.createServer((req, res) => {
    assert.strictEqual(req.method, 'GET')
    assert.strictEqual(req.url, '/')

    const [, refreshedAccessToken] = req.headers.authorization.split(' ')
    assert.ok(refreshedAccessToken !== accessToken, 'access token should be refreshed')

    const { exp } = decode(refreshedAccessToken)
    assert.ok(exp > Date.now() / 1000, 'access token should be valid')

    res.writeHead(200)
    res.end()
  })
  server.listen(0)

  t.after(() => {
    tokenServer.close()
    server.close()
  })

  const dispatcher = new OAuthDispatcher({
    affected: [`http://localhost:${server.address().port}`],
    accessToken,
    refreshToken,
    clientId: 'client-id',
    refreshEndpoint: `http://localhost:${tokenServer.address().port}`
  })

  const { statusCode } = await request(`http://localhost:${server.address().port}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    },
    dispatcher
  })

  assert.strictEqual(statusCode, 200)
})
