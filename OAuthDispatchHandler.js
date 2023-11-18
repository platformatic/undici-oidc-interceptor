'use strict'

const { createDecoder } = require('fast-jwt')
const { request } = require('undici')
const { refreshAccessTokenOptions } = require('./utils')

const STATE = {
  INITIAL: 0,
  REFRESHING: 1,
  PARSING: 2,
  RETRYING: 3
}

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
    console.log('HANDLER', { opts })

    // orignal request
    this.dispatch = dispatch
    this.handler = handler
    this.origOpts = dispatchOpts

    // refresh request
    this.currentState = STATE.INITIAL
    this.refreshOpt = null
    this.accessTokenChunks = ''

    // oauth tools
    this.refreshToken = oauthOpts.refreshToken
    this.retryOnStatuses = oauthOpts.retryOnStatuses
    this.decode = createDecoder()

    // TODO use fast-jwt to get iss and sub and do it before refresh
    this.clientId = oauthOpts.clientId
    this.refreshTokenUrl = oauthOpts.refreshTokenUrl
  }

  onUpgrade (...params) {
    console.log('HANDLER onUpgrade')
    if (this.handler.onUpgrade) {
      return this.handler.onUpgrade(...params)
    }
  }

  onConnect (abort, ctx) {
    console.log('HANDLER onConnect')
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
    console.log('HANDLER onHeaders')
    if (this.currentState === STATE.REFRESHING) {
      this.currentState = STATE.PARSING
    }

    if (!this.retryOnStatuses.includes(statusCode)) {
      return this.handler.onHeaders(statusCode, headers, resume)
    }

    // TODO chnge the refresh shared method to return an object with request options
    // store those in `this.optsi
    // set 'refresh flag'
    // call dispatch with new options in `onComplete`
    // set access token
    // retry original call
    if (this.currentState === STATE.INITIAL) {
      this.refreshOpt = refreshAccessTokenOptions(this.refreshTokenUrl, this.clientId, this.refreshToken)
      this.currentState = STATE.REFRESHING
    }
  }

  onError (err) {
    return this.handler.onError(err)
  }

  onData (chunk) {
    if (this.currentState === STATE.PARSING) {
      this.refreshResponseChunks += chunk
    }

    return this.handler.onData(chunk)
  }

  // check for retry flag
  // reset flag
  // dispatch to original url
  onComplete (trailers) {
    switch (this.currentState) {
      case STATE.REFRESHING:
        console.log('HANDLER onComplete REFRESHING', { refreshOpt: this.refreshOpt, opts: this.origOpts })
        // TODO this does not seem to dispatch to the refresh endpoint
        return this.dispatch(this.refreshOpts, this)
      case STATE.PARSING:
        console.log('HANDLER onComplete PARSING')
        const accessToken = JSON.parse(this.refreshResponseChunks).access_token
        console.log({ accessToken })
        this.origOpts.headers.authorization = `Bearer ${accessToken}`
        return this.dispatch(this.origOpts, this)
      default:
        console.log('HANDLER onComplete DEFAULT')
        return this.handler.onComplete(trailers)
    }
  }
}

module.exports = OAuthHandler
