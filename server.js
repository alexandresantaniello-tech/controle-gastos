require('dotenv').config();
const express = require('express');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const rateLimit = require('express-rate-limit');

const app = express();
// Render fica atras de um proxy reverso - sem isso, o rate limit contaria
// todo mundo como o mesmo IP (o do proxy), em vez do IP real de cada
// cliente.
app.set('trust proxy', 1);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.static('public', {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, must-revalidate'),
}));
app.use(express.json());

// Protecao contra abuso: os endpoints que chamam a API da Anthropic (custo
// real por chamada) nao tinham NENHUM limite - qualquer pessoa que
// descobrisse a URL podia esgotar os creditos sem nunca abrir o app de
// verdade. 20 requisicoes/minuto por IP fica bem acima do uso normal de uma
// pessoa (a importacao em lote do extrato processa pagina por pagina, uma de
// cada vez, nao em paralelo), mas barra abuso automatizado.
const limiteApiIA = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas requisições em pouco tempo - aguarde um minuto e tente de novo.' },
});

// Segunda camada, so no endpoint mais caro (analise de imagem): exige um
// segredo que so o proprio Sifia manda automaticamente. Nao aplicamos no
// /api/parse-texto porque o Atalho do iOS chama ele direto, sem esse
// cabecalho - exigir la quebraria esse caminho pra quem ja configurou.
function exigirSegredoApp(req, res, next) {
  if (req.headers['x-app-secret'] !== process.env.APP_SECRET) {
    return res.status(403).json({ erro: 'acesso negado' });
  }
  next();
}

function getExtractionPrompt() {
  const hoje = new Date();
  const hojeStr = String(hoje.getDate()).padStart(2, '0') + '/' + String(hoje.getMonth() + 1).padStart(2, '0') + '/' + hoje.getFullYear();
  const ontem = new Date(hoje);
  ontem.setDate(ontem.getDate() - 1);
  const ontemStr = String(ontem.getDate()).padStart(2, '0') + '/' + String(ontem.getMonth() + 1).padStart(2, '0') + '/' + ontem.getFullYear();

  return `Você recebe a imagem de um comprovante/notificação de transação bancária brasileira (Pix, transferência, débito ou crédito). A imagem pode conter UMA ou VÁRIAS transações (por exemplo, duas ou mais notificações de banco empilhadas na mesma captura de tela, OU uma lista de transações do app do banco agrupada por dia).
A data de HOJE é ${hojeStr}. Se o comprovante mostrar uma data relativa como "Hoje", use ${hojeStr}. Se mostrar "Ontem", use ${ontemStr}. Se mostrar dia da semana + dia do mês sem ano (ex: "Segunda-feira, 13 de julho"), calcule o ano correto usando ${hojeStr} como referência de hoje.
IMPORTANTE - listas agrupadas por dia: se a imagem for uma LISTA de transações do app do banco (não notificações individuais empilhadas), é comum o cabeçalho da data ("Hoje", "Ontem", ou uma data) aparecer só UMA VEZ no topo do grupo, sem se repetir ao lado de cada transação. Nesse caso, aplique essa MESMA data pra TODAS as transações listadas logo abaixo desse cabeçalho, até que apareça um novo cabeçalho de data diferente mais abaixo (indicando o próximo grupo/dia). NUNCA responda "desconhecido" pra data de uma transação só porque ela não repete a data ao lado - primeiro procure o cabeçalho de grupo mais próximo acima dela na imagem.
Extraia TODAS as transações visíveis na imagem e responda APENAS com um JSON válido, sem nenhum texto antes ou depois: um ARRAY, mesmo que exista só uma transação. Cada item do array no formato:
{
  "valor": (número, ex: 150.50 - transcreva EXATAMENTE o valor visível na imagem. NUNCA invente ou estime um valor, e NUNCA use 0 como valor "vazio" - se genuinamente não houver nenhum valor monetário visível nessa imagem, responda "valor":"desconhecido" em vez de arriscar um número),
  "tipo": ("entrada" se o dinheiro foi RECEBIDO/creditado na conta do usuário, "saida" se foi ENVIADO/debitado da conta do usuário. Preste atenção especial: textos como "você recebeu", "Pix recebido", "creditado", ou valores em VERDE geralmente indicam entrada; textos como "você enviou", "Pix enviado", "pagamento", "debitado", ou valores em VERMELHO/CINZA geralmente indicam saída. Não confunda o nome de quem aparece no comprovante com a direção — o importante é se o dinheiro ENTROU ou SAIU da conta de quem é dono do comprovante),
  "categoria": (categoria da transação, inferida do nome do estabelecimento/recebedor e contexto; use uma categoria curta e específica, ex: "Transporte", "Padaria", "Comida na rua", "Mercado", "Farmácia/Saúde", "Lazer", "Assinaturas", "Contas/Serviços", "Salário", "Cliente/Serviço prestado", "Transferência entre contas", "Outros"),
  "instituicao": (nome do banco/fintech, ou "desconhecido" se não identificar),
  "titulo_bruto_da_notificacao": (se essa transação for uma compra no cartão (não Pix), transcreva EXATAMENTE o título/cabeçalho da notificação, ignorando qualquer outro elemento na tela (barra de status, ícones, outros botões) - ex: "Compra no débito aprovada" ou "Compra no crédito aprovada". Se for Pix, deixe null),
  "local": (APENAS o nome do recebedor/pagador ou estabelecimento, ou "desconhecido" - ex: "Padaria Nova", "Anthropic". NUNCA inclua prefixo de tipo de transação aqui ("Débito", "Crédito", "Pix enviado para", "Pix recebido de") - essa informação vai só no campo "forma_pagamento" abaixo, separado, pra não misturar o nome com o tipo de pagamento),
  "forma_pagamento": (derive do que você TRANSCREVEU em "titulo_bruto_da_notificacao" ou da natureza Pix da transação - use EXATAMENTE um destes valores: "debito", "credito", "pix", "desconhecido". Se "titulo_bruto_da_notificacao" contiver "débito" = "debito"; se contiver "crédito" = "credito"; se for uma transação Pix = "pix"; se não conseguir determinar = "desconhecido"),
  "data": (data da transação no formato EXATO DD/MM/AAAA — sempre com barras, sempre com o ano de 4 digitos, nunca por extenso, ou "desconhecido" se realmente não der pra determinar)
}
Se não conseguir identificar algum campo de uma transação, use "desconhecido" nesse campo. Se a imagem não tiver nenhuma transação bancária reconhecível, responda com {"erro": "imagem não reconhecida como comprovante"} (sem array, só esse objeto).`;
}

