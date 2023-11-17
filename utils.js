'use strict'

const { request } = require('undici')

async function refreshAccessToken (refreshEndpoint, clientId, refreshToken) {
  const { statusCode, body } = await request(`${refreshEndpoint}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      token: refreshToken,
      grant_type: 'refresh_token',
      client_id: clientId
    })
  })

  if (statusCode > 299) {
    const { message } = await body.json()
    throw new Error(`Failed to refresh access token - ${message}`)
  }

  const { access_token: accessToken } = await body.json()
  return accessToken
}

module.exports = {
  refreshAccessToken
}
