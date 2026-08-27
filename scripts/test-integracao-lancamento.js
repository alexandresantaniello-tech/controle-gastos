const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Module = require('node:module');

const rotas = [];
const dadosRedis = new Map();
const setsRedis = new Map();
let pagamentoAtual = null;
let cobrancasCriadas = 0;

const redis = {
  async get(chave) { return dadosRedis.has(chave) ? dadosRedis.get(chave) : null; },
  async set(chave, valor, opcoes) {
    if (opcoes && opcoes.nx && dadosRedis.has(chave)) return null;
    dadosRedis.set(chave, valor);
    return 'OK';
  },
  async del(chave) { return dadosRedis.delete(chave) ? 1 : 0; },
  async sadd(chave, valor) {
    if (!setsRedis.has(chave)) setsRedis.set(chave, new Set());
    setsRedis.get(chave).add(valor);
    return 1;
  },
  async smembers(chave) { return [...(setsRedis.get(chave) || [])]; },
};

function middlewarePassagem(req, res, next) { next(); }

function expressMock() {
  return {
    set() {},
    use() {},
    listen() {},
    post(caminho, ...handlers) { rotas.push({ metodo: 'POST', caminho, handlers }); },
    get(caminho, ...handlers) { rotas.push({ metodo: 'GET', caminho, handlers }); },
  };
}
expressMock.static = () => middlewarePassagem;
expressMock.json = () => middlewarePassagem;

function multerMock() {
  return { single: () => middlewarePassagem };
}
multerMock.memoryStorage = () => ({});

class AnthropicMock {
  constructor() {
    this.messages = {
      create: async () => ({ content: [{ text: '[{"valor":10,"tipo":"saida"}]' }] }),
    };
  }
}

class PaymentMock {
  async create() {
    cobrancasCriadas += 1;
    return {
      id: 'pix-novo',
      point_of_interaction: { transaction_data: { qr_code_base64: 'qr', qr_code: 'copia-e-cola' } },
    };
  }
  async get() { return pagamentoAtual; }
}

class PaymentRefundMock {
  async create() { return { id: 'reembolso' }; }
}

const modulosMock = {
  express: expressMock,
  multer: multerMock,
  '@anthropic-ai/sdk': AnthropicMock,
  'express-rate-limit': () => middlewarePassagem,
  mercadopago: {
    MercadoPagoConfig: class MercadoPagoConfigMock {},
    Payment: PaymentMock,
    PaymentRefund: PaymentRefundMock,
  },
  '@upstash/redis': { Redis: { fromEnv: () => redis } },
};

const carregarOriginal = Module._load;
Module._load = function carregarComMocks(pedido, pai, principal) {
  if (Object.prototype.hasOwnProperty.call(modulosMock, pedido)) return modulosMock[pedido];
  return carregarOriginal.call(this, pedido, pai, principal);
};

process.env.ANTHROPIC_API_KEY = 'teste';
process.env.MP_ACCESS_TOKEN = 'teste';
process.env.MP_WEBHOOK_SECRET = 'segredo-webhook';
process.env.RESEND_API_KEY = 'teste';
process.env.RESEND_FROM = 'Sifia <teste@sifiaapp.com>';

const setIntervalOriginal = global.setInterval;
const fetchOriginal = global.fetch;
global.setInterval = () => 0;
global.fetch = async () => ({ ok: true, status: 200, text: async () => '' });

require('../server');

Module._load = carregarOriginal;
global.setInterval = setIntervalOriginal;

function encontrarRota(metodo, caminho) {
  const rota = rotas.find(item => item.metodo === metodo && item.caminho === caminho);
  assert.ok(rota, `Rota não encontrada: ${metodo} ${caminho}`);
  return rota;
}

