const fs = require('fs');
const path = 'public/index.html';
let html = fs.readFileSync(path, 'utf8');

const alvoMostrar = `    mostrarPixNoPaywall(dados);`;
const substitutoMostrar = `    mostrarPixNoPaywall(dados);\n    iniciarVerificacaoAutomaticaPagamento();`;

// Existem dois fluxos que exibem Pix: assinatura inicial e gerar novo Pix.
let pos = 0;
let trocas = 0;
while ((pos = html.indexOf(alvoMostrar, pos)) !== -1) {
  html = html.slice(0, pos) + substitutoMostrar + html.slice(pos + alvoMostrar.length);
  pos += substitutoMostrar.length;
  trocas++;
}
if (trocas < 2) throw new Error('Esperava pelo menos 2 chamadas de mostrarPixNoPaywall; encontrei ' + trocas);

const marcador = `async function verificarPagamentoPaywall() {`;
const idx = html.indexOf(marcador);
if (idx < 0) throw new Error('verificarPagamentoPaywall não encontrada');

const codigo = `let timerVerificacaoPagamento = null;\nlet verificacaoPagamentoEmAndamento = false;\n\nfunction pararVerificacaoAutomaticaPagamento() {\n  if (timerVerificacaoPagamento) clearInterval(timerVerificacaoPagamento);\n  timerVerificacaoPagamento = null;\n}\n\nasync function consultarPagamentoAutomaticamente() {\n  if (verificacaoPagamentoEmAndamento) return;\n  const overlay = document.getElementById('paywallOverlay');\n  const passo2 = document.getElementById('paywallPasso2');\n  if (!overlay || !overlay.classList.contains('aberto') || !passo2 || passo2.style.display === 'none') {\n    pararVerificacaoAutomaticaPagamento();\n    return;\n  }\n  const chave = localStorage.getItem(CHAVE_LICENCA_KEY);\n  if (!chave) return;\n  verificacaoPagamentoEmAndamento = true;\n  try {\n    const resp = await fetch('/api/licenca/' + chave, { cache: 'no-store' });\n    if (!resp.ok) return;\n    const dados = await resp.json();\n    if (dados.ativa) {\n      pararVerificacaoAutomaticaPagamento();\n      const statusEl = document.getElementById('statusPaywall2');\n      if (statusEl) statusEl.textContent = 'Pagamento confirmado ✓ Liberando seu acesso...';\n      setTimeout(() => {\n        overlay.classList.remove('aberto');\n        const bloco = document.getElementById('blocoAssinatura');\n        if (bloco) bloco.style.display = 'block';\n      }, 650);\n    }\n  } catch (err) {\n    // Falha temporária de rede não interrompe o fluxo; a próxima consulta tenta de novo.\n  } finally {\n    verificacaoPagamentoEmAndamento = false;\n  }\n}\n\nfunction iniciarVerificacaoAutomaticaPagamento() {\n  pararVerificacaoAutomaticaPagamento();\n  const statusEl = document.getElementById('statusPaywall2');\n  if (statusEl) statusEl.textContent = 'Aguardando confirmação do pagamento...';\n  consultarPagamentoAutomaticamente();\n  timerVerificacaoPagamento = setInterval(consultarPagamentoAutomaticamente, 2500);\n}\n\n`;
html = html.slice(0, idx) + codigo + html.slice(idx);

// O botão manual continua como fallback, mas quando ele confirmar também encerra o polling.
const sucessoManual = `    if (dados.ativa) {\n      document.getElementById('paywallOverlay').classList.remove('aberto');`;
const sucessoManualNovo = `    if (dados.ativa) {\n      pararVerificacaoAutomaticaPagamento();\n      document.getElementById('paywallOverlay').classList.remove('aberto');`;
if (!html.includes(sucessoManual)) throw new Error('Trecho de sucesso manual não encontrado');
html = html.replace(sucessoManual, sucessoManualNovo);

fs.writeFileSync(path, html);
console.log('Verificação automática do Pix aplicada. Consultas a cada 2,5 segundos; botão manual preservado como fallback.');
