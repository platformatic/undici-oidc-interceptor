'use strict'

const { createDecoder } = require('fast-jwt')
const { refreshAccessToken } = require('./lib/utils')
const { RetryHandler, getGlobalDispatcher } = require('undici')

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
  const { refreshToken, clientSecret, contentType } = options
  let {
    accessToken,
    retryOnStatusCodes,
    idpTokenUrl,
    origins,
    clientId,
  } = options

  retryOnStatusCodes = retryOnStatusCodes || [401]
  origins = origins || []

  if (refreshToken) {
    const decoded = decode(refreshToken)
    const { iss, sub } = decoded

    if (!iss) throw new Error('refreshToken is invalid: iss is required')

    idpTokenUrl = idpTokenUrl || `${iss}/token`
    clientId = clientId || sub
  }

  if (!idpTokenUrl) {
    throw new Error('Either the idpTokenUrl or refreshToken must be provided')
  }

  if (!clientId) throw new Error('No clientId provided')

  let _requestingRefresh
  function callRefreshToken () {
    if (_requestingRefresh) return _requestingRefresh

    _requestingRefresh = refreshAccessToken({ idpTokenUrl, refreshToken, clientId, clientSecret, contentType })
      .finally(() => _requestingRefresh = null)

    return _requestingRefresh
  }

  return dispatch => {
    return function Intercept (opts, handler) {
      if (!opts.oauthRetry && !origins.includes(opts.origin)) {
        // do not attempt intercept
        return dispatch(opts, handler)
      }

      if (opts.oauthRetry) {
        return callRefreshToken()
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

      const dispatcher = opts.dispatcher || getGlobalDispatcher()

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
          return callRefreshToken()
            .then(saveTokenAndRetry)
            .catch(err => {
              handler.onError(err)
            })
        case TOKEN_STATE.NEAR_EXPIRATION:
          callRefreshToken()
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
