'use strict';

const assert = require('node:assert/strict');

function parseArray(raw) {
  if (raw === null) return { status: 'missing', data: null };
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return { status: 'invalid', data: null };
    return { status: 'ok', data: value };
  } catch (_) {
    return { status: 'invalid', data: null };
  }
}

function mayWrite(currentRaw, next) {
  if (!Array.isArray(next)) return false;
  if (!currentRaw) return true;
  const current = parseArray(currentRaw);
  if (current.status !== 'ok') return false;
  if (current.data.length > 0 && next.length === 0) return false;
  return true;
}

function canRecover(currentRaw, mirrorRaw) {
  const current = parseArray(currentRaw);
  if (current.status === 'ok') return false;
  const mirror = parseArray(mirrorRaw);
  return mirror.status === 'ok' && mirror.data.length > 0;
}

const original = [{ id: 1 }, { id: 2 }, { id: 3 }];

assert.equal(parseArray(JSON.stringify(original)).data.length, 3, 'base válida deve manter registros');
assert.equal(parseArray('{corrompido').status, 'invalid', 'corrupção deve ser detectada');
assert.equal(mayWrite(JSON.stringify(original), []), false, 'não pode zerar uma base com registros');
assert.equal(mayWrite(JSON.stringify(original), [...original, { id: 4 }]), true, 'deve permitir gravação válida');
assert.equal(mayWrite('{corrompido', [{ id: 4 }]), false, 'não pode sobrescrever base corrompida');
assert.equal(canRecover(null, JSON.stringify(original)), true, 'deve permitir recuperar base ausente');
assert.equal(canRecover('{corrompido', JSON.stringify(original)), true, 'deve permitir recuperar base corrompida');
assert.equal(canRecover(JSON.stringify([]), JSON.stringify(original)), false, 'base vazia válida não deve ser sobrescrita');
assert.equal(canRecover(JSON.stringify(original), JSON.stringify([{ id: 9 }])), false, 'base válida nunca deve ser sobrescrita pelo espelho');
assert.equal(canRecover(null, JSON.stringify([])), false, 'espelho vazio não serve para recuperação');

console.log('✓ Integridade de dados Sifia: 10 cenários aprovados');
