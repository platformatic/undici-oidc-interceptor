'use strict'

const { request } = require('undici')

async function refreshAccessToken ({ idpTokenUrl, refreshToken, clientId, clientSecret, contentType, scope, resource, audience }) {
  let objToSend = null

  if (refreshToken) {
    objToSend = {
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      client_id: clientId
    }
  } else {
    objToSend = {
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    }
  }

  if (scope) objToSend.scope = scope

  // Audience is Auth0 specific
  if (audience) objToSend.audience = audience

  let bodyToSend

  if (contentType === 'json') {
    // TODO(mcollina): remove JSON support as it's not spec compliant
    contentType = 'application/json'
    objToSend.resource = resource
    bodyToSend = JSON.stringify(objToSend)
  } else {
    contentType = 'application/x-www-form-urlencoded'
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(objToSend)) {
      params.set(key, value)
    }
    if (resource) {
      if (typeof resource !== 'string' && resource[Symbol.iterator]) {
        for (const r of resource) {
          params.append('resource', r)
        }
      } else if (resource) {
        params.set('resource', resource)
      }
    }
    bodyToSend = params.toString()
  }

  const { statusCode, body } = await request(idpTokenUrl, {
    method: 'POST',
    headers: {
      'Accept': 'application/json; charset=utf-8',
      'Content-Type': contentType
    },
    body: bodyToSend
  })

  if (statusCode !== 200) {
    const parsed = await body.json()
    throw new Error(`Failed to refresh access token - status code ${statusCode} - ${JSON.stringify(parsed)}`)
  }

  const { access_token: accessToken, token_type: tokenType } = await body.json()

  if (!accessToken) {
    throw new Error('Failed to refresh access token - no access_token in response')
  }
  
  // slight leeway on the spec, let's imply that token_type is bearer by default
  if (tokenType && tokenType.toLowerCase() !== 'bearer') {
    throw new Error(`Failed to refresh access token - unexpected token_type ${tokenType}`)
  }

  return accessToken
}

module.exports = {
  refreshAccessToken
}
