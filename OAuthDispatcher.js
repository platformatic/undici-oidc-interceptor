'use strict'

const { createDecoder } = require('fast-jwt')
const { refreshAccessToken } = require('./utils')
const { RetryHandler } = require('undici')

const decode = createDecoder()

function isTokenExpired (token) {
  if (!token) return true

  const { exp } = decode(token)
  return exp <= Date.now() / 1000
}

function createOAuthInterceptor (options) {
  let { accessToken } = { ...options }
  const {
    refreshToken,
    retryOnStatusCodes,
    interceptDomains
  } = {
    retryOnStatusCodes: [401],
    interceptDomains: [],
    refreshToken: '',
    ...options
  }

  const { iss: refreshHost, sub: clientId } = decode(refreshToken)

  return dispatch => {
    return function Intercept (opts, handler) {
      if (!opts.oauthRetry && (interceptDomains.length > 0 && !interceptDomains.includes(opts.origin))) {
        // do not attempt intercept
        return dispatch(opts, handler)
      }

      if (opts.oauthRetry) {
        return refreshAccessToken(refreshHost, refreshToken, clientId)
          .then(newAccessToken => {
            accessToken = newAccessToken

            const authIndex = opts.headers.findIndex(header => header === 'authorization')
            opts.headers[authIndex + 1] = `Bearer ${accessToken}`
            return dispatch(opts, handler)
          })
      }

      if (!opts.headers) opts.headers = []
      opts.headers.push('authorization', `Bearer ${accessToken}`)

      const { dispatcher } = opts

      const retryHandler = new RetryHandler({
        ...opts,
        oauthRetry: true,
        retryOptions: {
          statusCodes:  [401],
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
        return refreshAccessToken(refreshHost, refreshToken, clientId)
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
