'use strict'

const { createCache } = require('async-cache-dedupe')
const { refreshAccessToken } = require('./lib/utils')

class TokenStore {
  #store = null
  #name = 'refreshAccessToken'

  constructor (options) {
    const {
      name,
      serialize = null,
      ...cacheOptions
    } = options

    if (name) this.#name = name

    this.#store = createCache(cacheOptions)
    this.#store.define(this.#name, {
      serialize
    }, refreshAccessToken)

    this.token = this.token.bind(this)
  }
  
  async token (options) {
    return this.#store[this.#name](options)
  }

  async clear (options) {
    return this.#store.clear(this.#name, options)
  }
}

const createTokenStore = (cacheOptions) => {
  cacheOptions = Object.assign({ storage: { type: 'memory' } }, cacheOptions)
  return new TokenStore(cacheOptions)
}

module.exports = createTokenStore
