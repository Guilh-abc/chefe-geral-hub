// Canal Telegram (Bot API, gratuito). Só manda para o SEU chat e só depois do seu toque.
import {ler} from "../core/config.js";
const LIMITE = 4096;
async function api(metodo, corpo) {
  const {token} = ler().telegram;
  if (!token) throw new Error("Token do Telegram não configurado (Canais > Telegram)");
  const opts = corpo instanceof FormData ? {method: "POST", body: corpo}
    : {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(corpo || {})};
  let r;
  try { r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, opts); }
  catch { throw new Error("Sem conexão com o Telegram"); }
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error("Telegram: " + (j.description || "HTTP " + r.status));
  return j.result;
}
export const quemSou = () => api("getMe");
export async function descobrirChats() {
  const ups = await api("getUpdates", {limit: 50, allowed_updates: ["message"]});
  const m = new Map();
  for (const u of ups) { const c = u.message?.chat; if (c) m.set(String(c.id), c.first_name || c.title || c.username || ""); }
  return [...m].map(([chat_id, nome]) => ({chat_id, nome}));
}
// Texto até 4096: sendMessage. Maior: sendDocument com o texto completo em .md e legenda curta.
export async function enviarTexto(texto, {arquivo = "chefe-geral.md", legenda, documentoExtra} = {}) {
  const {chat_id} = ler().telegram;
  if (!chat_id) throw new Error("chat_id não configurado (Canais > Telegram)");
  const out = [];
  if (texto.length <= LIMITE) out.push(await api("sendMessage", {chat_id, text: texto}));
  else out.push(await enviarDocumento(texto, arquivo, legenda || texto.slice(0, 900) + "\n\n(texto completo no arquivo)"));
  if (documentoExtra) out.push(await enviarDocumento(documentoExtra.conteudo, documentoExtra.arquivo, documentoExtra.legenda));
  return out;
}
export async function enviarDocumento(conteudo, arquivo, legenda) {
  const fd = new FormData();
  fd.append("chat_id", ler().telegram.chat_id);
  fd.append("document", new Blob([conteudo], {type: "text/markdown"}), arquivo);
  if (legenda) fd.append("caption", legenda.slice(0, 1024));
  return api("sendDocument", fd);
}
export const testar = () => enviarTexto("Teste do app Chefe Geral: o Telegram está funcionando.");
