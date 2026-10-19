// Casca do app: casa (início), cartões dos cômodos (módulos) e roteador. Módulos carregam sob demanda.
import {$, $$, esc, aviso, quando} from "./ui.js";
import {ler} from "./config.js";
import {contar, pagina} from "./db.js";
import {CAMADAS, novoPedido, enviarAoMotor} from "./pipeline.js";

const I = {
  pedidos: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  reunioes: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8"/>',
  agenda: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  mensagens: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
  tarefas: '<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  notas: '<path d="M2 12h2M6 8v8M10 4v16M14 7v10M18 10v4M22 12h0"/>',
  memoria: '<path d="M12 5a3 3 0 1 0-5.9.8A4 4 0 0 0 4 13a4 4 0 0 0 4 4h0a3 3 0 0 0 4 2.8M12 5a3 3 0 1 1 5.9.8A4 4 0 0 1 20 13a4 4 0 0 1-4 4h0a3 3 0 0 1-4 2.8M12 5v14.8"/>',
  arquivo: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  canais: '<path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
  casa: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/>',
};
export const ico = (n, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24">${I[n] || ""}</svg>`;

// Registro dos cômodos. "pronto: false" = cartão aparece, módulo chega na próxima versão.
export const MODULOS = [
  {id: "pedidos", nome: "Pedidos", desc: "Penso, falo, executo: o Chefe Geral faz nas suas ferramentas.", canais: ["App", "Voz"], motor: true, pronto: true,
    resumo: async () => ({fila: await contar("pedidos", p => !p.arquivado && (p.status === "fila" || p.status === "andamento")), erro: await contar("pedidos", p => !p.arquivado && p.status === "erro")})},
  {id: "reunioes", nome: "Reuniões", desc: "Grava, transcreve e gera o feedback de amigo. Você revisa e manda no seu Telegram.", canais: ["Microfone", "Telegram"], motor: true, pronto: true,
    resumo: async () => ({fila: await contar("reunioes", r => !r.arquivado && r.status !== "enviado"), erro: 0})},
  {id: "agenda", nome: "Agenda", desc: "Monte o evento e grave no Google ou Outlook com o seu toque, ou peça ao Chefe Geral.", canais: ["Google Calendar", "Microsoft 365"], pronto: true,
    resumo: async () => ({fila: await contar("eventos", e => e.status !== "gravado"), erro: 0})},
  {id: "mensagens", nome: "Mensagens", desc: "O que você manda ao seu bot e o que sai para o seu chat. Nada sai sem você tocar em Enviar.", canais: ["Telegram", "Ponte do Mac"], pronto: true},
  {id: "tarefas", nome: "Tarefas", desc: "Lista do dia e prazos. Peça ajuda ao Chefe Geral em qualquer tarefa.", canais: ["App"], pronto: true,
    resumo: async () => { const h = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); return {fila: await contar("tarefas", t => !t.arquivado && t.status !== "feita" && (!t.prazo || t.prazo <= h)), erro: await contar("tarefas", t => t.status !== "feita" && t.prazo && t.prazo < h)}; }},
  {id: "notas", nome: "Notas de voz", desc: "Fale uma ideia e ela vira pedido, tarefa ou nota no Obsidian. O áudio fica no aparelho.", canais: ["Microfone", "Telegram"], pronto: true,
    resumo: async () => ({fila: await contar("notas", n => n.status === "nova"), erro: 0})},
  {id: "memoria", nome: "Segundo cérebro", desc: "Tudo vira nota no Obsidian, na pasta Chefe Geral, e volta como contexto.", canais: ["Obsidian"], pronto: true,
    resumo: async () => ({fila: await contar("memoria", n => n.status === "fila"), erro: 0})},
  {id: "arquivo", nome: "Arquivo", desc: "Viewer de tudo que o Chefe Geral cria: documentos, mensagens, transcrições e o Obsidian, com o caminho no Mac.", canais: ["Ponte do Mac", "Este aparelho"], pronto: true},
  {id: "canais", nome: "Canais e motores", desc: "Webhook do Chefe Geral, Telegram, Obsidian e Motor 2 (Ollama).", canais: ["Ajustes"], pronto: true,
    resumo: async () => { const c = ler(); const falta = [!c.grok.url && "webhook", !c.telegram.chat_id && "Telegram", c.obsidian.via === "rest" && !c.obsidian.chave && "Obsidian"].filter(Boolean); return {texto: falta.length ? "Falta: " + falta.join(", ") : "Tudo configurado", alerta: falta.length > 0}; }},
];
const NAV = ["inicio", "pedidos", "reunioes", "arquivo", "tarefas", "canais"];

