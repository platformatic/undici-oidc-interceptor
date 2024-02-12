# undici-oidc-interceptor


[![NPM version](https://img.shields.io/npm/v/undici-oidc-interceptor.svg?style=flat)](https://www.npmjs.com/package/undici-oidc-interceptor)

`undici-oidc-interceptor` manages an [OIDC](https://openid.net/specs/openid-connect-core-1_0.html) access token and transparently sets the `Authorization` header on any
request that is going to a limited set of domains.

The token is automatically renewed after it expires. It supports both a `refresh_token`
and `client_credentials` grants.

## Install

```bash
npm i undici undici-oidc-interceptor
```

## Usage with client credentials

```
const { Agent } = require('undici')
const { createOAuthIntercpetor } = require('undici-oidc-interceptor')
const dispatcher = new Agent({
  intercpetors: {
    Pool: [createOAuthIntercpetor({
      // The paramerts for the cliend_credentials grant of OIDC
      clientId: 'FILLME',
      clientSecret: 'FILLME',

      // Set an array of status codes that the interceptor should refresh and
      // retry the request on
      retryOnStatusCodes: [401],

      // The origins that this interceptor will add the `Authorization` header
      // automatically
      origins: ['FILLME']

      // OPTIONAL: an initial access token
      accessToken: ''
    })]
  }
})
``` 

## Usage with refresh token

```javascript
const { Agent } = require('undici')
const { createOAuthIntercpetor } = require('undici-oidc-interceptor')
const dispatcher = new Agent({
  intercpetors: {
    Pool: [createOAuthIntercpetor({
      // Provide a refresh token so the interceptor can manage the access token
      // The refresh token must include an issuer (`iss`)
      refreshToken: '',

      // Set an array of status codes that the interceptor should refresh and
      // retry the request on
      retryOnStatusCodes: [401],

      // The origins that this interceptor will add the `Authorization` header
      // automatically
      origins: []

      // OPTIONAL: an initial access token
      accessToken: ''

      // OPTIONAL: clientId that matches refresh token
      // Default: the `sub` claim in the refresh token
      clientId: null
    })]
  }
})
``` 

## License

MIT
