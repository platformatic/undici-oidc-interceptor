'use strict'

const { createDecoder } = require('fast-jwt')
const { refreshAccessToken, refreshAccessTokenOptions } = require('./utils')

// TODO use this to pull iss and sub from refreshToken
const decode = createDecoder()

class DispatchHandler {
  constructor (dispatch, handler, options) {
    this.dispatch = dispatch
    this.handler = handler
    const { oAuthOpt, ...rest } = options
    this.options = rest
    this.oAuthOpt = oAuthOpt
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
    console.log('onHeaders', { statusCode, headers, resume, statusText })
    if (statusCode === 401) {
      this.origOpt = { ...this.options }

      const {
        refreshToken,
        clientId,
        refreshHost: domain
      } = this.oAuthOpt

      this.refreshOpt = refreshAccessTokenOptions(domain, clientId, refreshToken)
      this.attemptRefresh = true
    }

    return this.handler.onHeaders(statusCode, headers, resume, statusText)
  }

  onComplete (trailers) {
    console.log('onComplete', { trailers, refreshOpt: this.refreshOpt })
    if (this.attemptRefresh) {
      this.attemptRefresh = false
      console.log('attempting refresh')
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
    refreshHost,
    clientId
  } = { ...options }
  const oAuthOpt = { refreshToken, refreshHost, clientId }

  return dispatch => {
    return function Intercept (opts, handler) {
      const oauthHandler = new DispatchHandler(dispatch, handler, { ...opts, oAuthOpt })

      if (isTokenExpired(accessToken)) {
        return refreshAccessToken(refreshHost, refreshToken, clientId)
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

      console.log('down here', { opts })

      return dispatch(opts, oauthHandler)
    }
  }
}

module.exports = { createOAuthInterceptor }
