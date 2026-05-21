'use strict';

const { dashboardPage } = require('./dashboard-page');
const { dashboardAuthorized, tokenMatches, webhookRequestToken } = require('./security');

function registerRoutes({
  app,
  botService,
  config,
  messageDedupe,
  safeLog,
  sendMessage,
  sessionStore,
  webhookParser,
}) {
  const { getSession } = sessionStore;
  const {
    getMediaInfo,
    getMessageId,
    getPhoneCandidatesFromWebhook,
    getPhoneFromWebhook,
    getTextFromWebhook,
    isFromMeWebhook,
    isGroupWebhook,
    isSupportedMessageEvent,
  } = webhookParser;
  const { logPhoneCandidates, logText, maskPhone } = safeLog;

  // ─── WEBHOOK ──────────────────────────────────────────────
  app.post('/webhook', async (req, res) => {
    if (config.webhookToken && !tokenMatches(config.webhookToken, webhookRequestToken(req))) {
      console.warn('⚠️ Webhook recusado: token ausente ou inválido.');
      return res.status(401).json({ ok: false, error: 'Webhook não autorizado.' });
    }

    res.sendStatus(200);

    try {
      const body = req.body || {};

      console.log('🔔 Webhook recebido:', JSON.stringify({
        event: body.event,
        type: body.type,
        hasData: Boolean(body.data),
        hasMessage: Boolean(body.data?.message || body.message),
      }).slice(0, 500));

      if (!isSupportedMessageEvent(body)) {
        console.log('ℹ️ Evento ignorado:', body.event);
        return;
      }

      if (isFromMeWebhook(body)) {
        console.log('ℹ️ Mensagem ignorada: fromMe');
        return;
      }

      if (isGroupWebhook(body)) {
        console.log('ℹ️ Mensagem ignorada: grupo');
        return;
      }

      // Esse filtro é somente para Z-API.
      // Se deixar ativo para Evolution, alguns payloads podem ser ignorados.
      if (config.whatsappProvider !== 'evolution' && body.type && body.type !== 'ReceivedCallback') {
        console.log('ℹ️ Tipo Z-API ignorado:', body.type);
        return;
      }

      const phone = getPhoneFromWebhook(body);
      const texto = getTextFromWebhook(body);
      const messageId = getMessageId(body);
      const mediaInfo = getMediaInfo(body);

      console.log('🔎 Dados extraídos:', JSON.stringify({
        phone: maskPhone(phone),
        texto: logText(texto),
        messageId,
        mediaType: mediaInfo?.type,
        hasBase64: Boolean(mediaInfo?.base64),
        hasMediaUrl: Boolean(mediaInfo?.mediaUrl),
        phoneCandidates: logPhoneCandidates(getPhoneCandidatesFromWebhook(body)),
        fromMe: Boolean((body?.data || body)?.key?.fromMe || body?.fromMe),
        remoteJid: maskPhone(
          (body?.data || body)?.key?.remoteJid || (body?.data || body)?.remoteJid || body?.remoteJid
        ),
        participant: maskPhone((body?.data || body)?.key?.participant),
      }).slice(0, 1500));

      if (!phone) {
        console.log('⚠️ Webhook sem phone.');
        return;
      }

      if (!texto && !mediaInfo?.type) {
        console.log('⚠️ Webhook sem texto/mídia.');
        return;
      }

      if (messageDedupe.isDuplicateMessage(messageId)) {
        console.log('ℹ️ Mensagem duplicada ignorada:', messageId);
        return;
      }

      console.log(`📩 [${maskPhone(phone)}] ${texto ? logText(texto) : `[${mediaInfo.type}]`}`);

      const resposta = await botService.processarMensagem(phone, texto, mediaInfo);

      console.log('🤖 Resposta gerada:', resposta ? logText(resposta, 500) : 'SEM RESPOSTA');

      if (resposta) {
        console.log('📤 Chamando sendMessage...');
        await sendMessage(phone, resposta, messageId);
        console.log('✅ sendMessage finalizado.');
      } else {
        console.log('⚠️ Não enviou porque resposta veio vazia.');
      }
    } catch (err) {
      console.error('Erro no webhook:', err.response?.data || err.message || err);
    }
  });

  // ─── DASHBOARD API ────────────────────────────────────────
  app.get('/api/dashboard', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');

      if (!dashboardAuthorized(req, config.dashboardToken)) {
        return res.status(401).json({
          ok: false,
          error: 'Dashboard não autorizado.',
        });
      }

      const phone = String(req.query.phone || req.query.numero || '').replace(/\D/g, '');

      if (!phone) {
        return res.status(400).json({
          ok: false,
          error: 'Informe o telefone. Ex: ?phone=5541999999999',
        });
      }

      const sessao = await getSession(phone);

      if (!sessao) {
        return res.status(404).json({
          ok: false,
          error: 'Telefone não vinculado. Use _entrar NOME GRUPO_ no WhatsApp.',
        });
      }

      const items = await botService.getGastosMesComIds(sessao.group, sessao.user);
      const total = items.reduce((a, e) => a + Number(e.value || 0), 0);
      const porCat = {};
      const porDia = {};

      items.forEach((e) => {
        const cat = e.cat || 'Outros';
        const date = e.date || 'Sem data';

        porCat[cat] = (porCat[cat] || 0) + Number(e.value || 0);
        porDia[date] = (porDia[date] || 0) + Number(e.value || 0);
      });

      return res.json({
        ok: true,
        sessao,
        mes: botService.MESES[Number(botService.dateParts().month) - 1],
        total,
        porCat,
        porDia,
        ultimos: items
          .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
          .slice(0, 20)
          .map((e) => ({
            id: e.id,
            desc: e.desc || 'Gasto',
            value: Number(e.value || 0),
            cat: e.cat || 'Outros',
            date: e.date || '',
            createdAt: e.createdAt || '',
            origem: e.origem || 'texto',
          })),
      });
    } catch (err) {
      console.error('Erro dashboard API:', err);

      return res.status(500).json({
        ok: false,
        error: 'Erro interno.',
      });
    }
  });

  // ─── APAGAR VIA API ───────────────────────────────────────
  app.delete('/api/gasto/:id', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');

      if (!dashboardAuthorized(req, config.dashboardToken)) {
        return res.status(401).json({
          ok: false,
          error: 'Dashboard não autorizado.',
        });
      }

      const phone = String(req.query.phone || '').replace(/\D/g, '');

      if (!phone) {
        return res.status(400).json({
          ok: false,
          error: 'Informe o phone.',
        });
      }

      const sessao = await getSession(phone);

      if (!sessao) {
        return res.status(404).json({
          ok: false,
          error: 'Sessão não encontrada.',
        });
      }

      const { id } = req.params;

      await botService.apagarGastoPorId(sessao, id);

      return res.json({ ok: true });
    } catch (err) {
      console.error('Erro ao apagar gasto via API:', err);

      return res.status(500).json({
        ok: false,
        error: 'Erro interno.',
      });
    }
  });

  // ─── DASHBOARD UI ─────────────────────────────────────────
  app.get('/dashboard', (_, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(dashboardPage());
  });

  // ─── HOME / HEALTH ────────────────────────────────────────
  app.get('/', (_, res) => res.json({
    status: 'ok',
    bot: 'SalvaMoney',
    version: '5.5.0',
    provider: config.whatsappProvider,
    site: config.siteUrl,
    features: {
      text: true,
      audio: Boolean(config.groqApiKey),
      image: Boolean(config.groqApiKey),
      parcelamento: true,
      apagar: true,
      dashboard: true,
      deleteViaApi: true,
      criarCodigo: true,
      siteLink: true,
    },
  }));

  app.get('/health', (_, res) => {
    res.json({
      ok: true,
      ts: new Date().toISOString(),
    });
  });
}

module.exports = {
  registerRoutes,
};
