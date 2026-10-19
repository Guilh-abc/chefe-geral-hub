// Segundo cérebro no Obsidian. Escreve SOMENTE dentro da pasta "Chefe Geral" do cofre e nunca sobrescreve notas.
// Caminho padrão: Ponte do Mac (POST /obsidian/nota, GET /obsidian/busca), que escreve direto no cofre.
// Opcional: plugin Local REST API (Canais › Obsidian › via REST). Sem Mac ao alcance, as notas ficam na fila do app.
import {ler, gravar} from "../core/config.js";
import {salvar, pagina, atualizar, agoraISO} from "../core/db.js";
const PASTAS = {pedidos: "Pedidos", reunioes: "Reunioes", notas: "Notas de voz", tarefas: "Tarefas", agenda: "Agenda", mensagens: "Mensagens", decisoes: "Decisoes", inbox: "Inbox"};
const slug = s => (s || "nota").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s-]/g, "").trim().slice(0, 50).replace(/\s+/g, " ") || "nota";
const yaml = v => JSON.stringify(v ?? "");

function montar({modulo, titulo, corpo, tags = [], id}) {
  const quando = agoraISO();
  const pasta = ler().obsidian.pasta || "Chefe Geral";
  const caminho = `${pasta}/${PASTAS[modulo] || "Inbox"}/${quando.slice(0, 10)} ${quando.slice(11, 16).replace(":", "h")} ${slug(titulo)} ${String(id || "").slice(-4)}.md`.replace(/\s+\.md$/, ".md");
  const md = `---\ndata: ${quando}\nmodulo: ${modulo}\nid: ${yaml(id)}\norigem: chefe-geral-hub\ntags: [${["chefe-geral", modulo, ...tags].map(t => yaml(t)).join(", ")}]\n---\n\n# ${titulo}\n\n${corpo}\n`;
  return {caminho, md, quando, pasta};
}
async function rest(metodo, caminho, corpo, tipo = "text/markdown") {
  const c = ler().obsidian;
  if (!c.chave) throw new Error("Obsidian REST não configurado");
  const r = await fetch(c.url.replace(/\/$/, "") + caminho, {method: metodo,
    headers: {Authorization: "Bearer " + c.chave, ...(corpo != null ? {"Content-Type": tipo} : {})}, body: corpo});
  return r;
}
const enc = p => p.split("/").map(encodeURIComponent).join("/");
const ponte = () => ler().grok.ponte.replace(/\/$/, "");
const viaRest = () => ler().obsidian.via === "rest" && !!ler().obsidian.chave;
async function escrever(n) {
  if (!viaRest()) {
    let r;
    try { r = await fetch(ponte() + "/obsidian/nota", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({id: n.id, caminho: n.caminho, md: n.md, titulo: n.titulo, quando: n.quando})}); }
    catch { throw new Error("Mac fora de alcance: fica na fila"); }
    const j = await r.json().catch(() => ({}));
    const e = j.resultados?.[0]?.estado;
    if (!r.ok || !["criado", "ja_existe"].includes(e)) throw new Error(j.erro || e || "Ponte HTTP " + r.status);
    return;
  }
  const pasta = ler().obsidian.pasta || "Chefe Geral";
  if (!n.caminho.startsWith(pasta + "/")) throw new Error("Fora da pasta permitida");
  const existe = await rest("GET", "/vault/" + enc(n.caminho));
  if (existe.status !== 404) throw new Error("Nota já existe, não sobrescrevo");
  const r = await rest("PUT", "/vault/" + enc(n.caminho), n.md);
  if (!r.ok) throw new Error("Obsidian HTTP " + r.status);
  // Diário: acrescenta uma linha na nota do dia (só dentro de Chefe Geral/Diario).
  const linha = `- ${n.quando.slice(11, 16)} [[${n.caminho.replace(/\.md$/, "")}|${n.titulo}]]\n`;
  await rest("POST", "/vault/" + enc(`${pasta}/Diario/${n.quando.slice(0, 10)}.md`), linha).catch(() => {});
}
// Captura contínua: salva na fila do app e tenta gravar já no cofre.
export async function capturar(dados) {
  const c = ler().obsidian;
  if (!c.captura) return null;
  const m = montar(dados);
  const n = await salvar("memoria", {...m, titulo: dados.titulo, modulo: dados.modulo, status: "fila"});
  escrever(n).then(() => atualizar("memoria", n.id, x => x.status = "enviado"))
    .catch(e => atualizar("memoria", n.id, x => x.erro = e.message));
  return n;
}
export async function sincronizar() {
  const fila = await pagina("memoria", {limite: 200, filtro: n => n.status === "fila"});
  let ok = 0;
  for (const n of fila) { try { await escrever(n); await atualizar("memoria", n.id, x => { x.status = "enviado"; x.erro = null; }); ok++; } catch (e) { await atualizar("memoria", n.id, x => x.erro = e.message); } }
  return {ok, total: fila.length};
}
export function uriAbrir(n) {
  return `obsidian://open?vault=${encodeURIComponent(ler().obsidian.cofre)}&file=${encodeURIComponent(n.caminho.replace(/\.md$/, ""))}`;
}
export function uriNova(n) {
  const c = ler().obsidian;
  return `obsidian://new?vault=${encodeURIComponent(c.cofre)}&file=${encodeURIComponent(n.caminho.replace(/\.md$/, ""))}&content=${encodeURIComponent(n.md.slice(0, 6000))}`;
}
// Busca para contexto do motor: REST /search/simple quando disponível; senão, palavras-chave na fila local.
export async function buscarContexto(texto, max = 3) {
  const c = ler().obsidian;
  const termos = (texto || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 3).slice(0, 8);
  if (!termos.length) return [];
  if (!viaRest()) {
    try {
      const ac = new AbortController(); setTimeout(() => ac.abort(), 4000);
      const r = await fetch(ponte() + "/obsidian/busca?max=" + max + "&q=" + encodeURIComponent(termos.join(" ")), {signal: ac.signal});
      if (r.ok) { const j = await r.json(); if (j.resultados) return j.resultados.slice(0, max); }
    } catch {}
  } else {
    try {
      const r = await rest("POST", "/search/simple/?contextLength=160&query=" + encodeURIComponent(termos.join(" ")), null);
      if (r.ok) return (await r.json()).slice(0, max).map(x => ({arquivo: x.filename, score: x.score, trecho: (x.matches || []).map(m => m.context).join(" ... ").slice(0, 500), fonte: "obsidian"}));
    } catch {}
  }
  const loc = await pagina("memoria", {limite: 300});
  return loc.map(n => ({n, s: termos.filter(t => n.md.toLowerCase().includes(t)).length})).filter(x => x.s).sort((a, b) => b.s - a.s)
    .slice(0, max).map(({n, s}) => ({arquivo: n.caminho, score: s, trecho: n.md.replace(/^---[\s\S]*?---/, "").trim().slice(0, 500), fonte: "fila-do-app"}));
}
export async function testar() {
  if (!viaRest()) {
    let j;
    try { j = await (await fetch(ponte() + "/health")).json(); } catch { throw new Error("Ponte do Mac fora de alcance"); }
    const o = j.obsidian || {};
    if (!o.cofre_configurado) throw new Error("Ponte ligada, mas sem cofre. No Mac: ./scripts/set-obsidian.sh");
    if (o.cofre_nome && !ler().obsidian.cofre) gravar({obsidian: {cofre: o.cofre_nome}});
    return `Cofre ${o.cofre_nome} pela ponte do Mac (${o.notas_criadas} notas do Chefe Geral)`;
  }
  const r = await rest("GET", "/");
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json(); return j.authenticated ? "Conectado ao Obsidian" : "Obsidian respondeu, mas a chave não foi aceita";
}