function getExtractionPromptExtrato(dataReferenciaPagina) {
  const hoje = new Date();
  const hojeStr = String(hoje.getDate()).padStart(2, '0') + '/' + String(hoje.getMonth() + 1).padStart(2, '0') + '/' + hoje.getFullYear();
  const umAnoAtras = new Date(hoje);
  umAnoAtras.setFullYear(umAnoAtras.getFullYear() - 1);
  const umAnoAtrasStr = String(umAnoAtras.getDate()).padStart(2, '0') + '/' + String(umAnoAtras.getMonth() + 1).padStart(2, '0') + '/' + umAnoAtras.getFullYear();

  // O cliente ja escaneia o texto bruto da pagina (sem custo de IA) so pra
  // decidir se ela esta dentro do prazo de 1 ano - a data mais recente que
  // ele acha nesse processo e um sinal real sobre o ano dessa pagina
  // especifica, mais confiavel que pedir pra IA adivinhar linha por linha.
  const dicaAncora = dataReferenciaPagina
    ? `\nDICA IMPORTANTE: uma verificacao previa (fora da IA) encontrou "${dataReferenciaPagina}" como a data mais recente visivel no texto desta pagina especifica. Use isso como ancora forte pro ano de qualquer transacao ambigua nesta pagina - se uma linha mostra so DD/MM sem ano visivel, o ano dela quase certamente e o mesmo ano dessa data de referencia (ou o ano anterior, se o mes da linha for maior que o mes da referencia, indicando uma virada de ano dentro da pagina). Prefira usar essa ancora a responder "desconhecido".`
    : '';

  return `Voce recebe a imagem de UMA PAGINA de um extrato bancario brasileiro completo (varias paginas no total). Essa pagina especifica pode conter uma TABELA com varias linhas de transacoes (colunas como data, tipo, descricao, valor), ou pode nao conter nenhuma transacao (ex: capa, pagina de contato/atendimento ao cliente, SAC, Ouvidoria, aviso legal, propaganda do banco).
A data de HOJE e ${hojeStr}. TODAS as transacoes deste extrato tem data entre ${umAnoAtrasStr} e ${hojeStr} - nao existe transacao fora desse intervalo neste documento. As linhas da tabela quase sempre mostram so DD/MM, sem ano - o ano so aparece explicitamente no cabecalho da secao do mes (ex: "Julho 2026 (...)") ou nas linhas "Saldo do dia DD/MM/AA". Se a pagina for uma CONTINUACAO de um mes (sem esse cabecalho visivel), infira o ano a partir do "Saldo do dia" mais proximo, ou do fato de que so existe UM ano possivel pra cada mes dentro do intervalo ${umAnoAtrasStr} a ${hojeStr} - NUNCA invente um ano fora desse intervalo (ex: nao existe transacao de 2020, 2019, etc. nesse documento).${dicaAncora}
Se genuinamente nao conseguir determinar o ano com confianca mesmo usando essa ancora, responda "data":"desconhecido" em vez de arriscar um ano errado - inventar e muito pior que admitir que nao sabe, mas isso deve ser raro agora que voce tem a ancora acima.
Se a pagina tiver uma tabela de transacoes, extraia TODAS as linhas da tabela, uma por item do array, no formato:
{
  "valor": (numero, ex: 150.50),
  "tipo_bruto_da_coluna": (copie EXATAMENTE o texto que aparece na coluna "Tipo" dessa linha especifica, sem interpretar ainda - ex: "Entrada PIX", "Saida PIX", "Debito de Cartao". Essa e uma transcricao literal - faca isso ANTES de decidir o campo "tipo" abaixo, linha por linha, sem deixar o padrao das linhas anteriores influenciar essa transcricao),
  "tipo": (derive isso do "tipo_bruto_da_coluna" que voce ACABOU de transcrever nesta mesma linha - nao decida olhando so a descricao ou o padrao geral da pagina: se "tipo_bruto_da_coluna" contiver "Entrada" = entrada. Se contiver "Saida", "Debito" ou "Pagamento" = saida. Como checagem extra: se a descricao contiver "enviado"/"enviado para" o resultado tem que ser saida; se contiver "recebido"/"recebido de" o resultado tem que ser entrada - se isso conflitar com o que voce transcreveu, revise a transcricao, um dos dois esta errado),
  "categoria": (categoria curta inferida do estabelecimento/descricao, ex: "Transporte", "Mercado", "Combustivel", "Salario", "Transferencia entre contas", "Outros"),
  "instituicao": (nome do banco, ou "desconhecido"),
  "local": (APENAS o nome do estabelecimento/recebedor/pagador exatamente como aparece na linha, ou "desconhecido". NUNCA inclua prefixo de tipo de transacao aqui ("Debito", "Credito", "Pix enviado para", "Pix recebido de") - essa informacao vai so no campo "forma_pagamento" abaixo, separado, pra nao misturar o nome com o tipo de pagamento),
  "forma_pagamento": (derive do "tipo_bruto_da_coluna" que voce ja transcreveu nesta mesma linha - use EXATAMENTE um destes valores: "debito", "credito", "pix", "desconhecido". Se contiver "Debito" = "debito"; se contiver algo de credito = "credito"; se for Pix = "pix"; senao "desconhecido"),
  "ano_bruto_do_saldo": (procure a linha "Saldo do dia DD/MM/AA" mais proxima dessa transacao nesta mesma pagina (antes ou depois) e transcreva EXATAMENTE os 2 digitos do ano que aparecem nela - ex: se a linha disser "Saldo do dia 05/05/26", escreva "26". Isso e uma transcricao literal do que esta escrito na imagem, nao um calculo ou suposicao. Se a pagina tiver um cabecalho de mes com ano completo em vez disso (ex: "Julho 2026 (...)"), transcreva os 4 digitos desse ano aqui em vez disso (ex: "2026")),
  "data": (construa usando o dia/mes da coluna "Data lancamento" - a PRIMEIRA coluna de data da linha, mais a esquerda - NUNCA a coluna "Data contabil" (segunda coluna), que e so quando o banco processou internamente e pode ficar alguns dias atrasada em relacao a quando a compra/Pix realmente aconteceu. As duas colunas costumam ser iguais, mas quando forem diferentes (ex: lancamento 27/06, contabil 29/06), use sempre a primeira. Junte esse dia/mes com o ano transcrito em "ano_bruto_do_saldo" (some 2000 se ele tiver so 2 digitos) - formato EXATO DD/MM/AAAA. NUNCA calcule ou adivinhe o ano de nenhuma outra forma, mesmo que pareca fazer sentido - use SEMPRE o que voce transcreveu em "ano_bruto_do_saldo". Responda "desconhecido" so se nao conseguir achar nenhuma referencia de ano na pagina)
}
IMPORTANTE: se essa pagina NAO tiver nenhuma tabela de transacoes reais (por exemplo, e uma pagina de contato, telefone de atendimento, SAC, Ouvidoria, capa, ou texto institucional/propaganda), responda com um array VAZIO: []. NUNCA invente uma transacao a partir de texto que nao seja uma linha real de extrato - nao crie valores como R$0,00 ou transacoes ficticias.
Responda APENAS com um JSON valido (um array), sem nenhum texto antes ou depois.`;
}

