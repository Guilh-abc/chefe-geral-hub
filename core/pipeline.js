// Pipeline de 7 camadas de cada pedido.
import {salvar, atualizar, agoraISO} from "./db.js";
export const CAMADAS = ["Captura", "Triagem", "Contexto", "Envio ao motor", "Plano e seu OK", "Execução", "Retorno"];

export async function novoPedido({texto, canal = "app", modulo = "pedidos", vertente = null, opcao = null, motor}) {
  return salvar("pedidos", {texto: texto.trim(), canal, modulo, vertente, opcao, motor, status: "fila", camada: 2,
    historico: [{em: agoraISO(), camada: 1, nota: "Recebido pelo " + canal}, {em: agoraISO(), camada: 2, nota: vertente ? "Vertente: " + vertente : "Triagem pelo Chefe Geral"}]});
}
export async function marcar(id, {camada, status, nota, resposta}) {
  return atualizar("pedidos", id, p => {
    if (camada) p.camada = camada;
    if (status) p.status = status;
    if (resposta !== undefined) p.resposta = resposta;
    p.historico.push({em: agoraISO(), camada: p.camada, status: p.status, nota: nota || null});
  });
}
// Envia ao motor escolhido, com contexto da memória. Atualiza camadas 3 e 4 (e 7 quando o motor já responde).
export async function enviarAoMotor(p, extra = {}) {
  const {buscarContexto} = await import("../memory/obsidian.js");
  const ctx = await buscarContexto(p.texto).catch(() => []);
  await marcar(p.id, {camada: 3, status: "andamento", nota: ctx.length ? ctx.length + " notas do Obsidian como contexto" : "Sem contexto do Obsidian"});
  const motor = p.motor === "ollama" ? await import("../engines/ollama.js") : await import("../engines/grok-webhook.js");
  try {
    const r = await motor.enviar({tipo: extra.tipo || "pedido", pedido: p, obsidian_context: ctx, anexos: extra.anexos});
    if (r.resposta) return marcar(p.id, {camada: 7, status: "concluido", nota: r.detalhe, resposta: r.resposta});
    return marcar(p.id, {camada: r.camada || 4, status: r.status || "andamento", nota: r.detalhe});
  } catch (e) {
    return marcar(p.id, {camada: 4, status: "erro", nota: e.message});
  }
}
