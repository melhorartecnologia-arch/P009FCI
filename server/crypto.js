'use strict';
/**
 * Cofre de credenciais das integrações (RF-090 · RNF-05).
 * AES-256-GCM com chave derivada da FCI_SECRET_KEY via scrypt.
 * A credencial nunca é devolvida em texto claro pela API — apenas
 * o indicador `possuiCredencial` e a máscara fixa "••••••••".
 */
const crypto = require('crypto');
const { config } = require('./config');

const SAL = 'simulador-fci-cci';
let chaveCache = null;

function chave() {
  if (!chaveCache) {
    chaveCache = crypto.scryptSync(config.secretKey, SAL, 32);
  }
  return chaveCache;
}

function cifrar(textoClaro) {
  if (textoClaro == null || textoClaro === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const enc = Buffer.concat([cipher.update(String(textoClaro), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

function decifrar(cifrado) {
  if (!cifrado) return '';
  const [v, ivB64, tagB64, dataB64] = String(cifrado).split('.');
  if (v !== 'v1') throw new Error('Formato de credencial desconhecido');
  const decipher = crypto.createDecipheriv('aes-256-gcm', chave(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

const MASCARA = '••••••••';

module.exports = { cifrar, decifrar, MASCARA };
