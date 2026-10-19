// Tarefas: lista do dia no aparelho. Pedir ajuda ao Chefe Geral é opcional e passa pelo motor escolhido.
import {$, esc, aviso} from "../core/ui.js";
import {salvar, pagina, pegar, atualizar, arquivarAntigos, agoraISO} from "../core/db.js";
import {ler} from "../core/config.js";

const hoje = () => agoraISO().slice(0, 10);
const FILTROS = {
  hoje: ["Hoje", t => t.status !== "feita" && (!t.prazo || t.prazo <= hoje())],
  proximas: ["Próximas", t => t.status !== "feita" && t.prazo > hoje()],
  todas: ["Abertas", t => t.status !== "feita"],
  feitas: ["Feitas", t => t.status === "feita"],
};
export default async function abrir(el) {
  let filtro = "hoje", ultimo = null;
  el.innerHTML = `<form class="card" id="tf" autocomplete="off"><div class="linha" style="margin-top:0"><input id="tt" placeholder="Nova tarefa" required><button class="primary">Adicionar</button></div>
    <div class="linha"><input id="tp" type="date" aria-label="Prazo"><select id="tpr" aria-label="Prioridade"><option value="2">Normal</option><option value="1">Alta</option><option value="3">Baixa</option></select></div></form>
    <div class="chips" id="tfl"></div><div id="tl"></div><button class="ghost mais" id="tm" hidden>Carregar mais</button>
    <div class="row-btn"><button class="ghost" id="tarq">Arquivar feitas há mais de 30 dias</button></div>`;
  const chips = () => $("#tfl", el).innerHTML = Object.entries(FILTROS).map(([k, [n]]) => `<button class="chip ${k === filtro ? "on" : ""}" data-f="${k}">${n}</button>`).join("");
  const item = t => {
    const atras = t.status !== "feita" && t.prazo && t.prazo < hoje();
    return `<div class="item" data-id="${t.id}"><div class="item-h"><input type="checkbox" class="tchk" ${t.status === "feita" ? "checked" : ""} aria-label="Feita" style="width:22px;height:22px;accent-color:var(--a);margin-top:2px">
      <div class="item-t" style="${t.status === "feita" ? "text-decoration:line-through;color:var(--m)" : ""}">${esc(t.titulo)}
      <div class="item-m">${t.prioridade === 1 ? "<b style='color:#fca5a5'>Alta</b> · " : ""}${t.prazo ? (atras ? "<b style='color:#fca5a5'>Atrasada</b> " : "") + t.prazo.split("-").reverse().slice(0, 2).join("/") : "Sem prazo"}${t.origem ? " · " + esc(t.origem) : ""}${t.pedido ? " · pedido ao Chefe Geral" : ""}</div></div></div>
      ${t.status !== "feita" ? `<div class="acoes"><button data-a="ajuda">Pedir ao Chefe Geral</button><button data-a="amanha">Para amanhã</button></div>` : ""}</div>`;
  };
  async function carregar(reset) {
    if (reset) { ultimo = null; $("#tl", el).innerHTML = ""; }
    const ts = await pagina("tarefas", {limite: 20, antes: ultimo, filtro: FILTROS[filtro][1]});
    if (ts.length) ultimo = ts.at(-1).criado_em;
    ts.sort((a, b) => (a.prioridade || 2) - (b.prioridade || 2));
    $("#tl", el).insertAdjacentHTML("beforeend", ts.map(item).join(""));
    if (reset && !ts.length) $("#tl", el).innerHTML = `<div class="vazio">Nada aqui.</div>`;
    $("#tm", el).hidden = ts.length < 20;
  }
  $("#tf", el).onsubmit = async e => {
    e.preventDefault();
    const t = await salvar("tarefas", {titulo: $("#tt", el).value.trim(), prazo: $("#tp", el).value || null, prioridade: +$("#tpr", el).value, status: "aberta", origem: "app"});
    $("#tt", el).value = "";
    import("../memory/obsidian.js").then(m => m.capturar({modulo: "tarefas", titulo: t.titulo, corpo: `- [ ] ${t.titulo}${t.prazo ? " 📅 " + t.prazo : ""}`, id: t.id, tags: ["tarefa"]})).catch(() => {});
    carregar(true);
  };
  el.addEventListener("change", async e => {
    if (!e.target.classList.contains("tchk")) return;
    const id = e.target.closest("[data-id]").dataset.id;
    await atualizar("tarefas", id, t => { t.status = e.target.checked ? "feita" : "aberta"; t.feita_em = e.target.checked ? agoraISO() : null; });
    setTimeout(() => carregar(true), 250);
  });
  el.addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.f) { filtro = b.dataset.f; chips(); return carregar(true); }
    if (b.id === "tm") return carregar(false);
    if (b.id === "tarq") { const n = await arquivarAntigos("tarefas", 30, ["feita"]); aviso(n + " tarefa(s) arquivada(s)"); return carregar(true); }
    const id = b.closest("[data-id]")?.dataset.id; if (!id) return;
    if (b.dataset.a === "amanha") { const d = new Date(Date.now() + 864e5 - 3 * 3600e3).toISOString().slice(0, 10); await atualizar("tarefas", id, t => t.prazo = d); return carregar(true); }
    if (b.dataset.a === "ajuda") {
      const t = await pegar("tarefas", id);
      const {novoPedido, enviarAoMotor} = await import("../core/pipeline.js");
      const p = await novoPedido({texto: "Me ajude com esta tarefa: " + t.titulo + (t.prazo ? " (prazo " + t.prazo + ")" : ""), canal: "tarefas", modulo: "tarefas", motor: ler().motor});
      await atualizar("tarefas", id, x => x.pedido = p.id);
      const r = await enviarAoMotor(p);
      aviso(r.status === "erro" ? r.historico.at(-1).nota : r.entrega?.estado === "aguardando_ponte" ? "Na fila: vai quando o Mac estiver ligado" : "Pedido enviado ao Chefe Geral", r.status === "erro");
      return carregar(true);
    }
  });
  chips(); await carregar(true);
}
