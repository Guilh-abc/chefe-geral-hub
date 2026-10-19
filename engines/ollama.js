// Motor 2 (experimental): IA aberta e gratuita no Mac via Ollama. Responde aqui no app; não executa nas ferramentas.
import {ler} from "../core/config.js";
export const nome = "Motor 2: Ollama no Mac (experimental)";
async function chat(mensagens) {
  const c = ler().ollama;
  let r;
  try {
    r = await fetch(c.url.replace(/\/$/, "") + "/api/chat", {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({model: c.modelo, messages: mensagens, stream: false, options: {temperature: 0.3}})});
  } catch {
    throw new Error("Ollama inacessível. Ele está aberto no Mac e com OLLAMA_ORIGINS liberando este site?");
  }
  if (!r.ok) throw new Error("Ollama HTTP " + r.status + ": " + (await r.text()).slice(0, 120));
  return (await r.json()).message?.content || "";
}
export async function enviar({tipo, pedido, obsidian_context = [], anexos}) {
  const ctx = obsidian_context.map(n => `[${n.arquivo}] ${n.trecho}`).join("\n");
  const sys = "Você é o Chefe Geral, assistente pessoal do Guilherme. Responda em português do Brasil, curto e prático. " +
    "Você não executa ações em ferramentas; proponha passos e diga o que precisa do OK dele." + (ctx ? "\nNotas do segundo cérebro:\n" + ctx : "");
  const user = tipo === "reuniao_resumo" ? `Regras:\n- ${anexos.regras.join("\n- ")}\n\nTranscrição:\n${anexos.transcricao}\n\nEscreva o resumo seguindo as regras.` : pedido.texto;
  const resposta = await chat([{role: "system", content: sys}, {role: "user", content: user}]);
  return {resposta, detalhe: "Respondido pelo Motor 2 (" + ler().ollama.modelo + ")"};
}
export async function testar() {
  const t = await chat([{role: "user", content: "Responda só: ok"}]);
  return "Ollama respondeu: " + t.slice(0, 60);
}
