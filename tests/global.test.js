'use strict'

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const { request, Agent, setGlobalDispatcher, getGlobalDispatcher } = require('undici')
const { createOidcInterceptor } = require('../')
const { createToken } = require('./helper')

const originalGlobalDispatcher = getGlobalDispatcher()
test.afterEach(() => setGlobalDispatcher(originalGlobalDispatcher))

test('get an access token if no token provided', async t => {
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

  const refreshToken = createToken({ name: 'refresh' }, { expiresIn: '1d' })

  const dispatcher = new Agent().compose(
    createOidcInterceptor({
      refreshToken,
      retryOnStatusCodes: [401],
      urls: [`http://localhost:${mainServer.address().port}`],
      idpTokenUrl: `http://localhost:${tokenServer.address().port}/token`,
      clientId: 'client-id'
    })
  )

  setGlobalDispatcher(dispatcher)

  const { statusCode } = await request(`http://localhost:${mainServer.address().port}`)
  assert.strictEqual(statusCode, 200)
})

test('get an access token with the same origin as idpTokenUrl', async t => {
  let accessToken = ''
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/token') {
      accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
      res.writeHead(200)
      res.end(JSON.stringify({ access_token: accessToken }))
    } else {
      assert.ok(req.headers.authorization.length > 'Bearer '.length)
      assert.strictEqual(req.headers.authorization, `Bearer ${accessToken}`)
      res.writeHead(200)
      res.end()
    }
  })
  server.listen(0)

  t.after(() => {
    server.close()
  })

  const refreshToken = createToken({ name: 'refresh' }, { expiresIn: '1d' })

  const dispatcher = new Agent().compose(
    createOidcInterceptor({
      refreshToken,
      retryOnStatusCodes: [401],
      urls: [`http://localhost:${server.address().port}`],
      idpTokenUrl: `http://localhost:${server.address().port}/token`,
      clientId: 'client-id'
    })
  )

  setGlobalDispatcher(dispatcher)

  const { statusCode } = await request(`http://localhost:${server.address().port}`)
  assert.strictEqual(statusCode, 200)
})