function getExtractionPromptTexto() {
  const hoje = new Date();
  const hojeStr = String(hoje.getDate()).padStart(2, '0') + '/' + String(hoje.getMonth() + 1).padStart(2, '0') + '/' + hoje.getFullYear();
  const ontem = new Date(hoje);
  ontem.setDate(ontem.getDate() - 1);
  const ontemStr = String(ontem.getDate()).padStart(2, '0') + '/' + String(ontem.getMonth() + 1).padStart(2, '0') + '/' + ontem.getFullYear();

  return `Você recebe uma frase falada (transcrita por voz) ou digitada por um usuário brasileiro descrevendo UMA transação financeira que ele fez ou recebeu, ex: "gastei 40 reais no posto de gasolina", "recebi 200 de pix do Fernando", "paguei 30 de comida ontem".
A data de HOJE é ${hojeStr}. Se a frase não mencionar quando foi, use ${hojeStr}. Se disser "ontem", use ${ontemStr}.
Responda APENAS com um JSON válido, sem nenhum texto antes ou depois: um ARRAY com um item, no formato:
{
  "valor": (número, ex: 40.00 - extraia o valor mencionado),
  "tipo": ("entrada" se a pessoa RECEBEU o dinheiro, "saida" se ela GASTOU/PAGOU/ENVIOU. Palavras como "gastei", "paguei", "comprei" = saida; "recebi", "ganhei", "me pagaram" = entrada),
  "categoria": (categoria curta inferida do contexto, ex: "Transporte", "Combustível", "Comida na rua", "Mercado", "Lazer", "Salário", "Transferência entre contas", "Outros"),
  "instituicao": (nome do banco/fintech mencionado pela pessoa, transcrito exatamente como ela falou (ex: se disser "pelo banco X", responda "banco X"). Se não for mencionado, "desconhecido"),
  "local": (nome do estabelecimento/pessoa mencionado, ou "desconhecido" se não foi dito),
  "forma_pagamento": (se a pessoa mencionar a forma de pagamento, use EXATAMENTE um destes valores: "debito", "credito", "pix", "especie" (dinheiro/espécie). Ex: "no crédito"/"no cartão de crédito" = "credito"; "no débito" = "debito"; "de pix"/"por pix" = "pix"; "em dinheiro"/"em espécie" = "especie". Se não for mencionado, "desconhecido"),
  "observacao": (se a pessoa mencionar uma nota/categoria pessoal pra essa transação, geralmente no final da frase, ex: "observação combustível", "marca como comida na rua" = "combustível"/"comida na rua". Se não for mencionado, deixe vazio ""),
  "data": (formato EXATO DD/MM/AAAA)
}
Se a frase não descrever nenhuma transação financeira reconhecível (valor + direção do dinheiro), responda com {"erro": "não conseguimos entender essa transação, tente descrever de novo"} (sem array, só esse objeto).`;
}

