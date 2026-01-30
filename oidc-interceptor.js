'use strict'

const { createDecoder } = require('fast-jwt')
const stringify = require('safe-stable-stringify')
const { RetryHandler, getGlobalDispatcher } = require('undici')
const TokenStore = require('./lib/token-store')

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

function createOidcInterceptor (options) {
  const { refreshToken, clientSecret, contentType, shouldAuthenticate } = options
  let {
    accessToken,
    retryOnStatusCodes,
    idpTokenUrl,
    urls,
    clientId,
    scope,
    resource,
    audience,
    tokenStore = {
      storage: { type: 'memory' }
    }
  } = options

  retryOnStatusCodes = retryOnStatusCodes || [401]
  urls = urls || []

  const store = new TokenStore(tokenStore)

  // TODO: if there is a refresh_token, we might not need the idpTokenUrl and use the standard
  // discovery mechanism. See
  // https://github.com/panva/oauth4webapi/blob/8173ba2944ede8beff11e59019940bbd6440ea96/src/index.ts#L1054-L1093
  if (!idpTokenUrl) {
    throw new Error('No idpTokenUrl provided')
  }

  if (!clientId) throw new Error('No clientId provided')

  const refreshTokenPromises = new Map()
  let _requestingRefresh
  function callRefreshToken (tokenOpts) {
    if (_requestingRefresh) return _requestingRefresh

    const tokenOptions = {
      idpTokenUrl,
      refreshToken,
      clientId,
      clientSecret,
      contentType,
      scope,
      resource,
      audience,
      ...tokenOpts
    }

    _requestingRefresh = store.token(tokenOptions)
      .then(async (tokenPayload) => {
        const { accessToken: token } = tokenPayload

        // Check again the token state in case it expired after fetch
        // If expired, clear the cache and fetch a new one
        // If near expiration, clear the cache but return current token
        // If valid, return current token
        switch (getTokenState(token)) {
          case TOKEN_STATE.EXPIRED:
            const optionsKey = stringify(options)
            if (!refreshTokenPromises.has(optionsKey)) {
              const promise = (async () => {
                await store.clear(tokenOptions)
                return await store.token(tokenOptions).then((tokenPayload) => tokenPayload.accessToken)
              })()
              refreshTokenPromises.set(optionsKey, promise)
              promise.finally(() => refreshTokenPromises.delete(optionsKey))
            }

            return await refreshTokenPromises.get(optionsKey)
          case TOKEN_STATE.NEAR_EXPIRATION:
            // trigger refresh but return current token
            store.clear(tokenOptions).catch(() => { /* do nothing */ })
            return token
          default:
            return token
        }
      /* c8 ignore next */
      }).finally(() => _requestingRefresh = null)

    return _requestingRefresh
  }

  return dispatch => {
    return function Intercept (opts, handler) {
      const oidcScope = opts.oidc?.scope || scope

      if (shouldAuthenticate) {
        const shouldAuth = shouldAuthenticate(opts)
        if (!shouldAuth) {
          return dispatch(opts, handler)
        }
      } else if ((!opts.oauthRetry && !urls.includes(opts.origin)) || idpTokenUrl === `${opts.origin}${opts.path}`) {
        return dispatch(opts, handler)
      }

      if (opts.oauthRetry) {
        return callRefreshToken({ scope: oidcScope })
          .catch(err => {
            handler.onResponseError(handler, err)
          })
          .then(accessToken => {
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
          statusCodes: retryOnStatusCodes,
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

      // rebuild request with new access token
      const rebuildRequest = accessToken => {
        opts.headers = {
          ...opts.headers,
          authorization: `Bearer ${accessToken}`
        }
        dispatcher.emit('oauth:token-refreshed', accessToken)
        return dispatch(opts, retryHandler)
      }

      switch (getTokenState(accessToken)) {
        case TOKEN_STATE.EXPIRED:
          return callRefreshToken({ scope: oidcScope })
            .then(token => {
              accessToken = null // force using new token in next request
              return token
            })
            .then(rebuildRequest)
            .catch(err => {
              handler.onResponseError(handler, err)
            })
        case TOKEN_STATE.NEAR_EXPIRATION:
          callRefreshToken({ scope: oidcScope })
            .then(token => {
              accessToken = null // force using new token in next request
              dispatcher.emit('oauth:token-refreshed', token)
            })
            .catch(/* do nothing */)
        default:
          return dispatch(opts, retryHandler)
      }
    }
  }
}

module.exports = createOidcInterceptor
module.exports.createOidcInterceptor = createOidcInterceptor
