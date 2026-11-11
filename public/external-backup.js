/* Sifia — contrato de backup externo.
 * Opt-in: este módulo não transmite dados sozinho.
 * Um provedor remoto deverá ser configurado explicitamente no futuro.
 */
(() => {
  'use strict';

  const PROVIDER_KEY = 'sifia_external_backup_provider';

  function getProvider() {
    try { return JSON.parse(localStorage.getItem(PROVIDER_KEY) || 'null'); }
    catch (_) { return null; }
  }

  function status() {
    const provider = getProvider();
    return provider
      ? { configured: true, provider: provider.name || 'configured' }
      : { configured: false, provider: null };
  }

  async function createPayload() {
    if (!window.SifiaDataSafety) throw new Error('Camada de segurança indisponível');
    const state = window.SifiaDataSafety.inspect();
    if (state.status !== 'ok' || !state.count) throw new Error('Não há dados válidos para backup');
    const raw = localStorage.getItem(window.SifiaDataSafety.transactionKey);
    return {
      format: 'sifia-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      count: state.count,
      transactions: JSON.parse(raw)
    };
  }

  async function send() {
    const provider = getProvider();
    if (!provider) throw new Error('Backup externo não configurado');
    // Segurança por padrão: nenhum endpoint genérico recebe dados financeiros.
    throw new Error('Provedor externo ainda não homologado');
  }

  window.SifiaExternalBackup = Object.freeze({ status, createPayload, send });
})();
