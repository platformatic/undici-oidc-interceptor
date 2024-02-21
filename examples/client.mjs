import { Agent, setGlobalDispatcher } from 'undici'
import { createOidcInterceptor } from '../oidc-interceptor.js'

const dispatcher = new Agent({
  interceptors: {
    Pool: [createOidcInterceptor({
      // The paramerts for the cliend_credentials grant of OIDC
      clientId: 'foo',
      clientSecret: 'bar',
      idpTokenUrl: 'http://localhost:3001/token',

      // Set an array of status codes that the interceptor should refresh and
      // retry the request on
      retryOnStatusCodes: [401],

      // The origins that this interceptor will add the `Authorization` header
      // automatically
      origins: ['http://localhost:3002']
    })]
  }
})

setGlobalDispatcher(dispatcher)

const res = await fetch('http://localhost:3002')
console.log(res.status, await res.text())
