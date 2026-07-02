const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const privateKeyPath = path.join(__dirname, 'private.key');
if (!fs.existsSync(privateKeyPath)) {
    console.error('Private key not found');
    process.exit(1);
}

const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf8');
const publicKeyObject = crypto.createPublicKey(privateKeyPem);

const publicKeyPem = publicKeyObject.export({
    type: 'spki',
    format: 'pem'
});

console.log('--- NEW PUBLIC KEY ---');
console.log(publicKeyPem);
console.log('--- END NEW PUBLIC KEY ---');
