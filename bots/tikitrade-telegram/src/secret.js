'use strict';
// Claves de los entrenadores cifradas en disco (AES-256-GCM con la CLAVE_MAESTRA del servidor).
const crypto = require('crypto');
const keyOf = master => crypto.scryptSync(master, 'tikitrade/claves', 32);
function seal(obj, master) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', keyOf(master), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}
function open(str, master) {
  const b = Buffer.from(str, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', keyOf(master), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
}
module.exports = { seal, open };
