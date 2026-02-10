import { createServer } from 'http'
import buildGetJwks from 'get-jwks'
import { createVerifier } from 'fast-jwt'

const jwks = buildGetJwks({
  jwksPath: '/jwks'
})

const port = 3002
const idp = 'http://localhost:3001/'

const getKey = ({ header }) => jwks.getPublicKey({ domain: idp, kid: header.kid, alg: header.alg })

const server = createServer(async (req, res) => {
  try {
    console.log(req.method, req.url)
    if (!req.headers.authorization) {
      console.log('No authorization header')
      res.writeHead(401)
      res.end()
      return
    }
    const verifyAsync = createVerifier({ key: getKey })
    const decoded = await verifyAsync(req.headers.authorization.slice('Bearer '.length))
    console.log(decoded)
    res.writeHead(200)
    res.end('Worked!')
  } catch (err) {
    console.error(err)
    res.writeHead(500)
    res.end()
  }
})

await new Promise((resolve) => {
  server.listen(port, resolve)
})

console.log('Server listening on port', port)
