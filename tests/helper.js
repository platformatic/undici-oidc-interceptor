'use strict'

const { createSigner } = require('fast-jwt')

function createToken (payload, opts = {}) {
  const signSync = createSigner({
    key: 'secret',
    expiresIn: '1h',
    ...opts
  })

  return signSync(payload)
}

module.exports = {
  createToken
}
