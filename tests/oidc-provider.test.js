'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const { request, Agent } = require('undici')
const { createDecoder, createVerifier } = require('fast-jwt')
const buildGetJwks = require('get-jwks')
const { testProvider } = require('./helper.js')
const { createOAuthInterceptor } = require('../')

test('interceptor works with oidc-provider', async (t) => {
  const jwks = buildGetJwks({
    jwksPath: '/jwks',
  })
  const provider = await testProvider(test, { port: 3000 });
  const idp = `http://localhost:${provider.address().port}/`
  const idpTokenUrl = `${idp}token`

  const key = await jwks.getPublicKey({ domain: idp, kid: 'r1LkbBo3925Rb2ZFFrKyU3MVex9T2817Kx0vbi6i_Kc' })

  const mainServer = http.createServer((req, res) => {
    assert.ok(req.headers.authorization.length > 'Bearer '.length)
    const verifySync = createVerifier({ key })
    const decoded = verifySync(req.headers.authorization.slice('Bearer '.length))
    assert.strictEqual(decoded.iss, `http://localhost:${provider.address().port}`)
    res.writeHead(200)
    res.end()
  })
  mainServer.listen(0)

  t.after(() => {
    mainServer.close()
  })

  const origin = `http://localhost:${mainServer.address().port}`

  const dispatcher = new Agent({
    interceptors: {
      Pool: [createOAuthInterceptor({ 
        clientId: 'foo',
        clientSecret: 'bar',
        idpTokenUrl,
        origins: [origin]
      })]
    }
  })

  const response = await request(origin, {
    dispatcher
  })
  assert.strictEqual(response.statusCode, 200);
})
