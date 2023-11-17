# oauth-dispatcher

Manages an access token and automatically sets the `Authorization` header on any
request that is going to a limited set of domains.

## Usage

```javascript
const dispatcher = new OAuthDispatcher({
    // All requests going to `affected` will have `Authorization` header set and
    // managed
    affected: ['https://oauth-enabled.site'],

    // Follows the oauth spec for refresh tokens
    refreshEndpoint: 'https://auth.some.site/token'

    // Refresh token for automatic refresh
    refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

    // Optional: initial access token to use
    accessToken: null
})

// use globally
setGlobalDispatcher(dispatcher)

// or on an individual request
await request('https://wee.woo/authenticated-route', {
    method: 'GET',
    headers: {
        'Content-Type': 'application/json'
    },
    dispatcher
})
```
