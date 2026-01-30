'use strict'

const test = require('node:test')
const http = require('node:http')
const { request, Agent } = require('undici')
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

  const dispatcher = new Agent().compose(createOidcInterceptor({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    retryOnStatusCodes: [401],
    idpTokenUrl: `http://localhost:${tokenServer.address().port}/token`,
    urls: [`http://localhost:${mainServer.address().port}`],
    scope: expectedScope
  }))

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

  const dispatcher = new Agent().compose(createOidcInterceptor({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    retryOnStatusCodes: [401],
    idpTokenUrl: `http://localhost:${tokenServer.address().port}/token`,
    urls: [`http://localhost:${mainServer.address().port}`],
    resource: expectedResource
  }))

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

  const dispatcher = new Agent().compose(createOidcInterceptor({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    retryOnStatusCodes: [401],
    idpTokenUrl: `http://localhost:${tokenServer.address().port}/token`,
    urls: [`http://localhost:${mainServer.address().port}`],
    audience: expectedAudience
  }))

  {
    const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
    plan.strictEqual(statusCode, 200)
  }
})

test('scope override per request', async (t) => {
  const plan = tspl(t, { plan: 13 })
  const defaultScopeToken = createToken({ name: 'default-scope' }, { expiresIn: '1d' })
  const overrideScopeToken = createToken({ name: 'override-scope' }, { expiresIn: '1d' })
  const defaultScope = 'read write'
  const overrideScope = 'admin'

  let requestCount = 0
  const mainServer = http.createServer((req, res) => {
    requestCount++
    plan.ok(req.headers.authorization.length > 'Bearer '.length)
    if (requestCount === 1) {
      plan.strictEqual(req.headers.authorization, `Bearer ${defaultScopeToken}`, 'first request should use default scope token')
    } else {
      plan.strictEqual(req.headers.authorization, `Bearer ${overrideScopeToken}`, 'second request should use override scope token')
    }
    res.writeHead(200)
    res.end()
  })
  mainServer.listen(0)

  let tokenRequestCount = 0
  const tokenServer = http.createServer((req, res) => {
    tokenRequestCount++
    plan.strictEqual(req.method, 'POST')
    plan.strictEqual(req.url, '/token')

    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      const { scope } = Object.fromEntries(new URLSearchParams(body))
      if (tokenRequestCount === 1) {
        plan.strictEqual(scope, defaultScope, 'first token request should use default scope')
        res.writeHead(200)
        res.end(JSON.stringify({ access_token: defaultScopeToken }))
      } else {
        plan.strictEqual(scope, overrideScope, 'second token request should use override scope')
        res.writeHead(200)
        res.end(JSON.stringify({ access_token: overrideScopeToken }))
      }
    })
  })
  tokenServer.listen(0)

  t.after(() => {
    mainServer.close()
    tokenServer.close()
  })

  const dispatcher = new Agent().compose(createOidcInterceptor({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    retryOnStatusCodes: [401],
    idpTokenUrl: `http://localhost:${tokenServer.address().port}/token`,
    urls: [`http://localhost:${mainServer.address().port}`],
    scope: defaultScope
  }))

  // First request uses default scope
  {
    const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
    plan.strictEqual(statusCode, 200)
  }

  // Second request uses override scope
  {
    const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, {
      dispatcher,
      oidc: { scope: overrideScope }
    })
    plan.strictEqual(statusCode, 200)
  }

  plan.strictEqual(tokenRequestCount, 2, 'should have made 2 token requests')
})

test('scope override caches tokens per scope', async (t) => {
  const plan = tspl(t, { plan: 10 })
  const scope1Token = createToken({ name: 'scope1' }, { expiresIn: '1d' })
  const scope2Token = createToken({ name: 'scope2' }, { expiresIn: '1d' })
  const scope1 = 'scope1'
  const scope2 = 'scope2'

  let requestCount = 0
  const mainServer = http.createServer((req, res) => {
    requestCount++
    plan.ok(req.headers.authorization.length > 'Bearer '.length)
    res.writeHead(200)
    res.end()
  })
  mainServer.listen(0)

  let tokenRequestCount = 0
  const scopeToToken = {}
  const tokenServer = http.createServer((req, res) => {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      const { scope } = Object.fromEntries(new URLSearchParams(body))

      // Only create token if we haven't seen this scope before
      if (!scopeToToken[scope]) {
        tokenRequestCount++
        scopeToToken[scope] = scope === scope1 ? scope1Token : scope2Token
      }

      res.writeHead(200)
      res.end(JSON.stringify({ access_token: scopeToToken[scope] }))
    })
  })
  tokenServer.listen(0)

  t.after(() => {
    mainServer.close()
    tokenServer.close()
  })

  const dispatcher = new Agent().compose(createOidcInterceptor({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    retryOnStatusCodes: [401],
    idpTokenUrl: `http://localhost:${tokenServer.address().port}/token`,
    urls: [`http://localhost:${mainServer.address().port}`]
  }))

  // Request with scope1
  {
    const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, {
      dispatcher,
      oidc: { scope: scope1 }
    })
    plan.strictEqual(statusCode, 200)
  }

  // Request with scope2
  {
    const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, {
      dispatcher,
      oidc: { scope: scope2 }
    })
    plan.strictEqual(statusCode, 200)
  }

  // Request with scope1 again - should use cached token
  {
    const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, {
      dispatcher,
      oidc: { scope: scope1 }
    })
    plan.strictEqual(statusCode, 200)
  }

  // Request with scope2 again - should use cached token
  {
    const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, {
      dispatcher,
      oidc: { scope: scope2 }
    })
    plan.strictEqual(statusCode, 200)
  }

  plan.strictEqual(tokenRequestCount, 2, 'should only have made 2 token requests (one per unique scope)')
  plan.strictEqual(requestCount, 4, 'should have made 4 main requests')
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

  const dispatcher = new Agent().compose(createOidcInterceptor({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    retryOnStatusCodes: [401],
    idpTokenUrl: `http://localhost:${tokenServer.address().port}/token`,
    urls: [`http://localhost:${mainServer.address().port}`],
    resource: expectedResources
  }))

  {
    const { statusCode } = await request(`http://localhost:${mainServer.address().port}`, { dispatcher })
    plan.strictEqual(statusCode, 200)
  }
})
