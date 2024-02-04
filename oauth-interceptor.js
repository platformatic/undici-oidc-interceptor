'use strict'

const { createDecoder } = require('fast-jwt')
const { refreshAccessToken } = require('./lib/utils')
const { RetryHandler } = require('undici')

const decode = createDecoder()
const EXP_DIFF_MS = 10 * 1000
const NEAR_EXP_DIFF_MS = 30 * 1000

const TOKEN_STATE = {
  VALID: 'VALID',
  EXPIRED: 'EXPIRED',
  NEAR_EXPIRATION: 'NEAR_EXPIRATION'
}

function getTokenState (token) {
  if (!token) return TOKEN_STATE.EXPIRED

  const { exp } = decode(token)

  if (exp <= (Date.now() + EXP_DIFF_MS) / 1000) return TOKEN_STATE.EXPIRED
  if (exp <= (Date.now() + NEAR_EXP_DIFF_MS) / 1000) return TOKEN_STATE.NEAR_EXPIRATION
  return TOKEN_STATE.VALID
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

  let _requestingRefresh
  function callRefreshToken (refreshEndpoint, refreshToken, clientId) {
    if (_requestingRefresh) return _requestingRefresh

    _requestingRefresh = refreshAccessToken({ refreshEndpoint, refreshToken, clientId })
      .finally(() => _requestingRefresh = null)

    return _requestingRefresh
  }

  return dispatch => {
    return function Intercept (opts, handler) {
      if (!opts.oauthRetry && (origins.length > 0 && !origins.includes(opts.origin))) {
        // do not attempt intercept
        return dispatch(opts, handler)
      }

      if (opts.oauthRetry) {
        return callRefreshToken(refreshHost, refreshToken, client)
          .catch(err => {
            handler.onError(err)
          })
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

      const saveTokenAndRetry = newAccessToken => {
        accessToken = newAccessToken
        opts.headers = {
          ...opts.headers,
          authorization: `Bearer ${accessToken}`
        }
        dispatcher.emit('oauth:token-refreshed', newAccessToken)
        return dispatch(opts, retryHandler)
      }

      switch (getTokenState(accessToken)) {
        case TOKEN_STATE.EXPIRED:
          return callRefreshToken(refreshHost, refreshToken, client)
            .then(saveTokenAndRetry)
            .catch(err => {
              handler.onError(err)
            })
        case TOKEN_STATE.NEAR_EXPIRATION:
          callRefreshToken(refreshHost, refreshToken, client)
            .then(newAccessToken => {
              accessToken = newAccessToken
              dispatcher.emit('oauth:token-refreshed', newAccessToken)
            })
            .catch(/* do nothing */)
        default:
          return dispatch(opts, retryHandler)
      }
    }
  }
}

module.exports = createOAuthInterceptor
module.exports.createOAuthInterceptor = createOAuthInterceptor
