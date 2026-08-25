const fs = require('fs');

let server = fs.readFileSync('server.js', 'utf8');
const inicio = server.indexOf('// Recupera a chave de licenca em um aparelho novo');
const fim = server.indexOf('// O app consulta isso periodicamente pra saber se libera os recursos pagos.', inicio);
if (inicio < 0 || fim < 0) throw new Error('Bloco de recuperação do server.js não encontrado');

const novoBackend = `// Recuperacao segura em aparelho novo: conhecer apenas o e-mail nao libera mais
// a chave. Primeiro enviamos um codigo de uso unico pelo Resend; somente depois
// de provar acesso a caixa de e-mail a chave de licenca e devolvida.
const RECUPERACAO_TTL_SEGUNDOS = 10 * 60;
const RECUPERACAO_MAX_TENTATIVAS = 5;

function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashCodigoRecuperacao(email, codigo) {
  return crypto.createHash('sha256').update(email + ':' + codigo).digest('hex');
}

async function encontrarLicencaMaisRecentePorEmail(email) {
  const chaves = await todasAsChavesDeLicenca();
  let encontrada = null;
  for (const chave of chaves) {
    const registro = await buscarLicenca(chave);
    if (registro && normalizarEmail(registro.email) === email) {
      if (!encontrada || new Date(registro.atualizadoEm || 0) > new Date(encontrada.atualizadoEm || 0)) encontrada = { chave, ...registro };
    }
  }
  return encontrada;
}

async function enviarCodigoRecuperacao(email, codigo) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY ausente');
  const remetente = process.env.RESEND_FROM || 'Sifia <noreply@sifiaapp.com>';
  const resposta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: remetente,
      to: [email],
      subject: 'Seu código de acesso ao Sifia',
      text: 'Seu código de acesso ao Sifia é ' + codigo + '. Ele expira em 10 minutos. Se você não pediu este código, ignore este e-mail.',
      html: '<div style="font-family:Arial,sans-serif;color:#0b172a"><h2>Sifia</h2><p>Seu código de acesso é:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">' + codigo + '</p><p>Ele expira em 10 minutos.</p><p>Se você não pediu este código, ignore este e-mail.</p></div>',
    }),
  });
  if (!resposta.ok) throw new Error('Resend recusou o envio: ' + resposta.status + ' ' + await resposta.text());
}

app.post('/api/licenca/recuperar', limiteApiIA, async (req, res) => {
  const email = normalizarEmail(req.body && req.body.email);
  if (!email || !email.includes('@')) return res.status(400).json({ erro: 'E-mail inválido' });
  try {
    const encontrada = await encontrarLicencaMaisRecentePorEmail(email);
    if (!encontrada) return res.json({ codigoEnviado: true });
    const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const token = crypto.randomBytes(24).toString('hex');
    await redis.set('recuperacao:' + token, { email, chave: encontrada.chave, codigoHash: hashCodigoRecuperacao(email, codigo), tentativas: 0 }, { ex: RECUPERACAO_TTL_SEGUNDOS });
    await enviarCodigoRecuperacao(email, codigo);
    res.json({ codigoEnviado: true, token });
  } catch (err) {
    console.error('Falha ao iniciar recuperação', err);
    res.status(500).json({ erro: 'Não foi possível enviar o código agora. Tente novamente em instantes.' });
  }
});

app.post('/api/licenca/confirmar-recuperacao', limiteApiIA, async (req, res) => {
  const token = String(req.body && req.body.token || '').trim();
  const codigo = String(req.body && req.body.codigo || '').trim();
  if (!token || !/^\\d{6}$/.test(codigo)) return res.status(400).json({ erro: 'Código inválido.' });
  const redisKey = 'recuperacao:' + token;
  const tentativa = await redis.get(redisKey);
  if (!tentativa) return res.status(400).json({ erro: 'Código expirado. Solicite um novo.' });
  if ((tentativa.tentativas || 0) >= RECUPERACAO_MAX_TENTATIVAS) {
    await redis.del(redisKey);
    return res.status(429).json({ erro: 'Muitas tentativas. Solicite um novo código.' });
  }
  const recebido = Buffer.from(hashCodigoRecuperacao(tentativa.email, codigo), 'hex');
  const esperado = Buffer.from(tentativa.codigoHash, 'hex');
  const valido = recebido.length === esperado.length && crypto.timingSafeEqual(recebido, esperado);
  if (!valido) {
    tentativa.tentativas = (tentativa.tentativas || 0) + 1;
    await redis.set(redisKey, tentativa, { ex: RECUPERACAO_TTL_SEGUNDOS });
    return res.status(400).json({ erro: 'Código incorreto.' });
  }
  await redis.del(redisKey);
  const registro = await buscarLicenca(tentativa.chave);
  if (!registro) return res.status(404).json({ erro: 'Assinatura não encontrada.' });
  res.json({ chaveDeLicenca: tentativa.chave, ativa: !!registro.ativa });
});

`;
server = server.slice(0, inicio) + novoBackend + server.slice(fim);
fs.writeFileSync('server.js', server);

let html = fs.readFileSync('public/index.html', 'utf8');
const inicioFront = html.indexOf('async function tentarRecuperarPorEmail(email) {');
const fimFront = html.indexOf('async function recuperarAssinaturaComPrompt(event) {', inicioFront);
if (inicioFront < 0 || fimFront < 0) throw new Error('Função tentarRecuperarPorEmail não encontrada');
const novoFront = `async function tentarRecuperarPorEmail(email) {
  const statusEl = document.getElementById('statusPaywall2').offsetParent ? document.getElementById('statusPaywall2') : document.getElementById('statusPaywall');
  statusEl.textContent = 'Enviando código para seu e-mail...';
  try {
    const resp = await fetch('/api/licenca/recuperar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const dados = await resp.json();
    if (!resp.ok) throw new Error(dados.erro || 'Não foi possível enviar o código.');
    statusEl.textContent = 'Se existir uma assinatura com esse e-mail, enviamos um código de 6 dígitos.';
    if (!dados.token) return;
    const codigo = await modalPrompt('Digite o código de 6 dígitos enviado para seu e-mail:', '');
    if (!codigo) return;
    statusEl.textContent = 'Confirmando código...';
    const confirmar = await fetch('/api/licenca/confirmar-recuperacao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: dados.token, codigo: codigo.trim() }) });
    const confirmacao = await confirmar.json();
    if (!confirmar.ok) throw new Error(confirmacao.erro || 'Código inválido.');
    localStorage.setItem(CHAVE_LICENCA_KEY, confirmacao.chaveDeLicenca);
    localStorage.setItem(EMAIL_LICENCA_KEY, email);
    statusEl.textContent = 'E-mail confirmado. Assinatura recuperada!';
    location.reload();
  } catch (err) {
    statusEl.textContent = err.message || 'Não foi possível recuperar a assinatura agora.';
  }
}

`;
html = html.slice(0, inicioFront) + novoFront + html.slice(fimFront);
fs.writeFileSync('public/index.html', html);
console.log('Recuperação segura aplicada em server.js e public/index.html');
