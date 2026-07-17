const crypto = require('node:crypto');

let cached;

function getEphemeralSigningKeys() {
  if (!cached) {
    const pair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    cached = Object.freeze(pair);
  }
  return cached;
}

module.exports = { getEphemeralSigningKeys };
