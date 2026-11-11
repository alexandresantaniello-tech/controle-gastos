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

  function getRecoveryState() {
    const current = inspect();
    const snapshots = readSnapshots().map(({ createdAt, reason, count }) => ({ createdAt, reason, count }));
    let meta = null;
    try { meta = JSON.parse(localStorage.getItem(SNAPSHOT_META_KEY) || 'null'); } catch (_) {}
    return { current, snapshots, meta };
  }

  // Snapshot somente de dados válidos já existentes. Nenhuma gravação na chave de transações.
  try { snapshot('startup'); } catch (_) {}

  window.SifiaDataSafety = Object.freeze({
    inspect,
    snapshot,
    getRecoveryState,
    transactionKey: TX_KEY
  });
})();