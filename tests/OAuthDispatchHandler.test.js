'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { createServer } = require('node:http')
const { once, EventEmitter } = require('node:events')
const { Client } = require('undici')
const { createDecoder } = require('fast-jwt')
const OAuthHandler = require('../OAuthDispatchHandler.js')
const { createToken } = require('./helper.js')

test('should do nothing, just pass through', async (t) => {
  // create access and refresh tokens
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
  const refreshToken = createToken({ name: 'refresh' })
  const ee = new EventEmitter()

  // create server and check requests
  const server = createServer((req, res) => {
    ee.emit('request', req.headers)
    res.writeHead(200)
    res.end()
  })
  server.listen(0)

  // create oauth handler
  const client = new Client(`http://localhost:${server.address().port}`)
  const handler = new OAuthHandler(
    {
      oauthOpts: {
        accessToken,
        refreshToken,
        retryOnStatuses: [401],
      }
    },
    client.dispatch.bind(client),
    {
      onConnect () {
        assert.ok(true)
      },
      onBodySent () { assert.ok(true) },
      onHeaders (status, headers) {
        assert.strictEqual(status, 200)
        return true
      },
      onData () { assert.ok(true) },
      onComplete () { assert.ok(true) },
      onError (err) {
        assert.fail('Unexpected error in handler')
      }
    }
  )

  t.after(async () => {
    await client.close()
    server.close()
  })

  const result = await client.dispatch({
    method: 'GET',
    path: '/',
    headers: {
      'content-type': 'application/json'
    },
  }, handler)

  const [headers] = await once(ee, 'request')
  assert.strictEqual(headers.authorization, undefined)
})

test('request a new access token and retry when server rejects', { only: true }, async (t) => {
  // create access and refresh tokens
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1ms' })
  const refreshToken = createToken({ name: 'refresh' })
  const ee = new EventEmitter()
  const decode = createDecoder()

  // create server and check requests
  const server = createServer((req, res) => {
    console.log('server')
    if (!req.headers.authorization) {
      console.log('no auth')
      res.writeHead(403)
      return res.end()
    }

    console.log('authed')
    ee.emit('request', req.headers)

    res.writeHead(200)
    res.end()
  })
  server.listen(0)

  const tokenServer = createServer((req, res) => {
    console.log('token server')
    assert.strictEqual(req.method, 'POST')
    assert.strictEqual(req.url, '/token')

    let body = ''
    req.on('data', chunk => body += chunk.toString())
    req.on('end', () => {
      const result = JSON.parse(body)
      assert.strictEqual(result.grant_type, 'refresh_token')
      ee.emit('token-request')
    })

    const accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
    console.log('from token server', accessToken)
    res.writeHead(200)
    res.end(JSON.stringify({ access_token: accessToken }))
  })
  tokenServer.listen(0)

  const dispatchOpts = {
    method: 'GET',
    path: '/',
    headers: {
      'content-type': 'application/json'
    }
  }

  // create oauth handler
  const client = new Client(`http://localhost:${server.address().port}`)
  const handler = new OAuthHandler(
    {
      oauthOpts: {
        accessToken,
        refreshToken,
        retryOnStatuses: [401, 403],
        refreshTokenUrl: `http://localhost:${tokenServer.address().port}`
      },
      ...dispatchOpts
    },
    client.dispatch.bind(client),
    {
      onConnect () { assert.ok(true) },
      onBodySent () { assert.ok(true) },
      onHeaders (status, headers) { assert.ok(true) },
      onData () { assert.ok(true) },
      onComplete () { assert.ok(true) },
      onError (err) {
        assert.fail('Unexpected error in handler')
      }
    }
  )

  t.after(async () => {
    await client.close()
    server.close()
    tokenServer.close()
  })

  await client.dispatch(dispatchOpts, handler)
  await once(ee, 'token-request')
})
