// Motor 1 (padrão): Chefe Geral (Grok) pela rotina de webhook "Console Chefe Geral, pedidos do app".
// Modo "ponte" (padrão): o app fala com a Ponte do Mac em 127.0.0.1:8788, que guarda a chave e repassa ao webhook.
// Modo "direto": o navegador chama o webhook (só funciona se o webhook liberar CORS para este site).
import {ler} from "../core/config.js";
import {agoraISO} from "../core/db.js";
export const nome = "Motor 1: Chefe Geral (Grok)";

export function montarPayload({tipo, pedido, obsidian_context = [], anexos}) {
  return {
    versao: 1, origem: "chefe-geral-hub", tipo, enviado_em: agoraISO(),
    pedido: {id: pedido.id, texto: pedido.texto, modulo: pedido.modulo, vertente: pedido.vertente, opcao: pedido.opcao,
      canal: pedido.canal, criado_em: pedido.criado_em, camada: 4},
    anexos: anexos || null,
    confirmado_pelo_usuario: !!(anexos && anexos.confirmado_pelo_usuario),
    obsidian_context,
    instrucoes: {
      responder_por: "telegram",
      confirmacao: "Antes de enviar algo a outra pessoa, publicar ou gravar na agenda, peça o OK do Guilherme.",
      memoria: "Use obsidian_context como contexto. Notas novas vão para a pasta Chefe Geral do cofre."
    }
  };
}
const pausa = ms => new Promise(r => setTimeout(r, ms));
async function comPrazo(url, opts, ms) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, {...opts, signal: ac.signal}); } finally { clearTimeout(t); }
}
// Ponte na nuvem (Cloudflare Worker na conta do Guilherme): ativa quando modo = "nuvem" e há URL e token.
export function nuvem() {
  const c = ler().grok;
  return c.modo === "nuvem" && c.nuvem?.url && c.nuvem?.token ? {url: c.nuvem.url.replace(/\/$/, ""), token: c.nuvem.token} : null;
}
export async function nuvemApi(rota, opts = {}, ms = 20000) {
  const n = nuvem();
  if (!n) throw Object.assign(new Error("Ponte na nuvem não configurada (Canais)"), {code: "PONTE_OFF"});
  let r;
  try { r = await comPrazo(n.url + rota, {...opts, headers: {...(opts.headers || {}), Authorization: "Bearer " + n.token}}, ms); }
  catch { throw Object.assign(new Error("Ponte na nuvem fora de alcance (sem internet?)"), {code: "PONTE_OFF"}); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error("Token do app errado (Canais > Ponte na nuvem)");
  return Object.assign(j, {_status: r.status});
}
// Saúde da ponte: {ligada, ...health} ou {ligada:false}
export async function saude() {
  const c = ler().grok;
  if (c.modo === "nuvem") {
    const n = nuvem(); if (!n) return {ligada: false, modo: "nuvem"};
    try { const r = await comPrazo(n.url + "/health", {}, 5000); const j = await r.json(); return {ligada: !!j.ok, modo: "nuvem", ...j}; }
    catch { return {ligada: false, modo: "nuvem"}; }
  }
  if (c.modo !== "ponte") return {ligada: false, modo: "direto"};
  try { const r = await comPrazo(c.ponte.replace(/\/$/, "") + "/health", {}, 2500); const j = await r.json(); return {ligada: !!j.ok, ...j}; }
  catch { return {ligada: false}; }
}
export async function enviar(dados) {
  const c = ler().grok;
  const corpo = JSON.stringify(montarPayload(dados));
  if (c.modo === "nuvem") {
    const j = await nuvemApi("/pedido", {method: "POST", headers: {"Content-Type": "application/json"}, body: corpo}, 40000);
    if (!j.ok) throw new Error(j.erro || "Chefe Geral respondeu HTTP " + (j.webhook_status || j._status));
    return {camada: j.resposta?.camada || 4, status: j.resposta?.status || "andamento", resposta: j.resposta?.resposta || null,
      detalhe: "Entregue ao Chefe Geral pela ponte na nuvem (HTTP " + j.webhook_status + "). A resposta chega no Telegram e em Arquivo."};
  }
  if (c.modo === "ponte") {
    let r;
    try { r = await comPrazo(c.ponte.replace(/\/$/, "") + "/pedido", {method: "POST", headers: {"Content-Type": "application/json", ...(c.ponte_token ? {"X-Chefe-Token": c.ponte_token} : {})}, body: corpo}, 40000); }
    catch { throw Object.assign(new Error("Ponte do Mac desligada ou fora de alcance"), {code: "PONTE_OFF"}); }
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error("Chefe Geral respondeu HTTP " + (j.webhook_status || r.status) + (j.webhook_status === 401 ? " (chave errada ou ausente: rode set-webhook-key.sh no Mac)" : j.detalhe ? ": " + String(j.detalhe).slice(0, 120) : ""));
    return {camada: j.resposta?.camada || 4, status: j.resposta?.status || "andamento", resposta: j.resposta?.resposta || null,
      detalhe: j.resposta?.duplicado ? "Já tinha sido entregue (sem duplicar)" : "Entregue ao Chefe Geral pela ponte do Mac (HTTP " + j.webhook_status + "). A resposta chega no chat ou no Telegram."};
  }
  if (!c.url) throw new Error("Webhook não configurado (Canais > Motor 1)");
  const headers = {"Content-Type": "application/json"};
  if (c.chave) headers[c.header || "Authorization"] = c.chave;
  let r;
  try { r = await fetch(c.url, {method: "POST", headers, body: corpo}); }
  catch { throw new Error("O navegador bloqueou a chamada direta ao webhook (CORS). Use o modo Ponte do Mac."); }
  const txt = await r.text().catch(() => "");
  if (!r.ok) throw new Error("Webhook respondeu HTTP " + r.status);
  let j = null; try { j = JSON.parse(txt); } catch {}
  return {camada: j?.camada || 4, status: j?.status || "andamento", resposta: j?.resposta || null, detalhe: "Entregue ao Chefe Geral (HTTP " + r.status + ")."};
}
export async function testar() {
  const s = await saude();
  if (ler().grok.modo === "nuvem" && !s.ligada) throw new Error("Ponte na nuvem fora de alcance. Confira a URL em Canais.");
  if (ler().grok.modo === "ponte" && !s.ligada) throw new Error("Ponte do Mac desligada. No Mac: ./scripts/relay-status.sh");
  if (s.ligada && !s.chave_presente) throw new Error("Ponte ligada, mas sem chave. No Mac: ./scripts/set-webhook-key.sh");
  const r = await enviar({tipo: "teste", pedido: {id: "teste", texto: "Teste de conexão do app Chefe Geral. Pode ignorar.", modulo: "canais", canal: "app", criado_em: agoraISO()}});
  return r.detalhe;
}
// Caminho do celular: abre o chat do seu bot com o pedido pronto; você toca em Enviar no Telegram e a ponte do Mac pega.
export function linkTelegram(p, extra = {}) {
  const bot = (ler().telegram.bot || "Chefegui_bot").replace(/^@/, "");
  const reuniao = extra.tipo === "reuniao_resumo";
  // Pedido comum: o texto puro, como se você digitasse no bot.
  if (!reuniao) return p.texto.length > 3500 ? null : `https://t.me/${bot}?text=${encodeURIComponent(p.texto)}`;
  const j = {id: p.id, tipo: extra.tipo || "pedido", texto: p.texto, modulo: p.modulo};
  if (reuniao) Object.assign(j, {titulo: extra.anexos?.titulo, regras: extra.anexos?.regras, transcricao: extra.anexos?.transcricao});
  const txt = (reuniao ? "#reuniao " : "#pedido ") + JSON.stringify(j);
  if (txt.length > 3500) return null;  // grande demais para link: use Compartilhar arquivo
  return `https://t.me/${bot}?text=${encodeURIComponent(txt)}`;
}

// Transcrição local no Mac: manda o áudio para a ponte, que usa o VoiceStudio (pt) e devolve só o texto.
// O áudio é apagado do Mac logo depois. Erro com code "PONTE_OFF" quando o Mac não está ao alcance.
export async function transcreverNoMac(blob) {
  const c = ler().grok;
  if (nuvem()) {
    const j = await nuvemApi("/transcrever", {method: "POST", headers: {"Content-Type": (blob.type || "application/octet-stream").split(";")[0]}, body: blob}, 120000);
    if (!j.ok) throw new Error(j.erro || "Transcrição na nuvem falhou (HTTP " + j._status + ")");
    return j;
  }
  let r;
  try { r = await fetch(c.ponte.replace(/\/$/, "") + "/transcrever", {method: "POST", headers: {"Content-Type": (blob.type || "application/octet-stream").split(";")[0]}, body: blob}); }
  catch { const e = new Error("Ponte do Mac fora de alcance"); e.code = "PONTE_OFF"; throw e; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.erro || "Transcrição falhou (HTTP " + r.status + ")");
  return j;
}
