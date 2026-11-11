/* Sifia — interface de recuperação de dados.
 * Mantida fora do index principal para reduzir acoplamento da camada de segurança.
 */
(() => {
  'use strict';

  async function verificar() {
    if (!window.SifiaDataSafety) return;
    const state = await window.SifiaDataSafety.canRecoverFromIndexedDb();
    if (!state.canRecover) return;
    const overlay = document.getElementById('recuperacaoDadosOverlay');
    const texto = document.getElementById('recuperacaoDadosTexto');
    if (!overlay || !texto) return;
    texto.textContent = `O Sifia encontrou uma cópia protegida com ${state.count} registro(s). Os dados principais estão ausentes ou não puderam ser lidos. Nada será restaurado sem sua confirmação.`;
    overlay.style.display = 'flex';
  }

  function fechar() {
    const overlay = document.getElementById('recuperacaoDadosOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  async function restaurar() {
    const botao = document.getElementById('btnRestaurarDadosSeguranca');
    const status = document.getElementById('statusRecuperacaoDados');
    if (botao) botao.disabled = true;
    if (status) status.textContent = 'Validando a cópia protegida…';
    try {
      const result = await window.SifiaDataSafety.recoverFromIndexedDb();
      if (!result.restored) throw new Error('A restauração não pôde ser realizada com segurança.');
      if (status) status.textContent = `${result.count} registro(s) restaurado(s). Reabrindo o Sifia…`;
      setTimeout(() => location.reload(), 700);
    } catch (err) {
      if (status) {
        status.textContent = err && err.message ? err.message : 'Não foi possível restaurar os dados.';
        status.className = 'status error';
      }
      if (botao) botao.disabled = false;
    }
  }

  window.verificarRecuperacaoDadosSeguranca = verificar;
  window.fecharRecuperacaoDados = fechar;
  window.restaurarDadosSeguranca = restaurar;
})();