async function lerTextoTransacao(texto) {
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    temperature: 0,
    messages: [
      { role: 'user', content: [{ type: 'text', text: `${getExtractionPromptTexto()}\n\nFrase do usuário: "${texto}"` }] },
    ],
  }, { timeout: 15000 });

  const textResponse = message.content[0].text.trim();
  const inicioArray = textResponse.indexOf('[');
  const inicioObjeto = textResponse.indexOf('{');
  let bruto = null;
  if (inicioArray !== -1 && (inicioObjeto === -1 || inicioArray < inicioObjeto)) {
    bruto = textResponse.slice(inicioArray, textResponse.lastIndexOf(']') + 1);
  } else if (inicioObjeto !== -1) {
    bruto = textResponse.slice(inicioObjeto, textResponse.lastIndexOf('}') + 1);
  }
  if (!bruto) {
    throw new Error('Não foi possível interpretar a frase');
  }
  const resultado = JSON.parse(bruto);
  return Array.isArray(resultado) ? resultado : [resultado];
}

async function lerComprovante(buffer, mediaType, tipo, dataReferenciaPagina) {
  if (tipo === 'extrato') {
    return chamarIaComPrompt(buffer, mediaType, 'extrato', dataReferenciaPagina);
  }
  // O upload manual (comprovante unico) as vezes recebe uma foto/print de
  // uma TABELA de extrato inteira, nao uma notificacao/comprovante isolado -
  // o prompt de comprovante unico nao reconhece esse formato: ou devolve
  // {"erro": ...}, ou (mais comum na pratica) nem consegue montar um JSON
  // valido e a chamada JOGA UM ERRO. Os dois casos precisam cair pro
  // fallback de tabela de extrato - o cliente nao deveria precisar saber
  // qual botao usar pra cada tipo de imagem.
  let lista;
  try {
    lista = await chamarIaComPrompt(buffer, mediaType, 'comprovante', dataReferenciaPagina);
  } catch (err) {
    lista = [{ erro: mensagemErroAmigavel(err) }];
  }
  const naoReconheceu = lista.length === 1 && lista[0].erro;
  if (naoReconheceu) {
    const listaTabela = await chamarIaComPrompt(buffer, mediaType, 'extrato', null);
    if (listaTabela.length > 0 && !listaTabela[0].erro) {
      return listaTabela;
    }
  }
  return lista;
}

