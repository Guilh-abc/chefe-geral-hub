// Módulo Pedidos: cada pedido com as 7 camadas. Lista paginada, com arquivamento.
import {$, esc, quando, aviso, STATUS} from "../core/ui.js";
import {pagina, pegar, atualizar, arquivarAntigos} from "../core/db.js";
import {CAMADAS, marcar, enviarAoMotor} from "../core/pipeline.js";

import {linkTelegram} from "../engines/grok-webhook.js";
import {emCelular, abrirBot, linkBot, BOT, cartaoBot} from "../core/aparelho.js";
import {agoraISO} from "../core/db.js";
const TG = p => linkTelegram(p, p.extra || {});
const FILTROS = {abertos: ["Abertos", p => p.status === "fila" || p.status === "andamento"], erro: ["Com erro", p => p.status === "erro"],
  concluido: ["Concluídos", p => p.status === "concluido"], todos: ["Todos", null]};

export default async function abrir(el) {
  let filtro = "abertos", ultimo = null;
  el.innerHTML = (emCelular() ? cartaoBot("No celular, os pedidos vão pelo Telegram", `Faça o pedido na tela inicial: o app abre o @${BOT()} com o texto pronto e você toca em Enviar. A lista abaixo é o registro deste aparelho; a resposta chega no bot e fica no Obsidian.`) : "") + `<div class="chips" id="pf"></div><div id="pl"></div><button class="ghost mais" id="pm" hidden>Carregar mais</button>
    <div class="row-btn"><button class="ghost" id="parq">Arquivar concluídos há mais de 30 dias</button></div>
    <h2 class="sec">Atalhos por vertente</h2><div id="pv" class="muted small">Carregando...</div>`;
  const chips = () => $("#pf", el).innerHTML = Object.entries(FILTROS).map(([k, [n]]) => `<button class="chip ${k === filtro ? "on" : ""}" data-f="${k}">${n}</button>`).join("");
  const item = p => {
    const n = p.camada || 1;
    return `<div class="item" data-id="${p.id}"><div class="item-h"><span class="st ${p.status}"></span><div class="item-t">${esc(p.texto)}
      <div class="item-m">${STATUS[p.status] || p.status} · ${quando(p.criado_em)} · ${p.motor === "ollama" ? "Motor 2" : "Chefe Geral"}${p.vertente ? " · " + esc(p.vertente) : ""}</div></div></div>
      <div class="camadas ${p.status}">${CAMADAS.map((c, i) => `<span class="${i < n ? "on" : ""}" title="${c}"></span>`).join("")}</div>
      <div class="camada-n">Camada ${n} de 7: ${CAMADAS[n - 1]}${p.historico?.at(-1)?.nota ? " · " + esc(p.historico.at(-1).nota) : ""}</div>
      ${p.resposta ? `<div class="resposta">${esc(p.resposta)}</div>` : ""}
      ${p.entrega?.estado === "aguardando_ponte" && p.status === "fila" ? `<div class="nota-ponte">Esperando o Mac. Vai sozinho quando a ponte ligar.</div>` : ""}
      ${p.entrega?.estado === "telegram" && p.status === "andamento" ? `<div class="small muted" style="margin-top:6px">Foi pelo @${BOT()}. A resposta chega no Telegram e no Obsidian.</div>` : ""}
      <div class="acoes">
        ${p.status === "erro" || p.status === "fila" ? `<button data-a="enviar">${emCelular() ? "Enviar pelo Telegram" : "Enviar de novo"}</button>` : ""}
        ${p.entrega?.estado === "telegram" && p.status === "andamento" && TG(p) ? `<a class="tg" href="${esc(TG(p))}" target="_blank" rel="noopener">Abrir no Telegram de novo</a>` : ""}
        ${p.status === "fila" && p.entrega?.estado === "aguardando_ponte" ? (TG(p) ? `<a class="tg" href="${esc(TG(p))}" target="_blank" rel="noopener">Abrir no Telegram</a>` : `<button data-a="tgcfg">Abrir no Telegram</button>`) : ""}
        ${p.status === "andamento" ? `<button data-a="c5">Ele pediu meu OK</button><button data-a="c6">Executando</button>` : ""}
        ${p.status !== "concluido" && p.status !== "cancelado" ? `<button data-a="ok">Concluído</button><button data-a="cancelar">Cancelar</button>` : `<button data-a="arquivar">Arquivar</button>`}
        <button data-a="copiar">Copiar</button>
      </div></div>`;
  };
  async function carregar(reset) {
    if (reset) { ultimo = null; $("#pl", el).innerHTML = ""; }
    const ps = await pagina("pedidos", {limite: 15, antes: ultimo, filtro: FILTROS[filtro][1]});
    if (ps.length) ultimo = ps.at(-1).criado_em;
    $("#pl", el).insertAdjacentHTML("beforeend", ps.map(item).join(""));
    if (reset && !ps.length) $("#pl", el).innerHTML = `<div class="vazio">Nada aqui. Faça um pedido na tela inicial.</div>`;
    $("#pm", el).hidden = ps.length < 15;
  }
  el.addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.f) { filtro = b.dataset.f; chips(); return carregar(true); }
    if (b.id === "pm") return carregar(false);
    if (b.id === "parq") { const n = await arquivarAntigos("pedidos", 30); aviso(n + " pedido(s) arquivado(s)"); return carregar(true); }
    if (b.dataset.atalho) { location.hash = ""; setTimeout(() => { const t = document.querySelector("#fala"); t.value = b.dataset.atalho + ": "; t.focus(); }, 50); return; }
    const id = b.closest("[data-id]")?.dataset.id; if (!id) return;
    const a = b.dataset.a;
    if (a === "enviar" && emCelular()) {
      // Abre o bot no mesmo toque (o texto do pedido está na tela), depois marca o registro local.
      const t = b.closest(".item").querySelector(".item-t").firstChild.textContent.trim();
      if (!linkBot(t)) navigator.clipboard?.writeText(t).catch(() => {});
      abrirBot(t);
      await atualizar("pedidos", id, x => { x.entrega = {estado: "telegram", em: agoraISO()}; });
      await marcar(id, {camada: 4, status: "andamento", nota: "Aberto no @" + BOT() + " com o texto pronto. Toque em Enviar no Telegram."});
      aviso(linkBot(t) ? "Abrindo o Telegram: toque em Enviar lá." : "Texto longo: copiei. Cole no chat do bot e envie.");
      return carregar(true);
    }
    if (a === "enviar") { const p = await pegar("pedidos", id); aviso("Enviando..."); const r = await enviarAoMotor(p); aviso(r.status === "erro" ? r.historico.at(-1).nota : "Enviado", r.status === "erro"); }
    if (a === "tgcfg") return aviso("Informe o usuário do seu bot em Canais > Telegram (ou o pedido é grande demais para link).", true);
    if (a === "c5") await marcar(id, {camada: 5, nota: "Chefe Geral pediu seu OK no chat"});
    if (a === "c6") await marcar(id, {camada: 6, nota: "Em execução nas ferramentas"});
    if (a === "ok") await marcar(id, {camada: 7, status: "concluido", nota: "Marcado como concluído"});
    if (a === "cancelar") await marcar(id, {status: "cancelado", nota: "Cancelado por você"});
    if (a === "arquivar") await atualizar("pedidos", id, p => p.arquivado = true);
    if (a === "copiar") { const t = b.closest(".item").querySelector(".item-t").firstChild.textContent.trim(); await navigator.clipboard?.writeText(t); return aviso("Copiado"); }
    carregar(true);
  });
  chips(); await carregar(true);
  fetch("./data/vertentes.json").then(r => r.json()).then(d => {
    $("#pv", el).innerHTML = d.grupos.map(g => `<div class="sec" style="margin-top:12px">${esc(g.nome)}</div><div class="chips">${d.vertentes.filter(v => v.grupo === g.id)
      .flatMap(v => (v.atalhos || []).slice(0, 2).map(a => `<button class="chip" data-atalho="${esc(a)}" title="${esc(v.nome)}: ${esc(v.ferramentas.join(", "))}">${esc(a)}</button>`)).join("")}</div>`).join("");
  }).catch(() => $("#pv", el).textContent = "");
}
