'use strict'

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const { once, EventEmitter } = require('node:events')
const { request, Agent } = require('undici')
const { createDecoder } = require('fast-jwt')
const { createOidcInterceptor } = require('../')
const { createToken } = require('./helper')

test('attach provided access token to the request', async (t) => {
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

  const origin = `http://localhost:${server.address().port}`

  const dispatcher = new Agent({
    interceptors: {
      Pool: [createOidcInterceptor({ accessToken, refreshToken, origins: [origin] })]
    }
  })

  const { statusCode } = await request(origin, { dispatcher })
  assert.strictEqual(statusCode, 200)
})

test('get an access token if no token provided', async (t) => {
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

  const refreshToken = createToken(
    { name: 'refresh' },
    { expiresIn: '1d', iss: `http://localhost:${tokenServer.address().port}` }
  )

  const dispatcher = new Agent({
    interceptors: {
      Pool: [createOidcInterceptor({
        refreshToken,
        retryOnStatusCodes: [401],
        clientId: 'client-id',
        origins: [`http://localhost:${mainServer.address().port}`]
      })]
    }
  })

  const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
  assert.strictEqual(statusCode, 200)
})

test('refresh access token if expired', async (t) => {
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

  const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
  assert.strictEqual(statusCode, 200)
})

test('refresh token within refresh window', async (t) => {
  const oldAccessToken = createToken({ name: 'access' }, { expiresIn: '29s' })
  const newAccessToken = createToken({ name: 'access' }, { expiresIn: '1d' })

  const mainServer = http.createServer((req, res) => {
    assert.ok(req.headers.authorization.length > 'Bearer '.length)
    assert.strictEqual(req.headers.authorization, `Bearer ${oldAccessToken}`)
    res.writeHead(200)
    res.end()
  })
  mainServer.listen(0)

  const tokenServer = http.createServer((req, res) => {
    assert.strictEqual(req.method, 'POST')
    assert.strictEqual(req.url, '/token')

    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      const { grant_type } = Object.fromEntries(new URLSearchParams(body))
      assert.strictEqual(grant_type, 'refresh_token')
    })

    res.writeHead(200)
    res.end(JSON.stringify({ access_token: newAccessToken }))
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
        accessToken: oldAccessToken,
        refreshToken,
        retryOnStatusCodes: [401],
        origins: [`http://localhost:${mainServer.address().port}`]
      })]
    }
  })

  const tokenRefreshed = once(dispatcher, 'oauth:token-refreshed')

  const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
  assert.strictEqual(statusCode, 200)

  await tokenRefreshed
})

test('do not refresh just outside of refresh window', async (t) => {
  let accessToken = createToken({ name: 'access' }, { expiresIn: '40s' }) // 10s outside of refresh window

  const mainServer = http.createServer((req, res) => {
    assert.ok(req.headers.authorization.length > 'Bearer '.length)
    assert.strictEqual(req.headers.authorization, `Bearer ${accessToken}`)
    res.writeHead(200)
    res.end()
  })
  mainServer.listen(0)

  const tokenServer = http.createServer((req, res) => {
    t.fail('should not be called')
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

  const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
  assert.strictEqual(statusCode, 200)
})

test('refresh access token if server rejects, retry request', async (t) => {
  let accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
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

  const p = Promise.all([
    once(ee, 'token-refreshed'),
    once(ee, 'request-processed')
  ])

  const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
  assert.strictEqual(statusCode, 200)

  await p
})

test('do not intercept request', async (t) => {
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })

  const server = http.createServer((req, res) => {
    res.writeHead(200)
    res.end()
  })
  server.listen(0)

  const tokenServer = http.createServer((req, res) => {
    assert.fail('should not be called')
    res.writeHead(200)
    res.end(JSON.stringify({ access_token: accessToken }))
  })
  tokenServer.listen(0)

  t.after(() => {
    server.close()
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
        interceptDomains: ['example.com'],
        origins: [`localhost:${server.address().port}`]
      })]
    }
  })

  const { statusCode } = await request(`http://localhost:${server.address().port}`, { dispatcher })
  assert.strictEqual(statusCode, 200)
})

test('request is intercepted', async (t) => {
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })

  const server = http.createServer((req, res) => {
    assert.strictEqual(req.headers.authorization, `Bearer ${accessToken}`)
    res.writeHead(200)
    res.end()
  })
  server.listen(0)

  const tokenServer = http.createServer((req, res) => {
    assert.strictEqual(req.method, 'POST')
    assert.strictEqual(req.url, '/token')
    res.writeHead(200)
    res.end(JSON.stringify({ access_token: accessToken }))
  })
  tokenServer.listen(0)

  t.after(() => {
    server.close()
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
        origins: [`localhost:${server.address().port}`]
      })]
    }
  })

  const { statusCode } = await request(`http://localhost:${server.address().port}`, {
    dispatcher,
    headers: { authorization: `Bearer ${accessToken}` }
  })
  assert.strictEqual(statusCode, 200)
})

