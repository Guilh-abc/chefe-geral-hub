// Mensagens: só Telegram. Entrada = o que você manda ao seu bot (a Ponte do Mac lê e repassa ao Chefe Geral).
// Saída = só para o seu chat, depois do seu toque em Enviar.
import {$, esc, quando, aviso} from "../core/ui.js";
import {salvar, pagina} from "../core/db.js";
import {ler} from "../core/config.js";
import {confirmar} from "../core/gate.js";

export default async function abrir(el) {
  const c = ler(), pronto = c.telegram.token && c.telegram.chat_id;
  el.innerHTML = `<div class="etapas"><span class="on">1. Você fala com o bot</span><span>2. Ponte do Mac pega</span><span>3. Chefe Geral executa</span></div>
    <div class="card"><h3>Recebidas pelo bot</h3><p class="muted small">Mande texto ou nota de voz ao seu bot no Telegram. Com o Mac ligado, a ponte transforma em pedido na hora e responde "Recebido". Com o Mac desligado, o Telegram guarda por até 24 horas e a ponte pega quando o Mac voltar. Use <code>/reuniao</code> na legenda de um áudio ou .txt para pedir o resumo de reunião.</p>
      <div id="me"><p class="muted small">Consultando a ponte...</p></div></div>
    <form class="card" id="mf"><h3>Escrever para o meu Telegram</h3><textarea id="mt" rows="3" placeholder="Ex.: lembrete para amanhã cedo"></textarea>
      <div class="row-btn"><button class="primary" ${pronto ? "" : "disabled"}>Revisar e enviar</button></div>
      <p class="muted small">${pronto ? "Vai só para o seu chat (" + esc(c.telegram.chat_id) + "). Acima de 4096 caracteres vira arquivo .md." : "Configure token e chat_id em Canais > Telegram."}</p></form>
    <h2 class="sec">Enviadas por aqui</h2><div id="ms"></div>`;
  async function entrada() {
    const base = c.grok.ponte.replace(/\/$/, "");
    try {
      const r = await fetch(base + "/mensagens?limite=30"); const j = await r.json();
      $("#me", el).innerHTML = j.mensagens.length ? j.mensagens.map(m => `<div class="item"><div class="item-h"><span class="st concluido"></span><div class="item-t">${m.midia ? "🎙 " : ""}${esc(m.texto)}<div class="item-m">${quando(m.quando)} · ${m.tipo === "reuniao_resumo" ? "Resumo de reunião" : "Pedido"} repassado ao Chefe Geral</div></div></div><div class="acoes"><button data-tarefa="${esc(m.texto.slice(0, 200))}">Virar tarefa</button></div></div>`).join("")
        : `<div class="vazio">Nada recebido ainda.</div>`;
    } catch { $("#me", el).innerHTML = `<p class="nota-ponte">Ponte do Mac fora de alcance (no celular é normal). O que você mandar ao bot fica guardado no Telegram e é processado quando o Mac ligar.</p>`; }
  }
  async function saida() {
    const ms = await pagina("mensagens", {limite: 20, filtro: m => m.direcao === "saida"});
    $("#ms", el).innerHTML = ms.length ? ms.map(m => `<div class="item"><div class="item-h"><span class="st enviado"></span><div class="item-t">${esc(m.texto)}<div class="item-m">Enviada · ${quando(m.criado_em)}</div></div></div></div>`).join("") : `<div class="vazio">Nada enviado ainda.</div>`;
  }
  $("#mf", el).onsubmit = async e => {
    e.preventDefault();
    const t = $("#mt", el).value.trim(); if (!t) return;
    if (!await confirmar({titulo: "Enviar no seu Telegram?", para: "Seu chat (" + c.telegram.chat_id + ")", conteudo: t})) return aviso("Nada foi enviado.");
    try { await (await import("../channels/telegram.js")).enviarTexto(t); await salvar("mensagens", {direcao: "saida", texto: t, status: "enviado"}); $("#mt", el).value = ""; aviso("Enviado."); saida(); }
    catch (err) { aviso(err.message, true); }
  };
  el.addEventListener("click", async e => {
    const b = e.target.closest("button[data-tarefa]"); if (!b) return;
    await salvar("tarefas", {titulo: b.dataset.tarefa, status: "aberta", origem: "telegram"}); aviso("Tarefa criada");
  });
  entrada(); saida();
}
