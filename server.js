require('dotenv').config();
const express = require('express');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.static('public', {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache, must-revalidate'),
}));

function getExtractionPrompt() {
  const hoje = new Date();
  const hojeStr = String(hoje.getDate()).padStart(2, '0') + '/' + String(hoje.getMonth() + 1).padStart(2, '0') + '/' + hoje.getFullYear();
  const ontem = new Date(hoje);
  ontem.setDate(ontem.getDate() - 1);
  const ontemStr = String(ontem.getDate()).padStart(2, '0') + '/' + String(ontem.getMonth() + 1).padStart(2, '0') + '/' + ontem.getFullYear();

  return `Você recebe a imagem de um comprovante/notificação de transação bancária brasileira (Pix, transferência, débito ou crédito). A imagem pode conter UMA ou VÁRIAS transações (por exemplo, duas ou mais notificações de banco empilhadas na mesma captura de tela).
A data de HOJE é ${hojeStr}. Se o comprovante mostrar uma data relativa como "Hoje", use ${hojeStr}. Se mostrar "Ontem", use ${ontemStr}. Se mostrar dia da semana + dia do mês sem ano (ex: "Segunda-feira, 13 de julho"), calcule o ano correto usando ${hojeStr} como referência de hoje.
Extraia TODAS as transações visíveis na imagem e responda APENAS com um JSON válido, sem nenhum texto antes ou depois: um ARRAY, mesmo que exista só uma transação. Cada item do array no formato:
{
  "valor": (número, ex: 150.50),
  "tipo": ("entrada" se o dinheiro foi RECEBIDO/creditado na conta do usuário, "saida" se foi ENVIADO/debitado da conta do usuário. Preste atenção especial: textos como "você recebeu", "Pix recebido", "creditado", ou valores em VERDE geralmente indicam entrada; textos como "você enviou", "Pix enviado", "pagamento", "debitado", ou valores em VERMELHO/CINZA geralmente indicam saída. Não confunda o nome de quem aparece no comprovante com a direção — o importante é se o dinheiro ENTROU ou SAIU da conta de quem é dono do comprovante),
  "categoria": (categoria da transação, inferida do nome do estabelecimento/recebedor e contexto; use uma categoria curta e específica, ex: "Transporte", "Padaria", "Comida na rua", "Mercado", "Farmácia/Saúde", "Lazer", "Assinaturas", "Contas/Serviços", "Salário", "Cliente/Serviço prestado", "Transferência entre contas", "Outros"),
  "instituicao": (nome do banco/fintech, ou "desconhecido" se não identificar),
  "local": (nome do recebedor/pagador ou estabelecimento, ou "desconhecido"),
  "data": (data da transação no formato EXATO DD/MM/AAAA — sempre com barras, sempre com o ano de 4 digitos, nunca por extenso, ou "desconhecido" se realmente não der pra determinar)
}
Se não conseguir identificar algum campo de uma transação, use "desconhecido" nesse campo. Se a imagem não tiver nenhuma transação bancária reconhecível, responda com {"erro": "imagem não reconhecida como comprovante"} (sem array, só esse objeto).`;
}

function getExtractionPromptExtrato() {
  const hoje = new Date();
  const hojeStr = String(hoje.getDate()).padStart(2, '0') + '/' + String(hoje.getMonth() + 1).padStart(2, '0') + '/' + hoje.getFullYear();

  return `Voce recebe a imagem de UMA PAGINA de um extrato bancario brasileiro completo (varias paginas no total). Essa pagina especifica pode conter uma TABELA com varias linhas de transacoes (colunas como data, tipo, descricao, valor), ou pode nao conter nenhuma transacao (ex: capa, pagina de contato/atendimento ao cliente, SAC, Ouvidoria, aviso legal, propaganda do banco).
A data de HOJE e ${hojeStr}.
Se a pagina tiver uma tabela de transacoes, extraia TODAS as linhas da tabela, uma por item do array, no formato:
{
  "valor": (numero, ex: 150.50),
  "tipo": (a propria tabela do extrato tem uma coluna "Tipo" por linha - USE ESSA COLUNA como fonte principal, nao adivinhe pela descricao. Se a coluna "Tipo" da linha disser "Entrada PIX" ou "Pix recebido" = entrada. Se disser "Saida PIX", "Debito de Cartao" ou "Pagamento" = saida. So se a coluna Tipo nao estiver visivel nessa linha, ai sim use a descricao como pista: "recebido"/"recebido de" = entrada; "enviado para"/"enviado" = saida - preste atencao que "enviado para X" significa que o dinheiro SAIU da conta, independente do nome que aparece),
  "categoria": (categoria curta inferida do estabelecimento/descricao, ex: "Transporte", "Mercado", "Combustivel", "Salario", "Transferencia entre contas", "Outros"),
  "instituicao": (nome do banco, ou "desconhecido"),
  "local": (nome do estabelecimento/recebedor/pagador exatamente como aparece na linha, ou "desconhecido"),
  "data": (data da transacao no formato EXATO DD/MM/AAAA, ou "desconhecido" se nao der pra determinar)
}
IMPORTANTE: se essa pagina NAO tiver nenhuma tabela de transacoes reais (por exemplo, e uma pagina de contato, telefone de atendimento, SAC, Ouvidoria, capa, ou texto institucional/propaganda), responda com um array VAZIO: []. NUNCA invente uma transacao a partir de texto que nao seja uma linha real de extrato - nao crie valores como R$0,00 ou transacoes ficticias.
Responda APENAS com um JSON valido (um array), sem nenhum texto antes ou depois.`;
}

