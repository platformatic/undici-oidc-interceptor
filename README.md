# oauth-interceptor

Manages an access token and automatically sets the `Authorization` header on any
request that is going to a limited set of domains.

## Usage

```javascript
const dispatcher = new Agent({
  intercpetors: {
    Pool: [createOAuthIntercpetor({
      // Provide a refresh token so the interceptor can manage the access token
      refreshToken: '',

      // Set the status codes that the interceptor should refresh access and
      // retry the request
      retryOnStatusCodes: [401],

      // The domains that this interceptor will manage
      interceptDomains: []

      // OPTIONAL: an initial access token
      accessToken: ''
    })]
  }
})
``` 
