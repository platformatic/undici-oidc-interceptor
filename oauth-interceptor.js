'use strict'

const { createDecoder } = require('fast-jwt')
const { refreshAccessToken } = require('./utils')
const { RetryHandler } = require('undici')

const decode = createDecoder()
const THIRTY_SECONDS_MS = 30 * 1000

function isTokenExpired (token) {
  if (!token) return true

  const { exp } = decode(token)
  const nowWithBuffer = (Date.now() + THIRTY_SECONDS_MS) / 1000
  return exp <= nowWithBuffer
}

let _requestingRefresh
function callRefreshToken (refreshHost, refreshToken, clientId) {
  if (_requestingRefresh) return _requestingRefresh

  _requestingRefresh = refreshAccessToken(refreshHost, refreshToken, clientId)
  _requestingRefresh.catch(() => _requestingRefresh = null)
  _requestingRefresh.then((result) => {
    _requestingRefresh = null
    return result
  })

  return _requestingRefresh
}

function createOAuthInterceptor (options) {
  let { accessToken } = { ...options }
  const {
    refreshToken,
    retryOnStatusCodes,
    origins,
    clientId
  } = {
    retryOnStatusCodes: [401],
    origins: [],
    refreshToken: '',
    ...options
  }

  if (!refreshToken) {
    throw new Error('refreshToken is required')
  }

  const { iss, sub } = decode(refreshToken)
  if (!iss) throw new Error('refreshToken is invalid: iss is required')
  if (!sub && !clientId) throw new Error('No clientId provided')

  const refreshHost = iss
  const client = clientId || sub

  return dispatch => {
    return function Intercept (opts, handler) {
      if (!opts.oauthRetry && (origins.length > 0 && !origins.includes(opts.origin))) {
        // do not attempt intercept
        return dispatch(opts, handler)
      }

      if (opts.oauthRetry) {
        return callRefreshToken(refreshHost, refreshToken, client)
          .then(newAccessToken => {
            accessToken = newAccessToken

            opts.headers.authorization = `Bearer ${accessToken}`
            return dispatch(opts, handler)
          })
      }

      if (!opts.headers) opts.headers = {}
      if (accessToken && !opts.headers.authorization) {
        opts.headers.authorization = `Bearer ${accessToken}`
      }

      const { dispatcher } = opts

      const retryHandler = new RetryHandler({
        ...opts,
        oauthRetry: true,
        retryOptions: {
          statusCodes:  retryOnStatusCodes,
          maxRetries: 1,
          retryAfter: 0,
          minTimeout: 0,
          timeoutFactor: 1
        }
      }, {
        dispatch (opts, handler) {
          return dispatcher.dispatch(opts, handler)
        },
        handler
      })

      if (isTokenExpired(accessToken)) {
        return callRefreshToken(refreshHost, refreshToken, client)
          .then(newAccessToken => {
            accessToken = newAccessToken
            opts.headers = {
              ...opts.headers,
              authorization: `Bearer ${accessToken}`
            }

            return dispatch(opts, retryHandler)
          })
          .catch(err => handler.onError(err))
      }

      return dispatch(opts, retryHandler)
    }
  }
}

module.exports = { createOAuthInterceptor }
