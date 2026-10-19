// Ponte do Chefe Geral na nuvem (Cloudflare Worker, plano grátis). Substitui a ponte do Mac quando "modo": "nuvem".
//
// Rotas
//   GET  /health                     estado, sem segredos (público)
//   POST /telegram                   webhook do Telegram (header X-Telegram-Bot-Api-Secret-Token = TELEGRAM_SECRET)
//   Com Authorization: Bearer APP_TOKEN (app no Mac/celular e ponte do Mac):
//     POST /pedido                   payload do app (docs/webhook-payload.md) -> webhook da rotina; guarda o pedido
//     POST /transcrever              corpo = áudio; Whisper (Workers AI) em pt -> {ok, texto}; guarda a transcrição
//     GET  /pedidos | /respostas | /transcricoes | /notas | /reunioes   ?depois=<seq>&limite=<n>
//     GET  /sync?depois=<seq>        tudo o que é novo (a ponte do Mac grava no Obsidian)
//     POST /pendente/ok              {id, texto} a ponte do Mac transcreveu um áudio que a nuvem não conseguiu
//     POST /indice                   {notas:[{arquivo, titulo, tags}]} índice leve (só títulos) para obsidian_context
//   Com Authorization: Bearer RESPOSTA_TOKEN (ou APP_TOKEN):
//     POST /resposta                 {pedido_id, titulo, texto, message_id} resposta do Chefe Geral (box)
// CORS: só ALLOWED_ORIGIN (https://guilh-abc.github.io). Chamadas sem Origin (Mac, box) dependem só do token.

const WHISPER = "@cf/openai/whisper-large-v3-turbo";
const TIPOS = {pedidos: "pedido", respostas: "resposta", transcricoes: "transcricao", notas: "nota", reunioes: "reuniao"};
const ACK = "Recebido. A resposta completa chega aqui no Telegram.";
const MAX_AUDIO = 20 * 1024 * 1024;   // limite de download de arquivo da Bot API

export const agora = (d = Date.now()) => new Date(d - 3 * 3600e3).toISOString().slice(0, 19) + "-03:00";
const json = (obj, status = 200, h = {}) => new Response(JSON.stringify(obj), {status, headers: {"Content-Type": "application/json; charset=utf-8", ...h}});

