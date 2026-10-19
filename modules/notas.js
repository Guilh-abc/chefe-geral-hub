// Notas de voz: fale uma ideia. O áudio fica neste aparelho (IndexedDB); nada sobe sozinho.
// Transcrição: ao vivo pelo navegador (pt-BR) quando disponível. Transcrição no Mac: aguardando a escolha do motor.
import {$, esc, quando, aviso} from "../core/ui.js";
import {salvar, pagina, pegar, atualizar, apagar, agoraISO} from "../core/db.js";
import {ler} from "../core/config.js";
import {criarGravador, temTranscricao, temGravacao} from "../core/voz.js";

export default async function abrir(el) {
  let grav = null, ultimo = null, inicio = 0, relogio = null;
  el.innerHTML = `<div class="card grava">
      <button class="mic" id="ng" aria-label="Gravar nota"><svg viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/></svg></button>
      <b id="nst">Toque e fale uma ideia</b><div class="tempo" id="nt" hidden>00:00</div>
      <div class="transc" id="nx" hidden></div>
      <p class="muted small">${temGravacao() ? "O áudio fica só neste aparelho." : "Este navegador não grava áudio."} ${temTranscricao() ? "Transcrição ao vivo em português." : "Sem transcrição ao vivo aqui."}</p></div>
    <h2 class="sec">Notas</h2><div id="nl"></div><button class="ghost mais" id="nm" hidden>Carregar mais</button>`;
  const item = n => `<div class="item" data-id="${n.id}"><div class="item-h"><span class="st ${n.status === "tratada" ? "concluido" : "fila"}"></span><div class="item-t">${esc(n.texto || "(sem transcrição)")}
    <div class="item-m">${quando(n.criado_em)}${n.duracao_s ? " · " + n.duracao_s + " s" : ""}${n.origem ? " · " + esc(n.origem) : ""}${n.destino ? " · " + esc(n.destino) : ""}</div></div></div>
    <div class="acoes">${n.audio ? `<button data-a="ouvir">Ouvir</button>` : ""}${n.texto ? `<button data-a="pedido">Virar pedido</button><button data-a="tarefa">Virar tarefa</button>` : ""}
      <button data-a="editar">Editar texto</button>${n.audio ? `<button data-a="mac">Transcrever no Mac</button>` : ""}<button data-a="apagar">Apagar</button></div></div>`;
  async function carregar(reset) {
    if (reset) { ultimo = null; $("#nl", el).innerHTML = ""; }
    const ns = await pagina("notas", {limite: 15, antes: ultimo});
    if (ns.length) ultimo = ns.at(-1).criado_em;
    $("#nl", el).insertAdjacentHTML("beforeend", ns.map(item).join(""));
    if (reset && !ns.length) $("#nl", el).innerHTML = `<div class="vazio">Nenhuma nota ainda.</div>`;
    $("#nm", el).hidden = ns.length < 15;
  }
  async function alternar() {
    const b = $("#ng", el);
    if (grav) {
      clearInterval(relogio); b.classList.remove("on");
      const {texto, audio} = await grav.parar(); grav = null;
      const id = "n" + Date.now().toString(36);
      if (audio) await salvar("blobs", {id: id + "-audio", blob: audio, criado_em: agoraISO()});
      const n = await salvar("notas", {id, titulo: "Nota " + quando(agoraISO()), texto, audio: audio ? id + "-audio" : null, duracao_s: Math.round((Date.now() - inicio) / 1000), status: "nova", origem: "app"});
      if (texto) import("../memory/obsidian.js").then(m => m.capturar({modulo: "notas", titulo: texto.slice(0, 60), corpo: texto, id: n.id, tags: ["nota-de-voz"]})).catch(() => {});
      $("#nst", el).textContent = "Toque e fale uma ideia"; $("#nt", el).hidden = true; $("#nx", el).hidden = true;
      return carregar(true);
    }
    grav = criarGravador({aoTexto: t => { $("#nx", el).hidden = false; $("#nx", el).textContent = t; }, aoErro: e => aviso(e, true)});
    try { await grav.iniciar(); } catch (e) { grav = null; return aviso("Microfone bloqueado: " + e.message, true); }
    inicio = Date.now(); b.classList.add("on"); $("#nst", el).textContent = "Gravando. Toque para parar."; $("#nt", el).hidden = false;
    relogio = setInterval(() => { const s = Math.floor((Date.now() - inicio) / 1000); $("#nt", el).textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }, 500);
  }
  el.addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "ng") return alternar();
    if (b.id === "nm") return carregar(false);
    const id = b.closest("[data-id]")?.dataset.id; if (!id) return;
    const n = await pegar("notas", id), a = b.dataset.a;
    if (a === "ouvir") { const bl = await pegar("blobs", n.audio); if (!bl) return aviso("Áudio não está neste aparelho", true); const au = new Audio(URL.createObjectURL(bl.blob)); au.play(); return; }
    if (a === "editar") { const t = prompt("Texto da nota", n.texto || ""); if (t === null) return; await atualizar("notas", id, x => x.texto = t.trim()); return carregar(true); }
    if (a === "tarefa") { await salvar("tarefas", {titulo: n.texto.slice(0, 200), status: "aberta", origem: "nota de voz"}); await atualizar("notas", id, x => { x.status = "tratada"; x.destino = "virou tarefa"; }); aviso("Tarefa criada"); return carregar(true); }
    if (a === "pedido") {
      const {novoPedido, enviarAoMotor} = await import("../core/pipeline.js");
      const p = await novoPedido({texto: n.texto, canal: "voz", modulo: "notas", motor: ler().motor});
      await atualizar("notas", id, x => { x.status = "tratada"; x.destino = "virou pedido"; });
      const r = await enviarAoMotor(p);
      aviso(r.status === "erro" ? r.historico.at(-1).nota : r.entrega?.estado === "aguardando_ponte" ? "Na fila: vai quando o Mac estiver ligado" : "Pedido enviado", r.status === "erro");
      return carregar(true);
    }
    if (a === "mac") {
      // Transcrição do áudio no Mac: o motor (VoiceStudio ou SoundCraft) ainda está sendo escolhido. Por enquanto, no celular dá para mandar ao bot.
      const bl = await pegar("blobs", n.audio);
      const f = bl && new File([bl.blob], `nota-${n.criado_em.slice(0, 10)}.${(bl.blob.type.split("/")[1] || "webm").split(";")[0]}`, {type: bl.blob.type});
      if (f && navigator.canShare?.({files: [f]})) {
        if (confirm("A transcrição automática no Mac ainda está sendo configurada. Quer compartilhar o áudio com o seu bot no Telegram? Você escolhe o chat e toca em Enviar lá.")) navigator.share({files: [f]}).catch(() => {});
      } else aviso("Transcrição no Mac em configuração. Por enquanto edite o texto ou use o ditado do teclado.", true);
      return;
    }
    if (a === "apagar" && confirm("Apagar esta nota e o áudio deste aparelho?")) { if (n.audio) await apagar("blobs", n.audio); await apagar("notas", id); return carregar(true); }
  });
  await carregar(true);
}
