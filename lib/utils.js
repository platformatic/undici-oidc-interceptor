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
      'Content-Type': contentType
    },
    body: bodyToSend
  })

  if (statusCode > 299) {
    const parsed = await body.json()
    throw new Error(`Failed to refresh access token - ${parsed.message}`)
  }

  const { access_token: accessToken } = await body.json()
  return accessToken
}

module.exports = {
  refreshAccessToken
}
