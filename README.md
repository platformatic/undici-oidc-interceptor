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

```js
const { Agent } = require('undici')
const { createOidcInterceptor } = require('undici-oidc-interceptor')
const dispatcher = new Agent({
  interceptors: {
    Pool: [createOidcInterceptor({
      // The paramerts for the cliend_credentials grant of OIDC
      clientId: 'FILLME',
      clientSecret: 'FILLME',
      idpTokenUrl: 'https://your-idp.com/token',

      // Set an array of status codes that the interceptor should refresh and
      // retry the request on
      retryOnStatusCodes: [401],

      // The array of urls that this interceptor will be appending `Authorization` header
      // for automatically
      urls: ['FILLME'],

      // OPTIONAL: an initial access token
      accessToken: ''
    })]
  }
})
``` 

## Usage with refresh token

```js
const { Agent } = require('undici')
const { createOidcInterceptor } = require('undici-oidc-interceptor')
const dispatcher = new Agent({
  interceptors: {
    Pool: [createOidcInterceptor({
      // Provide a refresh token so the interceptor can manage the access token
      // The refresh token must include an issuer (`iss`)
      refreshToken: '',
      idpTokenUrl: 'https://your-idp.com/token',
      clientId: 'FILLME',

      // Set an array of status codes that the interceptor should refresh and
      // retry the request on
      retryOnStatusCodes: [401],

      // The array of urls that this interceptor will be appending `Authorization` header
      // for automatically
      urls: []

      // OPTIONAL: an initial access token
      accessToken: ''
    })]
  }
})
``` 

## License

MIT