async function lerComprovante(buffer, mediaType, tipo) {
  const base64Data = buffer.toString('base64');
  const isPdf = mediaType === 'application/pdf';
  const conteudo = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } };
  const prompt = tipo === 'extrato' ? getExtractionPromptExtrato() : getExtractionPrompt();

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: tipo === 'extrato' ? 4000 : 800,
    messages: [
      {
        role: 'user',
        content: [
          conteudo,
          { type: 'text', text: prompt },
        ],
      },
    ],
  }, { timeout: 20000 });

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
  return Array.isArray(resultado) ? resultado : [resultado];
}

// Erros com "status" vem da propria API da Anthropic (indisponibilidade, limite,
// credito) - nao tem nada a ver com a foto que o usuario mandou. So os erros sem
// "status" (ex: resposta que nao deu pra interpretar) sao realmente sobre a imagem.
function mensagemErroAmigavel(err) {
  return err.status
    ? 'Nosso serviço está temporariamente indisponível. Tente novamente em alguns minutos.'
    : 'Não conseguimos ler essa imagem. Tente novamente com uma foto mais nítida.';
}

app.post('/api/parse-receipt', upload.single('receipt'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ erro: 'Nenhuma imagem enviada' });
  }
  try {
    const transacoes = await lerComprovante(req.file.buffer, req.file.mimetype, req.body.tipo);
    res.json({ transacoes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: mensagemErroAmigavel(err) });
  }
});

// Recebe o compartilhamento nativo do celular (menu "Compartilhar" do Android/iOS via PWA)
app.post('/share-target', upload.single('receipt'), async (req, res) => {
  let dadosJson = 'null';
  let erro = null;

  if (!req.file) {
    erro = 'Nenhuma imagem recebida no compartilhamento';
  } else {
    try {
      const transacoes = await lerComprovante(req.file.buffer, req.file.mimetype);
      dadosJson = JSON.stringify(transacoes);
    } catch (err) {
      console.error(err);
      erro = mensagemErroAmigavel(err);
    }
  }

  const transacoes = JSON.parse(dadosJson);
  const falhou = erro || (transacoes && transacoes[0] && transacoes[0].erro);
  const mensagemErro = erro || (transacoes && transacoes[0] && transacoes[0].erro) || '';

  res.send(`<!DOCTYPE html>
<html><body style="background:#000919;color:#e6f4fe;font-family:sans-serif;text-align:center;padding-top:35vh;padding-left:24px;padding-right:24px;">
<p>${falhou ? '❌ Erro: ' + mensagemErro : '✅ Processando comprovante...'}</p>
${falhou ? '<p><a href="/" style="color:#4ab8fd;">Voltar ao app</a></p>' : ''}
<script>
  const STORAGE_KEY = 'controle_gastos_transacoes';
  const USO_MENSAL_KEY = 'controle_gastos_uso_mensal';
  const transacoes = ${dadosJson};
  if (transacoes && transacoes.length && !transacoes[0].erro) {
    const raw = localStorage.getItem(STORAGE_KEY);
    const lista = raw ? JSON.parse(raw) : [];
    transacoes.forEach((dados, i) => {
      lista.unshift({ ...dados, id: Date.now() + i });
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lista));

    // Compartilhamento nativo ja chega processado pelo servidor (o custo da IA
    // ja aconteceu), entao aqui so contabiliza pro limite mensal - nao da pra
    // bloquear antes, diferente do upload manual, que checa antes de enviar.
    // Conta 1 por IMAGEM processada, nao por transacao encontrada dentro dela -
    // e o que reflete o custo real (uma chamada de API, nao uma por transacao).
    const hoje = new Date();
    const mesAtual = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0');
    const usoRaw = localStorage.getItem(USO_MENSAL_KEY);
    const uso = (usoRaw && JSON.parse(usoRaw).mes === mesAtual) ? JSON.parse(usoRaw) : { mes: mesAtual, contagem: 0 };
    uso.contagem += 1;
    localStorage.setItem(USO_MENSAL_KEY, JSON.stringify(uso));

    window.location.replace('/');
  }
  // Em caso de erro, NAO redireciona sozinho - fica na tela mostrando o erro,
  // pra usuario conseguir ler (antes disso, o redirect imediato escondia
  // qualquer mensagem de erro, dando a impressao de falha silenciosa).
</script>
</body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Controle de Gastos rodando em http://localhost:${PORT}`);
});
