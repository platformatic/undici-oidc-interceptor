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

class MemoryAdapter {
  constructor(model) {
    this.model = model;
    this.storage = new Map();
  }

  key(id) {
    return `${this.model}:${id}`;
  }

  async destroy(id) {
    const key = this.key(id);
    this.storage.delete(key);
  }

  async consume(id) {
    this.storage.get(this.key(id)).consumed = epochTime();
  }

  async find(id) {
    return this.storage.get(this.key(id));
  }

  async findByUid(uid) {
    const id = this.storage.get(sessionUidKeyFor(uid));
    return this.find(id);
  }

  async findByUserCode(userCode) {
    const id = this.storage.get(userCodeKeyFor(userCode));
    return this.find(id);
  }

  async upsert(id, payload, expiresIn) {
    const key = this.key(id);

    if (this.model === 'Session') {
      this.storage.set(sessionUidKeyFor(payload.uid), id, expiresIn * 1000);
    }

    const { grantId, userCode } = payload;
    if (grantable.has(this.model) && grantId) {
      const grantKey = grantKeyFor(grantId);
      const grant = this.storage.get(grantKey);
      if (!grant) {
        this.storage.set(grantKey, [key]);
      } else {
        grant.push(key);
      }
    }

    if (userCode) {
      this.storage.set(userCodeKeyFor(userCode), id, expiresIn * 1000);
    }

    this.storage.set(key, payload, expiresIn * 1000);
  }

  async revokeByGrantId(grantId) { // eslint-disable-line class-methods-use-this
    const grantKey = grantKeyFor(grantId);
    const grant = this.storage.get(grantKey);
    if (grant) {
      grant.forEach((token) => this.storage.delete(token));
      this.storage.delete(grantKey);
    }
  }
}

async function testProvider (t, { port }) {
  const Provider = (await import('oidc-provider')).default
  const config = {
    ttl: { 
      ClientCredentials(ctx, token, client) {
        return token.resourceServer?.accessTokenTTL || 10 * 60;
      }
    },
    clients: [
      {
        client_id: 'foo',
        client_secret: 'bar',
        token_endpoint_auth_method: 'client_secret_post',
        grant_types: ['client_credentials'],
        redirect_uris: [],
        response_types: [],
      },
    ],
    cookies: {
      keys: ['mysecret123']
    },
    adapter: MemoryAdapter,
    jwks: {
      // Copied from oidc-provider test suite
      // https://github.com/panva/node-oidc-provider/blob/270af1da83dda4c49edb4aaab48908f737d73379/example/support/configuration.js#L31C3-L52C7
      keys: [
        {
          d: 'VEZOsY07JTFzGTqv6cC2Y32vsfChind2I_TTuvV225_-0zrSej3XLRg8iE_u0-3GSgiGi4WImmTwmEgLo4Qp3uEcxCYbt4NMJC7fwT2i3dfRZjtZ4yJwFl0SIj8TgfQ8ptwZbFZUlcHGXZIr4nL8GXyQT0CK8wy4COfmymHrrUoyfZA154ql_OsoiupSUCRcKVvZj2JHL2KILsq_sh_l7g2dqAN8D7jYfJ58MkqlknBMa2-zi5I0-1JUOwztVNml_zGrp27UbEU60RqV3GHjoqwI6m01U7K0a8Q_SQAKYGqgepbAYOA-P4_TLl5KC4-WWBZu_rVfwgSENwWNEhw8oQ',
          dp: 'E1Y-SN4bQqX7kP-bNgZ_gEv-pixJ5F_EGocHKfS56jtzRqQdTurrk4jIVpI-ZITA88lWAHxjD-OaoJUh9Jupd_lwD5Si80PyVxOMI2xaGQiF0lbKJfD38Sh8frRpgelZVaK_gm834B6SLfxKdNsP04DsJqGKktODF_fZeaGFPH0',
          dq: 'F90JPxevQYOlAgEH0TUt1-3_hyxY6cfPRU2HQBaahyWrtCWpaOzenKZnvGFZdg-BuLVKjCchq3G_70OLE-XDP_ol0UTJmDTT-WyuJQdEMpt_WFF9yJGoeIu8yohfeLatU-67ukjghJ0s9CBzNE_LrGEV6Cup3FXywpSYZAV3iqc',
          e: 'AQAB',
          kty: 'RSA',
          n: 'xwQ72P9z9OYshiQ-ntDYaPnnfwG6u9JAdLMZ5o0dmjlcyrvwQRdoFIKPnO65Q8mh6F_LDSxjxa2Yzo_wdjhbPZLjfUJXgCzm54cClXzT5twzo7lzoAfaJlkTsoZc2HFWqmcri0BuzmTFLZx2Q7wYBm0pXHmQKF0V-C1O6NWfd4mfBhbM-I1tHYSpAMgarSm22WDMDx-WWI7TEzy2QhaBVaENW9BKaKkJklocAZCxk18WhR0fckIGiWiSM5FcU1PY2jfGsTmX505Ub7P5Dz75Ygqrutd5tFrcqyPAtPTFDk8X1InxkkUwpP3nFU5o50DGhwQolGYKPGtQ-ZtmbOfcWQ',
          p: '5wC6nY6Ev5FqcLPCqn9fC6R9KUuBej6NaAVOKW7GXiOJAq2WrileGKfMc9kIny20zW3uWkRLm-O-3Yzze1zFpxmqvsvCxZ5ERVZ6leiNXSu3tez71ZZwp0O9gys4knjrI-9w46l_vFuRtjL6XEeFfHEZFaNJpz-lcnb3w0okrbM',
          q: '3I1qeEDslZFB8iNfpKAdWtz_Wzm6-jayT_V6aIvhvMj5mnU-Xpj75zLPQSGa9wunMlOoZW9w1wDO1FVuDhwzeOJaTm-Ds0MezeC4U6nVGyyDHb4CUA3ml2tzt4yLrqGYMT7XbADSvuWYADHw79OFjEi4T3s3tJymhaBvy1ulv8M',
          qi: 'wSbXte9PcPtr788e713KHQ4waE26CzoXx-JNOgN0iqJMN6C4_XJEX-cSvCZDf4rh7xpXN6SGLVd5ibIyDJi7bbi5EQ5AXjazPbLBjRthcGXsIuZ3AtQyR0CEWNSdM7EyM5TRdyZQ9kftfz9nI03guW3iKKASETqX2vh0Z8XRjyU',
          use: 'sig',
        }, {
          crv: 'P-256',
          d: 'K9xfPv773dZR22TVUB80xouzdF7qCg5cWjPjkHyv7Ws',
          kty: 'EC',
          use: 'sig',
          x: 'FWZ9rSkLt6Dx9E3pxLybhdM6xgR5obGsj5_pqmnz5J4',
          y: '_n8G69C-A2Xl4xUW2lF0i8ZGZnk_KPYrhv4GbTGu5G4',
        },
      ],
    },
    features: {
      devInteractions: { enabled: false },
      clientCredentials: {
        enabled: true,
      },
      resourceIndicators: {
        defaultResource () {
          return 'urn:example:foo';
        },
        getResourceServerInfo() {
          return {
            scope: 'api:read',
            accessTokenFormat: 'jwt',
            accessTokenTTL: 50,
          }
        },
      }
    }
  }
  const provider = new Provider(`http://localhost:${port}`, config)
  const server = await new Promise((resolve) => {
    const s = provider.listen(port, () => {
      resolve(s)
    })
  });

  t.after(() => {
    return server.close()
  })

  server.config = config

  return server
}

module.exports = {
  createToken,
  testProvider
}