function respostaMock() {
  return {
    statusCode: 200,
    corpo: undefined,
    cookies: [],
    status(codigo) { this.statusCode = codigo; return this; },
    json(corpo) { this.corpo = corpo; return this; },
    send(corpo) { this.corpo = corpo; return this; },
    sendStatus(codigo) { this.statusCode = codigo; this.corpo = codigo; return this; },
    cookie(nome, valor, opcoes) { this.cookies.push({ nome, valor, opcoes }); return this; },
    clearCookie(nome, opcoes) { this.cookies.push({ nome, removido: true, opcoes }); return this; },
  };
}

async function executarHandlers(handlers, req, res) {
  async function executar(indice) {
    if (indice >= handlers.length) return;
    let proxima = null;
    await handlers[indice](req, res, () => { proxima = executar(indice + 1); });
    if (proxima) await proxima;
  }
  await executar(0);
}

function assinaturaWebhook(paymentId, requestId, ts) {
  const manifesto = `id:${paymentId};request-id:${requestId};ts:${ts};`;
  return crypto.createHmac('sha256', process.env.MP_WEBHOOK_SECRET).update(manifesto).digest('hex');
}

function requisicaoWebhook(paymentId, status, chave, sufixo = '') {
  pagamentoAtual = { id: paymentId, status, external_reference: chave };
  const requestId = `req-${paymentId}${sufixo}`;
  const ts = '1700000000';
  return {
    query: { type: 'payment', 'data.id': paymentId },
    body: {},
    headers: {
      'x-request-id': requestId,
      'x-signature': `ts=${ts},v1=${assinaturaWebhook(paymentId, requestId, ts)}`,
    },
  };
}