async function cartoes() {
  const el = $("#cartoes");
  el.innerHTML = MODULOS.map(m => `<button class="mod ${m.pronto ? "" : "breve"}" data-ir="${m.id}"><span class="mod-i">${ico(m.id)}</span>
    <span class="mod-b"><b>${m.nome}</b><small>${m.desc}</small><span class="mod-c">${m.canais.map(c => `<i>${c}</i>`).join("")}</span></span>
    <span class="mod-s" id="s-${m.id}">${m.pronto ? "" : "<em>em breve</em>"}</span></button>`).join("");
  for (const m of MODULOS) if (m.resumo) m.resumo().then(r => {
    const s = $("#s-" + m.id); if (!s) return;
    s.innerHTML = r.texto ? `<em class="${r.alerta ? "warn" : "ok"}">${esc(r.texto)}</em>` : (r.erro ? `<em class="err">${r.erro} erro</em>` : "") + (r.fila ? `<em>${r.fila} aberto${r.fila > 1 ? "s" : ""}</em>` : (r.erro ? "" : `<em class="ok">em dia</em>`));
  }).catch(() => {});
}

async function recentes() {
  const ps = await pagina("pedidos", {limite: 3});
  $("#recentes").innerHTML = ps.length ? ps.map(p => `<button class="rec" data-ir="pedidos"><span class="st ${p.status}"></span><span class="rec-t">${esc(p.texto)}</span><small>${CAMADAS[(p.camada || 1) - 1]} · ${quando(p.criado_em)}</small></button>`).join("") : "";
}

// Entrada principal: texto ou voz.
let gravador = null;
async function microfone() {
  const b = $("#mic"), t = $("#fala");
  if (gravador) { const g = gravador; gravador = null; b.classList.remove("on"); await g.parar(); return; }
  const {criarGravador, temTranscricao} = await import("./voz.js");
  if (!temTranscricao()) return aviso("Este navegador não transcreve voz. Use o ditado do teclado (ícone de microfone) e toque em Pedir.", true);
  const base = t.value ? t.value.trim() + " " : "";
  gravador = criarGravador({gravarAudio: false, aoTexto: x => t.value = base + x, aoParcial: x => $("#parcial").textContent = x, aoErro: e => aviso(e, true)});
  b.classList.add("on");
  try { await gravador.iniciar(); } catch (e) { gravador = null; b.classList.remove("on"); aviso("Microfone bloqueado: " + e.message, true); }
}
async function pedir(e) {
  e.preventDefault();
  if (gravador) await microfone();
  const texto = $("#fala").value.trim(); if (!texto) return $("#fala").focus();
  const motor = $("#motor").value;
  const p = await novoPedido({texto, canal: "app", motor});
  $("#fala").value = ""; $("#parcial").textContent = "";
  import("../memory/obsidian.js").then(m => m.capturar({modulo: "pedidos", titulo: texto.slice(0, 60), corpo: texto, id: p.id})).catch(() => {});
  aviso("Pedido na fila. Enviando ao " + (motor === "ollama" ? "Motor 2" : "Chefe Geral") + "...");
  recentes();
  const r = await enviarAoMotor(p);
  const espera = r.entrega?.estado === "aguardando_ponte";
  aviso(r.status === "erro" ? "Não foi: " + r.historico.at(-1).nota : espera ? "Mac fora de alcance: pedido na fila. Em Pedidos dá para mandar pelo Telegram." : r.status === "concluido" ? "Motor 2 respondeu. Veja em Pedidos." : "Entregue ao Chefe Geral. A resposta chega no chat ou no Telegram.", r.status === "erro");
  verPonte();
  recentes(); cartoes();
}