export function igual(a = "", b = "") {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
}
export function cors(req, env) {
  const o = req.headers.get("Origin");
  if (!o) return {};                                   // Mac / box: sem CORS
  if (o !== (env.ALLOWED_ORIGIN || "https://guilh-abc.github.io")) return null;
  return {"Access-Control-Allow-Origin": o, "Vary": "Origin", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600"};
}
const bearer = req => (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();

// ---------- D1 ----------
let pronto = false;
async function db(env) {
  if (!pronto) {
    await env.DB.batch([
      env.DB.prepare("CREATE TABLE IF NOT EXISTS itens (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, tipo TEXT NOT NULL, criado_em TEXT NOT NULL, titulo TEXT, texto TEXT, meta TEXT)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS itens_tipo ON itens(tipo, seq)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS updates (update_id INTEGER PRIMARY KEY, em TEXT)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS indice (arquivo TEXT PRIMARY KEY, titulo TEXT, tags TEXT)"),
    ]);
    pronto = true;
  }
  return env.DB;
}
// Guarda um item (id único: repetir não duplica). Retorna true se foi novo.
export async function guardar(env, {id, tipo, titulo = "", texto = "", meta = {}}) {
  const r = await (await db(env)).prepare("INSERT OR IGNORE INTO itens (id, tipo, criado_em, titulo, texto, meta) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(String(id), tipo, agora(), String(titulo).slice(0, 200), String(texto).slice(0, 200000), JSON.stringify(meta)).run();
  return (r.meta?.changes || 0) > 0;
}
async function atualizar(env, id, campos) {
  const it = await (await db(env)).prepare("SELECT * FROM itens WHERE id = ?").bind(id).first();
  if (!it) return false;
  const meta = {...JSON.parse(it.meta || "{}"), ...(campos.meta || {})};
  await env.DB.prepare("UPDATE itens SET tipo = ?, texto = ?, meta = ? WHERE id = ?").bind(campos.tipo || it.tipo, campos.texto ?? it.texto, JSON.stringify(meta), id).run();
  return true;
}
export async function listar(env, tipo, depois = 0, limite = 50) {
  const d = await db(env);
  const lim = Math.max(1, Math.min(Number(limite) || 50, 200));
  const q = tipo
    ? d.prepare("SELECT * FROM itens WHERE tipo = ? AND seq > ? ORDER BY seq DESC LIMIT ?").bind(tipo, Number(depois) || 0, lim)
    : d.prepare("SELECT * FROM itens WHERE seq > ? ORDER BY seq ASC LIMIT ?").bind(Number(depois) || 0, lim);
  return ((await q.all()).results || []).map(r => ({...r, meta: JSON.parse(r.meta || "{}")}));
}

// ---------- Contexto (índice leve de títulos vindo do Mac) ----------
export function pontuar(texto, notas, max = 3) {
  const pal = [...new Set((texto || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]{4,}/g) || [])];
  if (!pal.length) return [];
  return notas.map(n => {
    const alvo = `${n.titulo} ${n.tags || ""}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return {arquivo: n.arquivo, score: pal.filter(p => alvo.includes(p)).length, trecho: n.titulo, fonte: "indice-nuvem"};
  }).filter(n => n.score > 0).sort((a, b) => b.score - a.score).slice(0, max);
}
async function contexto(env, texto) {
  try { const r = await (await db(env)).prepare("SELECT arquivo, titulo, tags FROM indice LIMIT 5000").all(); return pontuar(texto, r.results || []); }
  catch { return []; }
}

// ---------- Saída ----------
async function paraRotina(env, payload) {
  try {
    const r = await fetch(env.WEBHOOK_URL, {method: "POST", headers: {"Content-Type": "application/json", Authorization: env.WEBHOOK_KEY || ""}, body: JSON.stringify(payload)});
    return {status: r.status, texto: (await r.text()).slice(0, 2000)};
  } catch (e) { return {status: 599, texto: String(e).slice(0, 200)}; }
}
const tgBase = env => (env.TG_API || "https://api.telegram.org") + "/bot" + env.TELEGRAM_TOKEN;
async function tg(env, metodo, params) {
  const r = await fetch(`${tgBase(env)}/${metodo}`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(params)});
  return r.json().catch(() => ({ok: false}));
}
const responder = (env, texto, reply) => tg(env, "sendMessage", {chat_id: env.CHAT_ID, text: texto, ...(reply ? {reply_to_message_id: reply} : {})});

export function payloadBase(origem, tipo, texto, id, modulo, canal, anexos = null, ctx = []) {
  return {versao: 1, origem, tipo, enviado_em: agora(),
    pedido: {id, texto, modulo, vertente: null, opcao: null, canal, criado_em: agora(), camada: 4},
    anexos, confirmado_pelo_usuario: false, obsidian_context: ctx,
    instrucoes: {responder_por: "telegram", confirmacao: "Antes de enviar algo a outra pessoa, publicar ou gravar na agenda, peça o OK do Guilherme.",
      memoria: "Use obsidian_context como contexto. Notas novas vão para a pasta Chefe Geral do cofre (a ponte do Mac sincroniza quando ligar)."}};
}

// ---------- Transcrição ----------
export async function transcrever(env, bytes) {
  if (!bytes || !bytes.byteLength) throw new Error("áudio vazio");
  if (bytes.byteLength > MAX_AUDIO) throw new Error("áudio maior que 20 MB");
  const audio = Buffer.from(bytes).toString("base64");
  const r = await env.AI.run(WHISPER, {audio, language: "pt", task: "transcribe", vad_filter: true, condition_on_previous_text: false});
  return (r?.text || "").trim();
}
const REGRAS = ["Comece com uma frase de amigo, direto e sincero, dizendo como foi a reunião", "Pontos principais em até 5 tópicos", "Decisões tomadas",
  "Ações com responsável e prazo (quem, o quê, até quando)", "O que foi bem", "O que melhorar na próxima", "Tom amigável e direto, sem enrolação, em português do Brasil"];

// Classifica a mensagem do Telegram (pura, testável).
export function classificar(m) {
  let texto = (m.text || m.caption || "").trim();
  const doc = m.document || null, nome = (doc?.file_name || "").toLowerCase();
  const out = {acao: "pedido", texto, reuniao: false, midia: null, json: null};
  const tag = texto.match(/^#(pedido|reuniao)\b\s*([\s\S]*)$/);
  if (tag) { try { out.json = JSON.parse(tag[2]); } catch { out.texto = tag[2].trim(); } out.reuniao = tag[1] === "reuniao" || out.json?.tipo === "reuniao_resumo"; return out; }
  if (/^\/(salvar|nota)\b/.test(texto)) return {...out, acao: "salvar", texto: texto.replace(/^\/(salvar|nota)\b\s*/, "").trim()};
  if (/^\/start\b/.test(texto)) return {...out, acao: "start"};
  out.reuniao = texto.startsWith("/reuniao") || nome.startsWith("reuniao");
  if (texto.startsWith("/reuniao")) out.texto = texto.slice(8).trim();
  const ehTexto = doc && (/^text\//.test(doc.mime_type || "") || /\.(txt|md|vtt|srt)$/.test(nome));
  const ehAudio = m.voice || m.audio || (doc && /^audio\//.test(doc.mime_type || ""));
  if (ehTexto) out.midia = {tipo: "texto", file_id: doc.file_id, tamanho: doc.file_size || 0};
  else if (ehAudio) { const a = m.voice || m.audio || doc; out.midia = {tipo: "audio", file_id: a.file_id, tamanho: a.file_size || 0, mime: a.mime_type || null, duracao_s: a.duration || null}; }
  return out;
}

async function baixarTg(env, file_id) {
  const f = await tg(env, "getFile", {file_id});
  if (!f.ok) throw new Error(f.description || "getFile falhou (arquivo acima de 20 MB?)");
  const r = await fetch(`${(env.TG_API || "https://api.telegram.org")}/file/bot${env.TELEGRAM_TOKEN}/${f.result.file_path}`);
  if (!r.ok) throw new Error("download HTTP " + r.status);
  return r.arrayBuffer();
}

async function entregar(env, {id, tipo, texto, modulo, canal, anexos, origem, reply}) {
  const ctx = await contexto(env, texto);
  const payload = payloadBase(origem, tipo, texto, id, modulo, canal, anexos, ctx);
  await guardar(env, {id, tipo: tipo === "reuniao_resumo" ? "reuniao" : "pedido", titulo: (anexos?.titulo || texto || "Pedido").slice(0, 80),
    texto: tipo === "reuniao_resumo" ? (anexos?.transcricao || texto) : texto, meta: {modulo, canal, origem, tipo}});
  const r = await paraRotina(env, payload);
  await atualizar(env, id, {meta: {webhook_status: r.status}});
  if (reply !== undefined) await responder(env, r.status < 300 ? ACK : `Recebido e guardado na nuvem, mas o Chefe Geral não aceitou agora (HTTP ${r.status}).`, reply);
  return r;
}

export async function tratarTelegram(env, u) {
  const m = u.message;
  if (!m) return "sem_mensagem";
  if (String(m.chat?.id) !== String(env.CHAT_ID) || String(m.from?.id) !== String(env.CHAT_ID)) return "ignorado";
  if (u.update_id !== undefined) {
    const r = await (await db(env)).prepare("INSERT OR IGNORE INTO updates (update_id, em) VALUES (?, ?)").bind(u.update_id, agora()).run();
    if (!(r.meta?.changes > 0)) return "duplicado";
  }
  const c = classificar(m), id = "tg" + m.message_id, origem = "chefe-geral-nuvem-telegram";
  if (c.acao === "start") { await responder(env, "Ponte do Chefe Geral na nuvem ligada (funciona com o Mac desligado). Mande texto ou nota de voz. Use /reuniao na legenda de um áudio ou .txt para o resumo da reunião. Use /salvar + texto para guardar algo."); return "start"; }
  if (c.acao === "salvar") {
    if (!c.texto) { await responder(env, "Mande /salvar seguido do texto."); return "salvar_vazio"; }
    await guardar(env, {id: "salvo-" + id, tipo: "resposta", titulo: c.texto.split("\n")[0].slice(0, 60), texto: c.texto, meta: {origem: "salvar"}});
    await responder(env, "Guardado na nuvem. Vai para o Obsidian, em Chefe Geral/Respostas, quando o Mac ligar.");
    return "salvo";
  }
  if (c.json) {
    const j = c.json, pid = j.id || id;
    if (c.reuniao) return entregar(env, {id: pid, tipo: "reuniao_resumo", texto: j.texto || "Resumo da reunião", modulo: "reunioes", canal: "telegram", origem, reply: m.message_id,
      anexos: {titulo: j.titulo || "Reunião", regras: j.regras?.length ? j.regras : REGRAS, transcricao: j.transcricao || j.texto || ""}});
    return entregar(env, {id: pid, tipo: "pedido", texto: j.texto || "", modulo: j.modulo || "pedidos", canal: "telegram", origem, reply: m.message_id});
  }
  let texto = c.texto, anexos = null, tipo = "pedido", modulo = "pedidos";
  if (c.midia) {
    if (c.midia.tamanho > MAX_AUDIO) { await responder(env, "Arquivo acima de 20 MB: o Telegram não deixa o bot baixar. Mande em partes ou um áudio mais curto.", m.message_id); return "grande"; }
    let transc = "";
    try {
      const bytes = await baixarTg(env, c.midia.file_id);
      transc = c.midia.tipo === "texto" ? new TextDecoder().decode(bytes) : await transcrever(env, bytes);
    } catch (e) {
      // Não conseguiu na nuvem: fica pendente; a ponte do Mac transcreve no VoiceStudio quando ligar.
      await guardar(env, {id: "pend-" + id, tipo: "pendente", titulo: c.texto || "Áudio", texto: "", meta: {file_id: c.midia.file_id, mime: c.midia.mime, reuniao: c.reuniao, legenda: c.texto, erro: String(e.message || e).slice(0, 200)}});
      await responder(env, "Não consegui transcrever na nuvem agora (" + String(e.message || e).slice(0, 80) + "). O áudio ficou na fila e o Mac transcreve quando ligar.", m.message_id);
      return "pendente";
    }
    if (c.midia.tipo === "audio") await guardar(env, {id: "tr-" + id, tipo: "transcricao", titulo: (c.reuniao ? "Reunião: " : "Nota de voz: ") + (c.texto || transc).slice(0, 60), texto: transc, meta: {origem, duracao_s: c.midia.duracao_s, motor: WHISPER}});
    if (c.reuniao) { tipo = "reuniao_resumo"; modulo = "reunioes"; anexos = {titulo: c.texto || "Reunião pelo Telegram", regras: REGRAS, transcricao: transc}; texto = c.texto || "Resumo da reunião enviada pelo Telegram"; }
    else { modulo = c.midia.tipo === "audio" && !c.texto ? "notas" : "pedidos"; anexos = {transcricao: transc}; texto = (c.texto ? c.texto + "\n\n" : "") + transc; }
  } else if (c.reuniao) { tipo = "reuniao_resumo"; modulo = "reunioes"; anexos = {titulo: "Reunião pelo Telegram", regras: REGRAS, transcricao: texto}; }
  if (!texto.trim() && !anexos) return "vazio";
  return entregar(env, {id, tipo, texto, modulo, canal: "telegram", anexos, origem, reply: m.message_id});
}

// ---------- HTTP ----------
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), h = cors(req, env), rota = url.pathname.replace(/\/+$/, "") || "/";
    if (req.method === "OPTIONS") return new Response(null, {status: h && Object.keys(h).length ? 204 : 403, headers: h || {}});
    if (rota === "/telegram" && req.method === "POST") {
      if (!igual(req.headers.get("X-Telegram-Bot-Api-Secret-Token") || "", env.TELEGRAM_SECRET || "")) return new Response("", {status: 401});
      const u = await req.json().catch(() => ({}));
      const job = tratarTelegram(env, u).catch(e => console.log("telegram: " + String(e).replace(/bot\d+:[\w-]+/g, "bot<token>")));
      if (ctx?.waitUntil) ctx.waitUntil(job); else await job;
      return json({ok: true});
    }
    if (h === null) return json({erro: "origem não permitida"}, 403);
    if (rota === "/health") return json({ok: true, ponte: "nuvem", versao: "2.0", hora: agora(), webhook_configurado: !!env.WEBHOOK_URL, chave_presente: !!env.WEBHOOK_KEY,
      telegram: !!env.TELEGRAM_TOKEN, chat_id: !!env.CHAT_ID, banco: !!env.DB, transcricao: env.AI ? "Workers AI Whisper" : null}, 200, h);
    const tok = bearer(req), app = igual(tok, env.APP_TOKEN || ""), resp = app || igual(tok, env.RESPOSTA_TOKEN || "");
    if (rota === "/resposta" && req.method === "POST") {
      if (!resp) return json({erro: "token ausente ou errado"}, 401, h);
      const b = await req.json().catch(() => null);
      if (!b?.texto) return json({erro: "falta texto"}, 400, h);
      const pid = String(b.pedido_id || "sem-id").slice(0, 64);
      const novo = await guardar(env, {id: "resp-" + pid + "-" + (b.message_id || Date.now()), tipo: "resposta", titulo: b.titulo || "Resposta " + pid, texto: b.texto, meta: {pedido_id: pid, message_id: b.message_id || null}});
      return json({ok: true, novo}, 200, h);
    }
    if (!app) return json({erro: "token do app ausente ou errado"}, 401, h);
    try {
      if (rota === "/pedido" && req.method === "POST") {
        const p = await req.json().catch(() => null);
        if (!p?.pedido) return json({erro: "JSON inválido"}, 400, h);
        p.origem = p.origem === "chefe-geral-hub" || !p.origem ? "chefe-geral-nuvem-app" : p.origem;
        if (!p.obsidian_context?.length) p.obsidian_context = await contexto(env, p.pedido.texto);
        const pid = String(p.pedido.id || "app" + Date.now());
        if (pid !== "teste") await guardar(env, {id: pid, tipo: p.tipo === "reuniao_resumo" ? "reuniao" : "pedido", titulo: (p.anexos?.titulo || p.pedido.texto || "Pedido").slice(0, 80),
          texto: p.tipo === "reuniao_resumo" ? (p.anexos?.transcricao || p.pedido.texto) : p.pedido.texto, meta: {modulo: p.pedido.modulo, canal: p.pedido.canal || "app", origem: p.origem, tipo: p.tipo}});
        const r = await paraRotina(env, p);
        let resposta = null; try { resposta = JSON.parse(r.texto); } catch {}
        return json({ok: r.status < 300, webhook_status: r.status, resposta, detalhe: resposta ? null : r.texto.slice(0, 300)}, r.status < 300 ? 200 : 502, h);
      }
      if (rota === "/transcrever" && req.method === "POST") {
        const bytes = await req.arrayBuffer();
        const texto = await transcrever(env, bytes);
        const id = url.searchParams.get("id") || "app-tr-" + Date.now();
        if (texto) await guardar(env, {id, tipo: "transcricao", titulo: (url.searchParams.get("titulo") || "Transcrição do app: " + texto.slice(0, 50)), texto, meta: {origem: "chefe-geral-nuvem-app", motor: WHISPER}});
        return json({ok: true, texto, motor: "Whisper na nuvem (Cloudflare)"}, 200, h);
      }
      if (req.method === "GET" && TIPOS[rota.slice(1)]) return json({itens: await listar(env, TIPOS[rota.slice(1)], url.searchParams.get("depois"), url.searchParams.get("limite"))}, 200, h);
      if (rota === "/sync" && req.method === "GET") { const itens = await listar(env, null, url.searchParams.get("depois"), url.searchParams.get("limite") || 100); return json({itens, ultimo: itens.at(-1)?.seq ?? Number(url.searchParams.get("depois") || 0)}, 200, h); }
      if (rota === "/pendente/ok" && req.method === "POST") {
        const b = await req.json().catch(() => ({}));
        if (!b.id) return json({erro: "falta id"}, 400, h);
        return json({ok: await atualizar(env, b.id, {tipo: "pendente_ok", texto: b.texto || "", meta: {resolvido: agora()}})}, 200, h);
      }
      if (rota === "/indice" && req.method === "POST") {
        const b = await req.json().catch(() => ({}));
        const notas = (Array.isArray(b.notas) ? b.notas : []).slice(0, 5000).filter(n => n.arquivo);
        const d = await db(env);
        await d.prepare("DELETE FROM indice").run();
        for (let i = 0; i < notas.length; i += 50)
          await d.batch(notas.slice(i, i + 50).map(n => d.prepare("INSERT OR REPLACE INTO indice (arquivo, titulo, tags) VALUES (?, ?, ?)").bind(String(n.arquivo).slice(0, 300), String(n.titulo || "").slice(0, 200), String(n.tags || "").slice(0, 200))));
        return json({ok: true, notas: notas.length}, 200, h);
      }
    } catch (e) { return json({ok: false, erro: String(e.message || e).slice(0, 300)}, 500, h); }
    return json({erro: "rota desconhecida"}, 404, h);
  },
};
