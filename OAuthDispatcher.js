'use strict'

const { request, Agent, Pool } = require('undici')
const { createDecoder } = require('fast-jwt')
const OAuthHandler = require('./OAuthDispatchHandler')

class OAuthDispatcher extends Agent {
  constructor (options) {
    super({
      ...options,
      factory (url, opts) {
        const found = options.affected.find(affectedUrl => url === affectedUrl)
        if (!found) return new Pool(url, opts)

        return new Pool(url, {
          ...opts,
          interceptors: {
            Pool: [this.#attachToken.bind(this)]
          }
        })
      }
    })

    this.decode = createDecoder()
    this.accessToken = options.accessToken
    this.refreshToken = options.refreshToken
    this.refreshEndpoint = options.refreshEndpoint
    this.clientId = options.clientId
  }

  #attachToken (dispatch) {
    return async function InterceptedDispatch (opts, handler) {
      const { exp } = this.decode(this.accessToken)
      if (exp <= Date.now() / 1000) {
        try {
          this.accessToken = await this.#refreshAccessToken(this.clientId)
        } catch (err) {
          return handler.onError(err)
        }
      }

      if (!opts.headers) opts.headers = {}
      opts.headers.authorization = `Bearer ${this.accessToken}`

      const oauthHandler = new OAuthHandler({
        oauthOpts: {
          accessToken: this.accessToken,
          refreshToken: this.refreshToken,
          retryOnStatuses: [401, 403],
          refreshTokenUrl: this.refreshEndpoint,
          clientId: this.clientId
        }
      }, dispatch, handler)
      const result = await dispatch(opts, handler)
      return result
    }.bind(this)
  }

  async #refreshAccessToken (clientId) {
    const { statusCode, body } = await request(`${this.refreshEndpoint}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token: this.refreshToken,
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
}

module.exports = OAuthDispatcher