async function chamarIaComPrompt(buffer, mediaType, tipo, dataReferenciaPagina) {
  const base64Data = buffer.toString('base64');
  const isPdf = mediaType === 'application/pdf';
  const conteudo = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } };
  const prompt = tipo === 'extrato' ? getExtractionPromptExtrato(dataReferenciaPagina) : getExtractionPrompt();

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    // As paginas mais densas do extrato (~50 transacoes) com os campos de
    // transcricao (tipo_bruto_da_coluna, ano_bruto_do_saldo) chegam perto de
    // 5000 tokens de resposta - 16000 da folga confortavel sem cortar o JSON
    // no meio (o que virava erro de "nao conseguimos ler essa imagem").
    max_tokens: tipo === 'extrato' ? 16000 : 800,
    // Determinismo: extracao de dados estruturados (valor, tipo, data) nao
    // se beneficia de variacao criativa entre chamadas - reduz o risco de
    // a mesma imagem dar resultados diferentes (ex: entrada/saida trocado)
    // em tentativas diferentes.
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: [
          conteudo,
          { type: 'text', text: prompt },
        ],
      },
    ],
  // Extrato pode gerar ate ~5-6 mil tokens de resposta numa pagina densa -
  // 20s era curto demais e cortava a chamada antes de terminar, virando
  // erro 500 mesmo com tudo certo. Comprovante unico (poucos tokens) nao
  // precisa de tanto, mas usar o mesmo teto maior nao tem custo real.
  }, { timeout: tipo === 'extrato' ? 60000 : 20000 });

  const textResponse = message.content[0].text.trim();

  // A IA responde ou com um array de transacoes, ou (em caso de erro) um objeto
  // solto {"erro": "..."}. Pega o que vier primeiro no texto e normaliza pra
  // sempre devolver uma lista - mesmo um erro vira uma lista de 1 item, pra
  // quem chama nao precisar tratar dois formatos diferentes.
  const inicioArray = textResponse.indexOf('[');
  const inicioObjeto = textResponse.indexOf('{');
  let bruto = null;
  if (inicioArray !== -1 && (inicioObjeto === -1 || inicioArray < inicioObjeto)) {
    bruto = textResponse.slice(inicioArray, textResponse.lastIndexOf(']') + 1);
  } else if (inicioObjeto !== -1) {
    bruto = textResponse.slice(inicioObjeto, textResponse.lastIndexOf('}') + 1);
  }
  if (!bruto) {
    throw new Error('Não foi possível interpretar o comprovante');
  }

  const resultado = JSON.parse(bruto);
  const lista = Array.isArray(resultado) ? resultado : [resultado];
  // tipo_bruto_da_coluna e um campo de raciocinio intermediario (transcricao
  // literal antes de decidir entrada/saida) - nao interessa pro cliente, so
  // ajuda a IA a acertar o campo "tipo" de verdade.
  lista.forEach(item => {
    delete item.tipo_bruto_da_coluna;
    delete item.ano_bruto_do_saldo;
    delete item.titulo_bruto_da_notificacao;
  });
  return lista;
}