async function testarLicencaNasChamadasDeIA() {
  const rota = encontrarRota('POST', '/api/parse-texto');
  const chave = 'licenca-teste-ia';
  await redis.set(`licenca:${chave}`, { email: 'teste@sifiaapp.com', ativa: false });

  let res = respostaMock();
  await executarHandlers(rota.handlers, {
    headers: { 'x-license-key': chave },
    body: { texto: 'gastei 10 reais' },
  }, res);
  assert.equal(res.statusCode, 402, 'licença inativa não pode chamar IA');

  await redis.set(`licenca:${chave}`, { email: 'teste@sifiaapp.com', ativa: true });
  res = respostaMock();
  await executarHandlers(rota.handlers, {
    headers: { 'x-license-key': chave },
    body: { texto: 'gastei 10 reais' },
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.corpo.transacoes[0].valor, 10);
}

async function testarWebhookIdempotente() {
  const rota = encontrarRota('POST', '/api/webhook/mercadopago');
  const chave = 'licenca-webhook';
  await redis.set(`licenca:${chave}`, {
    email: 'pagamento@sifiaapp.com',
    ativa: false,
    proximoPagamentoEm: null,
    atualizadoEm: new Date(0).toISOString(),
  });
  await redis.sadd('licencas:todas', chave);

  pagamentoAtual = { id: 'pagamento-1', status: 'approved', external_reference: chave };
  const requestId = 'req-1';
  const ts = '1700000000';
  const req = {
    query: { type: 'payment', 'data.id': pagamentoAtual.id },
    body: {},
    headers: {
      'x-request-id': requestId,
      'x-signature': `ts=${ts},v1=${assinaturaWebhook(pagamentoAtual.id, requestId, ts)}`,
    },
  };

  let res = respostaMock();
  await executarHandlers(rota.handlers, req, res);
  assert.equal(res.statusCode, 200);
  const primeiraData = (await redis.get(`licenca:${chave}`)).proximoPagamentoEm;

  res = respostaMock();
  await executarHandlers(rota.handlers, req, res);
  assert.equal(res.statusCode, 200);
  assert.equal((await redis.get(`licenca:${chave}`)).proximoPagamentoEm, primeiraData,
    'webhook repetido não pode acrescentar outro mês');
}

async function testarRecuperacaoPriorizaAtiva() {
  const rota = encontrarRota('POST', '/api/licenca/recuperar');
  const email = 'recuperar@sifiaapp.com';
  await redis.set('licenca:ativa-antiga', {
    email, ativa: true, atualizadoEm: '2026-01-01T00:00:00.000Z',
  });
  await redis.set('licenca:pix-inativo-novo', {
    email, ativa: false, atualizadoEm: '2026-08-01T00:00:00.000Z',
  });
  await redis.sadd('licencas:todas', 'ativa-antiga');
  await redis.sadd('licencas:todas', 'pix-inativo-novo');

  const res = respostaMock();
  await executarHandlers(rota.handlers, { headers: {}, body: { email } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.corpo.token);
  const tentativa = await redis.get(`recuperacao:${res.corpo.token}`);
  assert.equal(tentativa.chave, 'ativa-antiga');
}

async function testarEstadosQueMantemOuCortamAcesso() {
  const rota = encontrarRota('POST', '/api/webhook/mercadopago');
  const chave = 'licenca-estados';
  const vencimento = '2026-09-15T12:00:00.000Z';
  await redis.set(`licenca:${chave}`, {
    email: 'estados@sifiaapp.com',
    ativa: true,
    proximoPagamentoEm: vencimento,
    atualizadoEm: new Date(0).toISOString(),
  });

  let res = respostaMock();
  await executarHandlers(rota.handlers, requisicaoWebhook('pag-rejeitado', 'rejected', chave), res);
  let registro = await redis.get(`licenca:${chave}`);
  assert.equal(registro.ativa, true, 'rejected não pode cortar período anterior já pago');
  assert.equal(registro.proximoPagamentoEm, vencimento);

  res = respostaMock();
  await executarHandlers(rota.handlers, requisicaoWebhook('pag-estornado', 'refunded', chave), res);
  registro = await redis.get(`licenca:${chave}`);
  assert.equal(registro.ativa, false, 'refunded deve desativar a licença');
}

async function testarAprovacaoSimultaneaPedeRetry() {
  const rota = encontrarRota('POST', '/api/webhook/mercadopago');
  const chave = 'licenca-concorrente';
  const vencimento = '2026-09-20T12:00:00.000Z';
  const paymentId = 'pag-concorrente';
  await redis.set(`licenca:${chave}`, {
    email: 'concorrente@sifiaapp.com',
    ativa: true,
    proximoPagamentoEm: vencimento,
    atualizadoEm: new Date(0).toISOString(),
  });
  await redis.set(`pagamento:aprovacao-processada:${paymentId}`, 'processando');

  const res = respostaMock();
  await executarHandlers(rota.handlers, requisicaoWebhook(paymentId, 'approved', chave), res);
  assert.equal(res.statusCode, 500, 'entrega concorrente deve pedir retry');
  assert.equal((await redis.get(`licenca:${chave}`)).proximoPagamentoEm, vencimento,
    'entrega concorrente não pode conceder ciclo adicional');
}

async function testarEmailInvalidoNaoCriaCobranca() {
  const rota = encontrarRota('POST', '/api/assinar');
  const antes = cobrancasCriadas;
  const res = respostaMock();
  await executarHandlers(rota.handlers, { headers: {}, body: { email: 'email-invalido' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(cobrancasCriadas, antes);
}

(async () => {
  await testarLicencaNasChamadasDeIA();
  console.log('OK licença ativa/inativa nas chamadas de IA');
  await testarWebhookIdempotente();
  console.log('OK webhook aprovado repetido é idempotente');
  await testarRecuperacaoPriorizaAtiva();
  console.log('OK recuperação prioriza assinatura ativa');
  await testarEstadosQueMantemOuCortamAcesso();
  console.log('OK rejected mantém acesso e refunded desativa');
  await testarAprovacaoSimultaneaPedeRetry();
  console.log('OK aprovação simultânea pede retry sem conceder ciclo');
  await testarEmailInvalidoNaoCriaCobranca();
  console.log('OK e-mail inválido não cria cobrança');
  global.fetch = fetchOriginal;
})().catch(err => {
  global.fetch = fetchOriginal;
  console.error(err);
  process.exitCode = 1;
});
