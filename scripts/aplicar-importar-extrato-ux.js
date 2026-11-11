const fs = require('fs');
const p = 'public/index.html';
let s = fs.readFileSync(p, 'utf8');
const reps = [
  [
    '<span class="toggle-texto" data-i18n="navUpload">Upload</span>',
    '<span class="toggle-texto" data-i18n="navUpload">Importar extrato</span>'
  ],
  [
    '<h3 class="historico-titulo" data-i18n="beneficioBoasVindasLabel">Importe seu histórico financeiro</h3>\n    <p class="historico-descricao" data-i18n="avisoImportarExtrato">Importe seus extratos bancários em PDF e organize até três meses de movimentações de até quatro bancos.</p>',
    '<h3 class="historico-titulo">Importar extrato</h3>\n    <p class="historico-descricao" style="font-size:15px;color:var(--foreground);">Traga seu histórico financeiro para o Sifia.</p>\n    <div class="historico-beneficio"><strong>Benefício de boas-vindas</strong><span>3 meses de histórico · até 4 bancos</span></div>\n    <p class="historico-descricao">Selecione um extrato bancário em PDF. O Sifia identifica as movimentações e organiza seu histórico.</p>'
  ],
  [
    '<span class="historico-arquivo-titulo">Selecione seu extrato em PDF</span>',
    '<span class="historico-arquivo-titulo">Escolher extrato em PDF</span>'
  ],
  [
    '<p class="historico-privacidade">♢ Sua senha é utilizada somente no aparelho.</p>',
    '<p class="historico-privacidade">🔒 PDF com senha? Informe acima. Sua senha é usada somente no seu aparelho.</p>'
  ],
  [
    '<button onclick="importarHistorico()" id="btnImportarHistorico" class="historico-botao" data-i18n="importarHistoricoBotao">Importar extrato</button>\n    <div class="status" id="statusHistorico"></div>',
    '<button onclick="importarHistorico()" id="btnImportarHistorico" class="historico-botao" data-i18n="importarHistoricoBotao">Importar histórico</button>\n    <div class="status" id="statusHistorico"></div>\n    <p class="historico-rodape">As movimentações importadas ficam disponíveis no Histórico.</p>'
  ]
];
for (const [a,b] of reps) {
  if (!s.includes(a)) throw new Error('Trecho esperado não encontrado: ' + a.slice(0,80));
  s = s.replace(a,b);
}
const cssNeedle = '#uploadHistoricoCard .historico-restantes:empty{display:none}';
const cssAdd = cssNeedle + '\n#uploadHistoricoCard .historico-beneficio{display:flex;flex-direction:column;gap:3px;padding:11px 12px;background:var(--secondary);border:1px solid var(--border);border-radius:10px}\n#uploadHistoricoCard .historico-beneficio strong{font-size:13px;color:var(--foreground)}\n#uploadHistoricoCard .historico-beneficio span{font-size:12px;color:var(--muted-foreground)}\n#uploadHistoricoCard .historico-rodape{margin:0;text-align:center;font-size:11px;line-height:1.4;color:var(--muted-foreground)}';
if (!s.includes(cssNeedle)) throw new Error('CSS de importação não encontrado');
s = s.replace(cssNeedle, cssAdd);
fs.writeFileSync(p, s);
console.log('UX de Importar extrato aplicada com sucesso.');
