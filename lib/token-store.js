'use strict'

const { createCache } = require('async-cache-dedupe')
const { refreshAccessToken } = require('./utils')
const stringify = require('safe-stable-stringify')

class TokenStore {
  #store = null
  #name = 'refreshAccessToken'
  #inMemoryCache = null
  #useInMemoryCache = false
  #inMemoryCacheTTL = 0
  #serialize = null

  constructor (options) {
    const {
      name,
      serialize = null,
      useInMemoryCache = false,
      inMemoryCacheTTL = 60000, // Default 60 seconds
      ...cacheOptions
    } = options

    if (name) this.#name = name
    this.#serialize = serialize
    this.#useInMemoryCache = useInMemoryCache
    this.#inMemoryCacheTTL = inMemoryCacheTTL

    // Initialize in-memory cache if enabled
    if (this.#useInMemoryCache) {
      this.#inMemoryCache = new Map()
    }

    // Set default TTL as 80% of the OIDC token lifetime.
    if(!cacheOptions.ttl) {
      cacheOptions.ttl = (tokenPayload) => tokenPayload.expiresIn ? Math.round(tokenPayload.expiresIn * 80 / 100) : 0
    }

    this.#store = createCache(cacheOptions)
    this.#store.define(this.#name, {
      serialize
    }, refreshAccessToken)

    this.token = this.token.bind(this)
  }

  #getCacheKey (options) {
    if (this.#serialize) {
      return this.#serialize(options)
    }
    return stringify(options)
  }

  #getFromMemoryCache (key) {
    if (!this.#useInMemoryCache || !this.#inMemoryCache) {
      return null
    }

    const cached = this.#inMemoryCache.get(key)
    if (!cached) {
      return null
    }

    // Check if expired
    if (Date.now() > cached.expiresAt) {
      this.#inMemoryCache.delete(key)
      return null
    }

    return cached.value
  }

  #setInMemoryCache (key, value) {
    if (!this.#useInMemoryCache || !this.#inMemoryCache) {
      return
    }

    const expiresAt = Date.now() + this.#inMemoryCacheTTL
    this.#inMemoryCache.set(key, { value, expiresAt })
  }

  #clearMemoryCache (key) {
    if (!this.#useInMemoryCache || !this.#inMemoryCache) {
      return
    }

    if (key) {
      this.#inMemoryCache.delete(key)
    } else {
      this.#inMemoryCache.clear()
    }
  }

  async token (options) {
    // Check in-memory cache first
    const cacheKey = this.#getCacheKey(options)
    const memCached = this.#getFromMemoryCache(cacheKey)
    if (memCached) {
      return memCached
    }

    // Fetch from underlying store (Redis or memory)
    const result = await this.#store[this.#name](options)

    // Store in memory cache for faster subsequent access
    this.#setInMemoryCache(cacheKey, result)

    return result
  }

  async clear (options) {
    const cacheKey = this.#getCacheKey(options)
    this.#clearMemoryCache(cacheKey)
    return this.#store.clear(this.#name, options)
  }
}

module.exports = TokenStore
