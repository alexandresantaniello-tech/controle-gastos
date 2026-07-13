require('dotenv').config();
const express = require('express');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.static('public'));

const EXTRACTION_PROMPT = `Você recebe a imagem de um comprovante de transação bancária brasileira (Pix, transferência, débito ou crédito).
Extraia as informações e responda APENAS com um JSON válido, sem nenhum texto antes ou depois, no formato:
{
  "valor": (número, ex: 150.50),
  "tipo": ("entrada" ou "saida"),
  "instituicao": (nome do banco/fintech, ou "desconhecido" se não identificar),
  "local": (nome do recebedor/pagador ou estabelecimento, ou "desconhecido"),
  "data": (data da transação no formato DD/MM/AAAA, ou "desconhecido")
}
Se não conseguir identificar algum campo, use "desconhecido". Se a imagem não for um comprovante bancário, responda com {"erro": "imagem não reconhecida como comprovante"}.`;

async function lerComprovante(buffer, mediaType) {
  const base64Data = buffer.toString('base64');
  const isPdf = mediaType === 'application/pdf';
  const conteudo = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } };

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: [
          conteudo,
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      },
    ],
  });

  const textResponse = message.content[0].text.trim();
  const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Não foi possível interpretar o comprovante');
  }
  return JSON.parse(jsonMatch[0]);
}

// Recebe o compartilhamento nativo do celular (menu "Compartilhar" do Android/iOS via PWA)
app.post('/share-target', upload.single('receipt'), async (req, res) => {
  let dadosJson = 'null';
  let erro = null;

  if (!req.file) {
    erro = 'Nenhuma imagem recebida no compartilhamento';
  } else {
    try {
      const dados = await lerComprovante(req.file.buffer, req.file.mimetype);
      dadosJson = JSON.stringify(dados);
    } catch (err) {
      console.error(err);
      erro = 'Falha ao processar o comprovante compartilhado';
    }
  }

  res.send(`<!DOCTYPE html>
<html><body style="background:#0f1115;color:#e8e8ea;font-family:sans-serif;text-align:center;padding-top:40vh;">
<p>${erro ? 'Erro: ' + erro : 'Processando comprovante...'}</p>
<script>
  const STORAGE_KEY = 'controle_gastos_transacoes';
  const dados = ${dadosJson};
  if (dados && !dados.erro) {
    const raw = localStorage.getItem(STORAGE_KEY);
    const lista = raw ? JSON.parse(raw) : [];
    lista.unshift({ ...dados, id: Date.now() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lista));
  }
  window.location.replace('/');
</script>
</body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Controle de Gastos rodando em http://localhost:${PORT}`);
});
