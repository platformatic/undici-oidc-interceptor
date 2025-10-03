import Redis from 'ioredis'
import { Agent, setGlobalDispatcher } from 'undici'
import { createOidcInterceptor } from '../oidc-interceptor.js'

const dispatcher = new Agent().compose(createOidcInterceptor({
  // The paramerts for the cliend_credentials grant of OIDC
  clientId: 'foo',
  clientSecret: 'bar',
  idpTokenUrl: 'http://localhost:3001/token',

  // Set an array of status codes that the interceptor should refresh and
  // retry the request on
  retryOnStatusCodes: [401],

  // The array of urls that this interceptor will be appending `Authorization` header
  // for automatically
  urls: ['http://localhost:3002'],

  // Token caching configuration using async-cache-dedupe.
  tokenStore: {
    ttl: 100,
    storage: { 
      type: 'redis', 
      options: { 
        client: redisClient 
      } 
    }
  }
}))

setGlobalDispatcher(dispatcher)

const res = await fetch('http://localhost:3002')
console.log(res.status, await res.text())