// Ponte do Mac: indicador e reenvio automático da fila quando ela liga.
let ponteAntes = null;
async function verPonte() {
  const c = ler().grok, b = $("#ponte");
  if (c.modo !== "ponte") { b.hidden = true; return; }
  const {saude} = await import("../engines/grok-webhook.js");
  const s = await saude();
  b.hidden = false; b.className = "ponte " + (s.ligada ? "on" : "off");
  b.querySelector("span").textContent = "Ponte do Mac: " + (s.ligada ? "ligada" : "desligada");
  $("#dica").textContent = s.ligada
    ? "Vai para o Chefe Geral pela ponte do Mac. Ele executa nas suas ferramentas e pede o seu OK antes de mandar algo a alguém ou mexer na agenda."
    : "Ponte do Mac desligada (no celular é normal). O pedido fica na fila e vai sozinho quando o Mac estiver ligado. Para ir já, use \"Abrir no Telegram\" em Pedidos.";
  if (s.ligada && ponteAntes !== true) {
    const {reenviarFila} = await import("./pipeline.js");
    const n = await reenviarFila();
    if (n) { aviso(n + " pedido(s) da fila entregue(s) ao Chefe Geral"); recentes(); }
    import("../memory/obsidian.js").then(m => m.sincronizar()).catch(() => {});
  }
  ponteAntes = s.ligada;
}

// Roteador por hash. Módulos são import() só quando abertos.
async function rota() {
  const id = location.hash.replace(/^#\/?/, "") || "inicio";
  $$("[data-ir]").forEach(b => b.classList.toggle("ativo", b.dataset.ir === id && b.closest(".tabs")));
  document.body.classList.toggle("em-mod", id !== "inicio");
  $$(".tela").forEach(t => t.hidden = t.id !== (id === "inicio" ? "tela-inicio" : "tela-mod"));
  $("#main").scrollTop = 0;
  if (id === "inicio") { $("#titulo").textContent = "Chefe Geral"; $("#motor").value = ler().motor; cartoes(); recentes(); return; }
  const m = MODULOS.find(x => x.id === id);
  if (!m) return location.hash = "";
  $("#titulo").textContent = m.nome;
  const el = $("#tela-mod");
  if (!m.pronto) { el.innerHTML = `<div class="card"><p><b>${m.nome}</b> chega na próxima versão.</p><p class="muted">${m.desc}</p><p class="muted small">Enquanto isso, peça pela tela inicial: o Chefe Geral já faz isso pelas suas ferramentas.</p></div>`; return; }
  el.innerHTML = `<p class="muted carregando">Abrindo...</p>`;
  try { const mod = await import(`../modules/${id}.js`); const box = document.createElement("div"); box.className = "modulo"; el.replaceChildren(box); await mod.default(box); }
  catch (e) { el.innerHTML = `<div class="card err-box">Não abriu o módulo: ${esc(e.message)}</div>`; }
}

document.addEventListener("click", e => { const b = e.target.closest("[data-ir]"); if (b) { location.hash = b.dataset.ir === "inicio" ? "" : "/" + b.dataset.ir; } });
$("#mic").addEventListener("click", microfone);
$("#form-pedir").addEventListener("submit", pedir);
$("#fala").addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("#form-pedir").requestSubmit(); });
$(".tabs").innerHTML = NAV.map(id => `<button data-ir="${id}">${ico(id === "inicio" ? "casa" : id)}<span>${id === "inicio" ? "Início" : MODULOS.find(m => m.id === id).nome.split(" ")[0]}</span></button>`).join("");
addEventListener("hashchange", rota);
rota();
verPonte(); setInterval(verPonte, 20000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) verPonte(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
