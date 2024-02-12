'use strict'

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const { once, EventEmitter } = require('node:events')
const { request, Agent } = require('undici')
const { createDecoder } = require('fast-jwt')
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
    { expiresIn: '1d', iss: `http://localhost:${tokenServer.address().port}`, sub: 'client-id' }
  )

  const dispatcher = new Agent({
    interceptors: {
      Pool: [createOidcInterceptor({
        accessToken,
        refreshToken,
        retryOnStatusCodes: [401],
        origins: [`http://localhost:${mainServer.address().port}`]
      })]
    }
  })

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
    { expiresIn: '1d', iss: `http://localhost:${tokenServer.address().port}`, sub: 'client-id' }
  )

  const dispatcher = new Agent({
    interceptors: {
      Pool: [createOidcInterceptor({
        accessToken,
        refreshToken,
        retryOnStatusCodes: [401],
        origins: [`http://localhost:${mainServer.address().port}`]
      })]
    }
  })

  assert.rejects(request(`http://localhost:${mainServer.address().port}`, { dispatcher }))
})
