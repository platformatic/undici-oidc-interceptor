'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { setGlobalDispatcher, MockAgent } = require('undici')
const { refreshAccessToken } = require('../utils')

const mockAgent = new MockAgent()
setGlobalDispatcher(mockAgent)
mockAgent.disableNetConnect()

test('refreshAccessToken() - success', async (t) => {
  const refreshMock = mockAgent.get('https://example.com')
  refreshMock.intercept({
    method: 'POST',
    path: '/token',
    body: body => {
      const { token, grant_type, client_id } = JSON.parse(body)
      assert.strictEqual(token, 'refresh-token')
      assert.strictEqual(grant_type, 'refresh_token')
      assert.strictEqual(client_id, 'client-id')
      return true
    }
  }).reply(200, {
    access_token: 'new-access-token'
  })

  const accessToken = await refreshAccessToken('https://example.com', 'client-id', 'refresh-token')
  assert.strictEqual(accessToken, 'new-access-token')
})
