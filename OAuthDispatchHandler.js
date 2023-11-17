'use strict'

const { createDecoder } = require('fast-jwt')
const { request } = require('undici')

function parseHeaders (headers) {
  const output = {}

  for (let idx = 0; idx < headers.length; idx += 2) {
    const key = headers[idx].toString().toLowerCase()

    let value = headers[idx + 1]
    if (Array.isArray(value)) {
      value = value.map(x => x.toString('utf8'))
    } else {
      value = value.toString('utf8')
    }

    output[key] = value
  }

  return output
}

class OAuthHandler {
  constructor (opts, dispatch, handler) {
    const { oauthOpts, ...dispatchOpts } = opts
    console.log({ opts })

    this.dispatch = dispatch
    this.handler = handler
    this.opts = dispatchOpts

    this.accessToken = oauthOpts.accessToken
    this.refreshToken = oauthOpts.refreshToken
    this.decode = createDecoder()
    this.retryOnStatuses = oauthOpts.retryOnStatuses

    // TODO use fast-jwt to get iss and sub
    this.clientId = oauthOpts.clientId
    this.refreshTokenUrl = oauthOpts.refreshTokenUrl

  }

  onUpgrade (...params) {
    if (this.handler.onUpgrade) {
      return this.handler.onUpgrade(...params)
    }
  }

  onConnect (abort, ctx) {
    this.abort = abort
    return this.handler.onConnect(abort)
  }

  onBodySent (chunk) {
    return this.handler.onBodySent(chunk)
  }

  // capture a failure on the status code
  // make a request to the refresh token url
  // resend request with new access token
  async onHeaders (statusCode, headers, resume) {
    console.log('onHeaders')
    if (!this.retryOnStatuses.includes(statusCode)) {
      return this.handler.onHeaders(statusCode, headers, resume)
    }

    console.log('refreshing', { statusCode, opts: this.opts })
    const refreshResponse = await request(`${this.refreshTokenUrl}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token: this.refreshToken,
        grant_type: 'refresh_token',
        client_id: this.clientId
      })
    })

    if (refreshResponse.statusCode > 299) {
      const { message } = await refreshResponse.body.json()
      throw new Error(`Failed to refresh access token - ${message}`)
    }

    const { access_token: accessToken } = await refreshResponse.body.json()
    console.log('refreshed', { accessToken })
    this.accessToken = accessToken
    this.tokenRefreshed = true

    const parsedHeaders = parseHeaders(headers)
    parsedHeaders.authorization = `Bearer ${this.accessToken}`
    console.log('liar')

    /*
    const rawHeaders = Object.entries(parsedHeaders).reduce((acc, [key, value]) => {
      acc.push(Buffer.from(key))
      acc.push(Buffer.from(value))
      return acc
    }, [])
    */
    console.log('pre-opts', this.opts)
    this.opts.headers = { ...this.opts.headers, ...parsedHeaders }
    console.log('post-opts', this.opts)
  }

  onError (err) {
    return this.handler.onError(err)
  }

  onData (chunk) {
    console.log('onData')
    return this.handler.onData(chunk)
  }

  // check for retry flag
  // reset flag
  // dispatch to original url
  onComplete (trailers) {
    console.log('onComplete', { tokenRefreshed: this.tokenRefreshed })
    if (!this.tokenRefreshed) return this.handler.onComplete(trailers)

    this.tokenRefreshed = false
    return this.dispatch(this.opts, this)
  }
}

module.exports = OAuthHandler
