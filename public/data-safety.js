/* Sifia — camada defensiva de segurança dos dados.
 * Não conhece a UI e não altera registros durante a inicialização.
 * Objetivo: snapshots locais e validação antes de qualquer substituição futura.
 */
(() => {
  'use strict';

  const TX_KEY = 'controle_gastos_transacoes';
  const SNAPSHOT_KEY = 'sifia_transacoes_snapshot';
  const SNAPSHOT_META_KEY = 'sifia_transacoes_snapshot_meta';
  const MAX_SNAPSHOTS = 5;
  const DB_NAME = 'sifia_financeiro';
  const DB_VERSION = 1;
  const DB_STORE = 'safety';
  const DB_TX_KEY = 'transactions_latest';
  const RECOVERY_FLAG_KEY = 'sifia_recovery_available';

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

  function inspect() {
    const raw = localStorage.getItem(TX_KEY);
    const parsed = parseArray(raw);
    return {
      status: parsed.status,
      count: parsed.data ? parsed.data.length : null,
      rawLength: raw ? raw.length : 0
    };
  }

  function readSnapshots() {
    try {
      const value = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  function snapshot(reason = 'manual') {
    const raw = localStorage.getItem(TX_KEY);
    const parsed = parseArray(raw);
    // Nunca cria snapshot de dado ausente/corrompido nem substitui cópia boa por vazio.
    if (parsed.status !== 'ok' || parsed.data.length === 0) return false;

    const snapshots = readSnapshots();
    const last = snapshots[0];
    if (last && last.raw === raw) return true;

    snapshots.unshift({
      createdAt: new Date().toISOString(),
      reason,
      count: parsed.data.length,
      raw
    });
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots.slice(0, MAX_SNAPSHOTS)));
    localStorage.setItem(SNAPSHOT_META_KEY, JSON.stringify({
      lastSnapshotAt: snapshots[0].createdAt,
      lastKnownCount: parsed.data.length
    }));
    return true;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB indisponível'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Falha ao abrir IndexedDB'));
    });
  }

  async function mirrorToIndexedDb(reason = 'mirror') {
    const raw = localStorage.getItem(TX_KEY);
    const parsed = parseArray(raw);
    if (parsed.status !== 'ok' || parsed.data.length === 0) return false;

    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put({
          raw,
          count: parsed.data.length,
          updatedAt: new Date().toISOString(),
          reason
        }, DB_TX_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Falha ao espelhar dados'));
        tx.onabort = () => reject(tx.error || new Error('Espelhamento abortado'));
      });
      return true;
    } finally {
      db.close();
    }
  }

  async function inspectIndexedDb() {
    try {
      const db = await openDb();
      try {
        const value = await new Promise((resolve, reject) => {
          const tx = db.transaction(DB_STORE, 'readonly');
          const req = tx.objectStore(DB_STORE).get(DB_TX_KEY);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error || new Error('Falha ao ler espelho'));
        });
        return value ? { status: 'ok', count: value.count, updatedAt: value.updatedAt } : { status: 'missing' };
      } finally {
        db.close();
      }
    } catch (err) {
      return { status: 'unavailable', message: err && err.message ? err.message : String(err) };
    }
  }

  async function readIndexedDbMirror() {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const req = tx.objectStore(DB_STORE).get(DB_TX_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error || new Error('Falha ao ler espelho'));
      });
    } finally {
      db.close();
    }
  }

  async function canRecoverFromIndexedDb() {
    const currentRaw = localStorage.getItem(TX_KEY);
    const current = parseArray(currentRaw);
    // Nunca oferece recuperação sobre uma base válida, inclusive uma base legitimamente vazia.
    if (current.status === 'ok') return { canRecover: false, reason: 'primary-valid' };

    try {
      const mirror = await readIndexedDbMirror();
      if (!mirror || typeof mirror.raw !== 'string') return { canRecover: false, reason: 'mirror-missing' };
      const parsedMirror = parseArray(mirror.raw);
      if (parsedMirror.status !== 'ok' || parsedMirror.data.length === 0) {
        return { canRecover: false, reason: 'mirror-invalid' };
      }
      return {
        canRecover: true,
        reason: current.status,
        count: parsedMirror.data.length,
        updatedAt: mirror.updatedAt || null
      };
    } catch (err) {
      return { canRecover: false, reason: 'mirror-unavailable' };
    }
  }

  async function recoverFromIndexedDb() {
    const eligibility = await canRecoverFromIndexedDb();
    if (!eligibility.canRecover) return { restored: false, reason: eligibility.reason };

    const mirror = await readIndexedDbMirror();
    const parsedMirror = parseArray(mirror.raw);
    if (parsedMirror.status !== 'ok' || parsedMirror.data.length === 0) {
      return { restored: false, reason: 'mirror-invalid' };
    }

    // A única escrita na chave principal ocorre após dupla validação e apenas
    // quando a base principal não é válida.
    localStorage.setItem(TX_KEY, mirror.raw);
    snapshot('recovered-from-indexeddb');
    return {
      restored: true,
      count: parsedMirror.data.length,
      recoveredAt: new Date().toISOString(),
      sourceUpdatedAt: mirror.updatedAt || null
    };
  }

  function getRecoveryState() {
    const current = inspect();
    const snapshots = readSnapshots().map(({ createdAt, reason, count }) => ({ createdAt, reason, count }));
    let meta = null;
    try { meta = JSON.parse(localStorage.getItem(SNAPSHOT_META_KEY) || 'null'); } catch (_) {}
    return { current, snapshots, meta };
  }

  // Snapshot somente de dados válidos já existentes. Nenhuma gravação na chave de transações.
  try { snapshot('startup'); } catch (_) {}
  mirrorToIndexedDb('startup').catch(err => console.warn('[Sifia] Espelho IndexedDB indisponível.', err));
  canRecoverFromIndexedDb().then(state => {
    if (state.canRecover) {
      sessionStorage.setItem(RECOVERY_FLAG_KEY, JSON.stringify(state));
      console.warn('[Sifia] Há uma cópia de recuperação disponível no IndexedDB.', state);
    } else {
      sessionStorage.removeItem(RECOVERY_FLAG_KEY);
    }
  }).catch(() => {});

  window.SifiaDataSafety = Object.freeze({
    inspect,
    snapshot,
    mirrorToIndexedDb,
    inspectIndexedDb,
    canRecoverFromIndexedDb,
    recoverFromIndexedDb,
    getRecoveryState,
    recoveryFlagKey: RECOVERY_FLAG_KEY,
    transactionKey: TX_KEY
  });
})();