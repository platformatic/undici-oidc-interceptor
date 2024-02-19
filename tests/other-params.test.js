'use strict'

const test = require('node:test')
const http = require('node:http')
const { request, Agent } = require('undici')
const { createDecoder } = require('fast-jwt')
const { createOidcInterceptor } = require('../')
const { createToken } = require('./helper')
const { tspl } = require('@matteo.collina/tspl')
const qs = require('fast-querystring')

test('scope', async (t) => {
  const plan = tspl(t, { plan: 9 })
  const newAccessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
  const expectedScope = 'what a scope'

  const mainServer = http.createServer((req, res) => {
    plan.ok(req.headers.authorization.length > 'Bearer '.length)
    plan.strictEqual(req.headers.authorization, `Bearer ${newAccessToken}`, 'token should be the new one in second request')

    res.writeHead(200)
    res.end()
  })
  mainServer.listen(0)

  const tokenServer = http.createServer((req, res) => {
    plan.strictEqual(req.method, 'POST')
    plan.strictEqual(req.url, '/token')

    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      const { grant_type, client_id, client_secret, scope } = Object.fromEntries(new URLSearchParams(body))
      plan.strictEqual(grant_type, 'client_credentials')
      plan.strictEqual(client_id, 'client-id')
      plan.strictEqual(client_secret, 'client-secret')
      plan.strictEqual(scope, expectedScope)
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
        clientId: 'client-id',
        clientSecret: 'client-secret',
        retryOnStatusCodes: [401],
        idpTokenUrl: `http://localhost:${tokenServer.address().port}/token`,
        origins: [`http://localhost:${mainServer.address().port}`],
        scope: expectedScope
      })]
    }
  })

  {
    const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
    plan.strictEqual(statusCode, 200)
  }
})

test('resource', async (t) => {
  const plan = tspl(t, { plan: 9 })
  const newAccessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
  const expectedResource = 'what a resource'

  const mainServer = http.createServer((req, res) => {
    plan.ok(req.headers.authorization.length > 'Bearer '.length)
    plan.strictEqual(req.headers.authorization, `Bearer ${newAccessToken}`, 'token should be the new one in second request')

    res.writeHead(200)
    res.end()
  })
  mainServer.listen(0)

  const tokenServer = http.createServer((req, res) => {
    plan.strictEqual(req.method, 'POST')
    plan.strictEqual(req.url, '/token')

    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      const { grant_type, client_id, client_secret, resource } = Object.fromEntries(new URLSearchParams(body))
      plan.strictEqual(grant_type, 'client_credentials')
      plan.strictEqual(client_id, 'client-id')
      plan.strictEqual(client_secret, 'client-secret')
      plan.strictEqual(resource, expectedResource)
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
        clientId: 'client-id',
        clientSecret: 'client-secret',
        retryOnStatusCodes: [401],
        idpTokenUrl: `http://localhost:${tokenServer.address().port}/token`,
        origins: [`http://localhost:${mainServer.address().port}`],
        resource: expectedResource
      })]
    }
  })

  {
    const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
    plan.strictEqual(statusCode, 200)
  }
})

// Audience is Auth0 specific
test('audience', async (t) => {
  const plan = tspl(t, { plan: 9 })
  const newAccessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
  const expectedAudience = 'what an audience'

  const mainServer = http.createServer((req, res) => {
    plan.ok(req.headers.authorization.length > 'Bearer '.length)
    plan.strictEqual(req.headers.authorization, `Bearer ${newAccessToken}`, 'token should be the new one in second request')

    res.writeHead(200)
    res.end()
  })
  mainServer.listen(0)

  const tokenServer = http.createServer((req, res) => {
    plan.strictEqual(req.method, 'POST')
    plan.strictEqual(req.url, '/token')

    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      const { grant_type, client_id, client_secret, audience} = Object.fromEntries(new URLSearchParams(body))
      plan.strictEqual(grant_type, 'client_credentials')
      plan.strictEqual(client_id, 'client-id')
      plan.strictEqual(client_secret, 'client-secret')
      plan.strictEqual(audience, expectedAudience)
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
        clientId: 'client-id',
        clientSecret: 'client-secret',
        retryOnStatusCodes: [401],
        idpTokenUrl: `http://localhost:${tokenServer.address().port}/token`,
        origins: [`http://localhost:${mainServer.address().port}`],
        audience: expectedAudience
      })]
    }
  })

  {
    const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
    plan.strictEqual(statusCode, 200)
  }
})

test('multiple resources', async (t) => {
  const plan = tspl(t, { plan: 9 })
  const newAccessToken = createToken({ name: 'access' }, { expiresIn: '1d' })
  const expectedResources = ['r1', 'r2']

  const mainServer = http.createServer((req, res) => {
    plan.ok(req.headers.authorization.length > 'Bearer '.length)
    plan.strictEqual(req.headers.authorization, `Bearer ${newAccessToken}`, 'token should be the new one in second request')

    res.writeHead(200)
    res.end()
  })
  mainServer.listen(0)

  const tokenServer = http.createServer((req, res) => {
    plan.strictEqual(req.method, 'POST')
    plan.strictEqual(req.url, '/token')

    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      const { grant_type, client_id, client_secret, resource } = qs.parse(body)
      plan.strictEqual(grant_type, 'client_credentials')
      plan.strictEqual(client_id, 'client-id')
      plan.strictEqual(client_secret, 'client-secret')
      plan.deepStrictEqual(resource, expectedResources)
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
        clientId: 'client-id',
        clientSecret: 'client-secret',
        retryOnStatusCodes: [401],
        idpTokenUrl: `http://localhost:${tokenServer.address().port}/token`,
        origins: [`http://localhost:${mainServer.address().port}`],
        resource: expectedResources
      })]
    }
  })

  {
    const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
    plan.strictEqual(statusCode, 200)
  }
})
