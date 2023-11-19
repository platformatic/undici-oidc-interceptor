'use strict'

const { createDecoder } = require('fast-jwt')
const { refreshAccessToken, refreshAccessTokenOptions } = require('./utils')

const decode = createDecoder()

class DispatchHandler {
  constructor (dispatch, handler, options) {
    this.dispatch = dispatch
    this.handler = handler

    const { oAuthOpt, ...rest } = options
    this.oAuthOpt = oAuthOpt
    this.origOpts = rest

    this.refreshOpt = refreshAccessTokenOptions(oAuthOpt.refreshHost, oAuthOpt.clientId, oAuthOpt.refreshToken)
    this.attemptRefresh = false
  }

  onConnect (abort) { return this.handler.onConnect(abort) }
  onError (err) { return this.handler.onError(err) }

  onUpgrade (statusCode, headers, socket) {
    if (this.handler.onUpgrade) {
      return this.handler.onUpgrade(statusCode, headers, socket)
    }
  }
  onData (chunk) {
    if (this.handler.onData) {
      return this.handler.onData(chunk)
    }
  }
  onBodySent (chunk) {
    if (this.handler.onBodySent) {
      return this.handler.onBodySent(chunk)
    }
  }

  onHeaders (statusCode, headers, resume, statusText) {
    // console.log('onHeaders', { statusCode, headers, resume, statusText })
    if (statusCode === 401) {
      this.attemptRefresh = true
    }

    return this.handler.onHeaders(statusCode, headers, resume, statusText)
  }

  onComplete (trailers) {
    // console.log('onComplete', { trailers, refreshOpt: this.refreshOpt })
    if (this.attemptRefresh) {
      this.attemptRefresh = false
      // console.log('attempting refresh')
      this.abort = null
      this.dispatch(this.refreshOpt, this)
    } else {
      return this.handler.onComplete(trailers)
    }
  }
}

function isTokenExpired (token) {
  if (!token) return true

  const { exp } = decode(token)
  return exp <= Date.now() / 1000
}

function createOAuthInterceptor (options) {
  let { accessToken } = { ...options }
  const {
    refreshToken,
    retryOnStatusCodes
  } = { ...options }

  const { iss, sub } = decode(refreshToken)
  const oAuthOpt = {
    refreshToken,
    retryOnStatusCodes,
    refreshHost: iss,
    clientId: sub
  }

  return dispatch => {
    return function Intercept (opts, handler) {
      const oauthHandler = new DispatchHandler(dispatch, handler, { ...opts, oAuthOpt })

      if (isTokenExpired(accessToken)) {
        return refreshAccessToken(oAuthOpt.refreshHost, refreshToken, oAuthOpt.clientId)
          .then(newAccessToken => {
            accessToken = newAccessToken
            opts.headers = {
              ...opts.headers,
              authorization: `Bearer ${accessToken}`
            }

            return dispatch(opts, oauthHandler)
          })
          .catch(err => handler.onError(err))
      }

      if (!opts.headers) opts.headers = []
      opts.headers.push('authorization', `Bearer ${accessToken}`)

      // console.log('down here', { opts })

      return dispatch(opts, oauthHandler)
    }
  }
}

module.exports = { createOAuthInterceptor }