// Erros com "status" vem da propria API da Anthropic (indisponibilidade, limite,
// credito) - nao tem nada a ver com a foto que o usuario mandou. So os erros sem
// "status" (ex: resposta que nao deu pra interpretar) sao realmente sobre a imagem.
function mensagemErroAmigavel(err) {
  return err.status
    ? 'Nosso serviço está temporariamente indisponível. Tente novamente em alguns minutos.'
    : 'Não conseguimos ler essa imagem. Tente novamente com uma foto mais nítida.';
}

app.post('/api/parse-receipt', limiteApiIA, exigirSegredoApp, upload.single('receipt'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ erro: 'Nenhuma imagem enviada' });
  }
  try {
    const transacoes = await lerComprovante(req.file.buffer, req.file.mimetype, req.body.tipo, req.body.dataReferenciaPagina);
    res.json({ transacoes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: mensagemErroAmigavel(err) });
  }
});

// Comando de voz (ou texto digitado) - mesma ideia do parse-receipt, so que
// pra frase falada/transcrita em vez de imagem. Usado tanto pelo microfone
// no navegador (Android/desktop) quanto pelo Atalho do iOS (dita e manda
// pra ca via ?voz=).
app.post('/api/parse-texto', limiteApiIA, async (req, res) => {
  const texto = (req.body && req.body.texto || '').trim();
  if (!texto) {
    return res.status(400).json({ erro: 'Nenhum texto enviado' });
  }
  try {
    const transacoes = await lerTextoTransacao(texto);
    res.json({ transacoes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: mensagemErroAmigavel(err) });
  }
});

// Recebe o compartilhamento nativo do celular (menu "Compartilhar" do Android via PWA).
// So redireciona pra "/?compartilhado=..." - quem realmente adiciona as
// transacoes (e pergunta a data quando a IA nao reconhece) e o mesmo codigo
// cliente usado pelo Atalho do iOS e, indiretamente, pelo upload manual.
app.post('/share-target', limiteApiIA, upload.single('receipt'), async (req, res) => {
  let transacoes = null;
  let erro = null;

  if (!req.file) {
    erro = 'Nenhuma imagem recebida no compartilhamento';
  } else {
    try {
      transacoes = await lerComprovante(req.file.buffer, req.file.mimetype);
    } catch (err) {
      console.error(err);
      erro = mensagemErroAmigavel(err);
    }
  }

  const falhou = erro || (transacoes && transacoes[0] && transacoes[0].erro);
  const mensagemErro = erro || (transacoes && transacoes[0] && transacoes[0].erro) || '';

  if (!falhou) {
    const encoded = encodeURIComponent(JSON.stringify(transacoes));
    return res.redirect(`/?compartilhado=${encoded}`);
  }

  res.send(`<!DOCTYPE html>
<html><body style="background:#000919;color:#e6f4fe;font-family:sans-serif;text-align:center;padding-top:35vh;padding-left:24px;padding-right:24px;">
<p>❌ Erro: ${mensagemErro}</p>
<p><a href="/" style="color:#4ab8fd;">Voltar ao app</a></p>
</body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Controle de Gastos rodando em http://localhost:${PORT}`);
});
