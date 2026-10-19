// Motor 1 (padrão): Chefe Geral (Grok Bot) pela rotina de webhook "Console Chefe Geral, pedidos do app".
import {ler} from "../core/config.js";
import {agoraISO} from "../core/db.js";
export const nome = "Motor 1: Chefe Geral (Grok)";

export function montarPayload({tipo, pedido, obsidian_context = [], anexos}) {
  return {
    versao: 1, origem: "chefe-geral-hub", tipo, enviado_em: agoraISO(),
    pedido: {id: pedido.id, texto: pedido.texto, modulo: pedido.modulo, vertente: pedido.vertente, opcao: pedido.opcao,
      canal: pedido.canal, criado_em: pedido.criado_em, camada: 4},
    anexos: anexos || null,
    obsidian_context,
    instrucoes: {
      responder_por: "telegram",
      confirmacao: "Antes de enviar algo a outra pessoa, publicar ou gravar na agenda, peça o OK do Guilherme.",
      memoria: "Use obsidian_context como contexto. Notas novas vão para a pasta Chefe Geral do cofre."
    }
  };
}
export async function enviar(dados) {
  const c = ler().grok;
  if (!c.url) throw new Error("Webhook não configurado (Canais > Chefe Geral)");
  const headers = {"Content-Type": "application/json"};
  if (c.chave) headers[c.header || "Authorization"] = c.chave;
  let r;
  try {
    r = await fetch(c.url, {method: "POST", headers, body: JSON.stringify(montarPayload(dados))});
  } catch (e) {
    throw new Error("Não consegui falar com o webhook (rede ou CORS bloqueado pelo navegador)");
  }
  const txt = await r.text().catch(() => "");
  if (!r.ok) throw new Error("Webhook respondeu HTTP " + r.status + (txt ? ": " + txt.slice(0, 120) : ""));
  let j = null; try { j = JSON.parse(txt); } catch {}
  return {camada: j?.camada || 4, status: j?.status || "andamento",
    detalhe: "Entregue ao Chefe Geral (HTTP " + r.status + "). A resposta chega no chat ou no Telegram.", resposta: j?.resposta || null};
}
export async function testar() {
  const r = await enviar({tipo: "teste", pedido: {id: "teste", texto: "Teste de conexão do app Chefe Geral. Pode ignorar.", modulo: "canais", canal: "app", criado_em: agoraISO()}});
  return r.detalhe;
}