test('token created only once', async (t) => {
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
    tokenRequestCount += 1
    if (tokenRequestCount > 1) assert.fail('should only be called once')
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
    { expiresIn: '1d', iss: `http://localhost:${tokenServer.address().port}`, sub: 'client-id' }
  )

  const dispatcher = new Agent({
    interceptors: {
      Pool: [createOidcInterceptor({ refreshToken, origins: [`http://localhost:${mainServer.address().port}`] })]
    }
  })

  const results = await Promise.all([
    request(`http://localhost:${mainServer.address().port}`, { dispatcher }),
    request(`http://localhost:${mainServer.address().port}`, { dispatcher }),
    request(`http://localhost:${mainServer.address().port}`, { dispatcher }),
    request(`http://localhost:${mainServer.address().port}`, { dispatcher }),
    request(`http://localhost:${mainServer.address().port}`, { dispatcher })
  ])

  for (const { statusCode } of results) {
    assert.strictEqual(statusCode, 200)
  }
})

test('only retries on provided status codes', async (t) => {
  let accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })

  let requestCount = 0
  let rejectRequest = true
  const mainServer = http.createServer((req, res) => {
    requestCount += 1
    if (rejectRequest) {
      rejectRequest = false
      res.writeHead(403)
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
    { expiresIn: '1d', iss: `http://localhost:${tokenServer.address().port}`, sub: 'client-id' }
  )

  const dispatcher = new Agent({
    interceptors: {
      Pool: [createOidcInterceptor({
        accessToken,
        refreshToken,
        retryOnStatusCodes: [401] // will not retry because server is returning 403
      })]
    }
  })

  const response = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
  assert.strictEqual(response.statusCode, 403)
})

test('error handling on creation', async (t) => {

  {
    const refreshToken = createToken({ name: 'refresh' }, { expiresIn: '1d', sub: 'some-client' })

    assert.throws(() => {
      new Agent({
        interceptors: {
          Pool: [createOidcInterceptor({ refreshToken })]
        }
      })
    }, { message: 'refreshToken is invalid: iss is required' })
  }

  {
    assert.throws(() => {
      new Agent({
        interceptors: {
          Pool: [createOidcInterceptor({ refreshToken: '' })]
        }
      })
    }, { message: 'Either the idpTokenUrl or refreshToken must be provided' })
  }

  {
    const refreshToken = createToken({ name: 'refresh' }, { expiresIn: '1d', iss: 'http://google.com' })

    assert.throws(() => {
      new Agent({
        interceptors: {
          Pool: [createOidcInterceptor({ refreshToken })]
        }
      })
    }, { message: 'No clientId provided' })
  }
})

/*
 * optimistic refresh
 * token near expiration on first request
 * make second request which uses new token
 */
test('optimistic refresh', async (t) => {
  const oldAccessToken = createToken({ name: 'access' }, { expiresIn: '29s' })
  const newAccessToken = createToken({ name: 'access' }, { expiresIn: '1d' })

  let requestCount = 0
  const mainServer = http.createServer((req, res) => {
    requestCount += 1
    if (requestCount === 1) {
      assert.ok(req.headers.authorization.length > 'Bearer '.length)
      assert.strictEqual(req.headers.authorization, `Bearer ${oldAccessToken}`, 'token should be the old one in first request')
    } else {
      assert.ok(req.headers.authorization.length > 'Bearer '.length)
      assert.strictEqual(req.headers.authorization, `Bearer ${newAccessToken}`, 'token should be the new one in second request')
    }

    res.writeHead(200)
    res.end()
  })
  mainServer.listen(0)

  const tokenServer = http.createServer((req, res) => {
    assert.strictEqual(req.method, 'POST')
    assert.strictEqual(req.url, '/token')

    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      const { grant_type, refresh_token } = Object.fromEntries(new URLSearchParams(body))
      assert.strictEqual(grant_type, 'refresh_token')
      assert.ok(refresh_token)
    })

    res.writeHead(200)
    res.end(JSON.stringify({ access_token: newAccessToken }))
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
        accessToken: oldAccessToken,
        refreshToken,
        retryOnStatusCodes: [401],
        origins: [`http://localhost:${mainServer.address().port}`]
      })]
    }
  })

  const tokenRefreshed = once(dispatcher, 'oauth:token-refreshed')

  {
    const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
    assert.strictEqual(statusCode, 200)
  }

  await tokenRefreshed

  {
    const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
    assert.strictEqual(statusCode, 200)
  }

  assert.strictEqual(requestCount, 2)
})

test('do not intercept if not in the origins', async (t) => {
  const accessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
  const refreshToken = createToken(
    { name: 'refresh' },
    { expiresIn: '1d', iss: 'doesntmatter.com', sub: 'client-id' }
  )

  const server = http.createServer((req, res) => {
    assert.strictEqual(req.headers.authorization, undefined)
    res.writeHead(200)
    res.end()
  })
  server.listen(0)

  t.after(() => server.close())

  const origin = `http://localhost:${server.address().port}`

  const dispatcher = new Agent({
    interceptors: {
      Pool: [createOidcInterceptor({ accessToken, refreshToken, origins: [origin] })]
    }
  })

  // we use a different origin
  const { statusCode } = await request(`http://127.0.0.1:${server.address().port}`, { dispatcher })
  assert.strictEqual(statusCode, 200)
})
