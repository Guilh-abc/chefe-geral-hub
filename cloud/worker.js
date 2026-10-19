// Ponte do Chefe Geral na nuvem (Cloudflare Worker). Mesmo contrato da Ponte do Mac:
//   GET  /health                 estado (sem segredos)
//   POST /pedido                 app -> webhook da rotina (exige header X-Chefe-Token = APP_TOKEN)
//   GET  /mensagens, GET /memoria, POST /memoria/ok   (precisam do KV "CHEFE" e do X-Chefe-Token)
//   POST /telegram               webhook do Telegram (exige X-Telegram-Bot-Api-Secret-Token = TELEGRAM_SECRET)
// Segredos (wrangler secret put): WEBHOOK_URL, WEBHOOK_KEY, TELEGRAM_TOKEN, TELEGRAM_SECRET, APP_TOKEN.
// Diferença para o Mac: aqui não há transcrição local; áudios vão como file_id do Telegram no payload.

const json = (obj, status = 200, h = {}) => new Response(JSON.stringify(obj), {status, headers: {"Content-Type": "application/json; charset=utf-8", ...h}});
const agora = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 19) + "-03:00";

function cors(req, env) {
  const o = req.headers.get("Origin") || "";
  const ok = o === env.ALLOWED_ORIGIN || /^http:\/\/localhost(:\d+)?$/.test(o);
  return ok ? {"Access-Control-Allow-Origin": o, "Vary": "Origin", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Chefe-Token", "Access-Control-Max-Age": "600"} : null;
}
// Comparação em tempo constante para tokens.
function igual(a = "", b = "") {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
}

async function paraWebhook(env, payload) {
  const r = await fetch(env.WEBHOOK_URL, {method: "POST", headers: {"Content-Type": "application/json", Authorization: env.WEBHOOK_KEY}, body: JSON.stringify(payload)});
  return {status: r.status, texto: (await r.text()).slice(0, 2000)};
}
async function tg(env, metodo, params) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${metodo}`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(params)});
  return r.json();
}
function payloadBase(tipo, texto, id, modulo, anexos = null) {
  return {versao: 1, origem: "chefe-geral-ponte-nuvem", tipo, enviado_em: agora(),
    pedido: {id, texto, modulo, vertente: null, opcao: null, canal: "telegram", criado_em: agora(), camada: 4},
    anexos, confirmado_pelo_usuario: false, obsidian_context: [],
    instrucoes: {responder_por: "telegram", confirmacao: "Antes de enviar algo a outra pessoa, publicar ou gravar na agenda, peça o OK do Guilherme.",
      memoria: "Notas novas vão para a pasta Chefe Geral do cofre."}};
}
async function guardar(env, lista, item) {
  if (!env.CHEFE) return;
  const atual = JSON.parse((await env.CHEFE.get(lista)) || "[]");
  atual.push(item); await env.CHEFE.put(lista, JSON.stringify(atual.slice(-300)));
}

async function telegram(req, env) {
  if (!igual(req.headers.get("X-Telegram-Bot-Api-Secret-Token") || "", env.TELEGRAM_SECRET || "")) return new Response("", {status: 401});
  const u = await req.json().catch(() => ({}));
  const m = u.message; if (!m) return json({ok: true});
  // Só o chat do Guilherme. Qualquer outro é ignorado em silêncio.
  if (String(m.chat?.id) !== String(env.CHAT_ID) || String(m.from?.id) !== String(env.CHAT_ID)) return json({ok: true});
  const texto = (m.text || m.caption || "").trim();
  const id = "tg" + m.message_id;
  await guardar(env, "mensagens", {id, quando: agora(), texto, tipo: m.voice || m.audio ? "voz" : "texto"});
  let payload;
  const j = texto.match(/^#(pedido|reuniao)\s+(\{[\s\S]*\})$/);
  if (j) { try { const d = JSON.parse(j[2]); payload = payloadBase(j[1] === "reuniao" ? "reuniao_resumo" : "pedido", d.texto || d.resumo || "", d.id || id, j[1] === "reuniao" ? "reunioes" : "pedidos", d); } catch {} }
  if (!payload && texto === "/start") { await tg(env, "sendMessage", {chat_id: env.CHAT_ID, text: "Ponte do Chefe Geral na nuvem ativa. Mande texto ou voz."}); return json({ok: true}); }
  if (!payload) {
    const audio = m.voice || m.audio || m.document;
    payload = payloadBase("pedido", texto || "(áudio do Telegram)", id, audio ? "notas" : "pedidos",
      audio ? {telegram_file_id: audio.file_id, mime: audio.mime_type || null, duracao_s: audio.duration || null, transcricao: null} : null);
  }
  const r = await paraWebhook(env, payload);
  await guardar(env, "memoria", {id: "m" + id, caminho: `Chefe Geral/Inbox/${agora().slice(0, 10)} ${id}.md`, titulo: (texto || "Áudio").slice(0, 60),
    md: `---\ndata: ${agora()}\nmodulo: ${payload.pedido.modulo}\norigem: ponte-nuvem\ntags: ["chefe-geral", "telegram"]\n---\n\n${texto || "(áudio)"}\n`, modulo: payload.pedido.modulo, quando: agora()});
  await tg(env, "sendMessage", {chat_id: env.CHAT_ID, reply_to_message_id: m.message_id,
    text: `Recebido. Camada 1 (captura) ok; camada 4: ${r.status < 300 ? "entregue ao Chefe Geral" : "falhou"} (HTTP ${r.status}).`});
  return json({ok: true});
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), h = cors(req, env);
    if (req.method === "OPTIONS") return new Response(null, {status: h ? 204 : 403, headers: h || {}});
    if (url.pathname === "/telegram" && req.method === "POST") return telegram(req, env);
    if (url.pathname === "/health") return json({ok: true, ponte: "nuvem", chave_presente: !!env.WEBHOOK_KEY, telegram: !!env.TELEGRAM_TOKEN, chat_id: !!env.CHAT_ID, transcricao_local: false}, 200, h || {});
    if (!h) return json({erro: "origem não permitida"}, 403);
    if (!igual(req.headers.get("X-Chefe-Token") || "", env.APP_TOKEN || "")) return json({erro: "token do app ausente ou errado"}, 401, h);
    if (url.pathname === "/pedido" && req.method === "POST") {
      const p = await req.json().catch(() => null); if (!p) return json({erro: "JSON inválido"}, 400, h);
      const r = await paraWebhook(env, p);
      return json({ok: r.status < 300, webhook_status: r.status, resposta: r.texto}, 200, h);
    }
    if (url.pathname === "/mensagens") return json({mensagens: JSON.parse((env.CHEFE && await env.CHEFE.get("mensagens")) || "[]").reverse()}, 200, h);
    if (url.pathname === "/memoria" && req.method === "GET") return json({notas: JSON.parse((env.CHEFE && await env.CHEFE.get("memoria")) || "[]")}, 200, h);
    if (url.pathname === "/memoria/ok" && req.method === "POST") {
      const {ids = []} = await req.json().catch(() => ({}));
      if (env.CHEFE) { const l = JSON.parse((await env.CHEFE.get("memoria")) || "[]"); await env.CHEFE.put("memoria", JSON.stringify(l.filter(n => !ids.includes(n.id)))); }
      return json({ok: true}, 200, h);
    }
    return json({erro: "rota desconhecida"}, 404, h);
  },
};
