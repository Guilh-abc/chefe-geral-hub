// Segundo cérebro: notas na pasta "Chefe Geral" do cofre do Obsidian. Nunca altera notas existentes.
import {$, esc, quando, aviso} from "../core/ui.js";
import {salvar, pagina, contar} from "../core/db.js";
import {ler} from "../core/config.js";

export default async function abrir(el) {
  const c = ler();
  let filtro = "fila", ultimo = null;
  el.innerHTML = `<div class="etapas"><span class="on">1. Captura</span><span>2. Fila no aparelho</span><span>3. Cofre: Chefe Geral/</span><span>4. Contexto</span></div>
    <div class="card"><h3>Obsidian <span class="pill" id="obst">verificando...</span></h3>
      <p class="muted small">Cofre no Mac: <code>~/Documents/Obsidian</code>${c.obsidian.cofre ? " (" + esc(c.obsidian.cofre) + ")" : ""}. O app só cria notas novas em <b>${esc(c.obsidian.pasta)}/</b> (a pasta nasce na primeira gravação) e nunca mexe nas outras notas.</p>
      <div class="row-btn"><button class="primary" id="osync">Sincronizar fila</button><button class="ghost" id="oimp">Trazer capturas do Telegram (ponte)</button><button class="ghost" id="oexp">Baixar fila (.md)</button></div>
      <p class="muted small" id="ores"></p></div>
    <form class="card" id="obf"><h3>Buscar no segundo cérebro</h3><div class="linha" style="margin-top:0"><input id="obq" placeholder="Ex.: Lightera roteador"><button class="ghost">Buscar</button></div><div id="obr"></div>
      <p class="muted small">É a mesma busca que vai junto com cada pedido no campo obsidian_context.</p></form>
    <div class="chips"><button class="chip on" data-f="fila">Na fila</button><button class="chip" data-f="enviado">No cofre</button><button class="chip" data-f="todos">Todas</button></div>
    <div id="ol"></div><button class="ghost mais" id="om" hidden>Carregar mais</button>`;
  import("../memory/obsidian.js").then(m => m.testar()).then(t => { const p = $("#obst", el); p.className = "pill ok"; p.textContent = t; })
    .catch(() => { const p = $("#obst", el); if (p) { p.className = "pill no"; p.textContent = c.obsidian.chave ? "sem conexão (Mac/Obsidian fechado?)" : "não conectado: notas ficam na fila"; } });
  const item = n => `<div class="item"><div class="item-h"><span class="st ${n.status === "enviado" ? "concluido" : n.erro ? "erro" : "fila"}"></span><div class="item-t">${esc(n.titulo)}
    <div class="item-m">${quando(n.criado_em)} · ${esc(n.caminho)}${n.erro ? " · " + esc(n.erro) : ""}</div></div></div>
    <div class="acoes">${c.obsidian.cofre ? `<a class="tg" style="background:#7c3aed" href="${esc(n.status === "enviado" ? uri.abrir(n) : uri.nova(n))}">${n.status === "enviado" ? "Abrir no Obsidian" : "Criar no Obsidian"}</a>` : ""}</div></div>`;
  const uri = {};
  const mem = await import("../memory/obsidian.js"); uri.abrir = mem.uriAbrir; uri.nova = mem.uriNova;
  async function carregar(reset) {
    if (reset) { ultimo = null; $("#ol", el).innerHTML = ""; }
    const f = filtro === "todos" ? null : n => n.status === filtro;
    const ns = await pagina("memoria", {limite: 20, antes: ultimo, filtro: f});
    if (ns.length) ultimo = ns.at(-1).criado_em;
    $("#ol", el).insertAdjacentHTML("beforeend", ns.map(item).join(""));
    if (reset && !ns.length) $("#ol", el).innerHTML = `<div class="vazio">Nada aqui.</div>`;
    $("#om", el).hidden = ns.length < 20;
    $("#ores", el).textContent = (await contar("memoria", n => n.status === "fila")) + " nota(s) na fila deste aparelho.";
  }
  $("#obf", el).onsubmit = async e => {
    e.preventDefault();
    const r = await mem.buscarContexto($("#obq", el).value, 5);
    $("#obr", el).innerHTML = r.length ? r.map(x => `<div class="item"><div class="item-t"><b>${esc(x.arquivo)}</b><div class="item-m">${esc(x.trecho)}</div><div class="item-m">${x.fonte === "obsidian" ? "do cofre" : "da fila do app"}</div></div></div>`).join("") : `<p class="muted small">Nada encontrado.</p>`;
  };
  el.addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.f) { filtro = b.dataset.f; el.querySelectorAll("[data-f]").forEach(x => x.classList.toggle("on", x === b)); return carregar(true); }
    if (b.id === "om") return carregar(false);
    if (b.id === "osync") { try { const r = await mem.sincronizar(); aviso(`${r.ok} de ${r.total} notas gravadas no cofre`); } catch (err) { aviso(err.message, true); } return carregar(true); }
    if (b.id === "oimp") {
      try {
        const base = c.grok.ponte.replace(/\/$/, "");
        const j = await (await fetch(base + "/memoria")).json();
        for (const n of j.notas) await salvar("memoria", {id: n.id, caminho: n.caminho, md: n.md, titulo: n.titulo, modulo: n.modulo, quando: n.quando, criado_em: n.quando, status: "fila"});
        if (j.notas.length) await fetch(base + "/memoria/ok", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ids: j.notas.map(n => n.id)})});
        aviso(j.notas.length + " captura(s) do Telegram trazidas para a fila"); return carregar(true);
      } catch { return aviso("Ponte do Mac fora de alcance", true); }
    }
    if (b.id === "oexp") {
      const ns = await pagina("memoria", {limite: 1000, filtro: n => n.status === "fila"});
      const txt = ns.map(n => `<!-- ${n.caminho} -->\n${n.md}`).join("\n\n");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], {type: "text/markdown"})); a.download = "chefe-geral-fila.md"; a.click();
    }
  });
  await carregar(true);
}
