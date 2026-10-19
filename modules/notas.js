// Notas de voz: fale uma ideia. O áudio fica neste aparelho (IndexedDB); nada sobe sozinho.
// Transcrição: ao vivo pelo navegador (pt-BR) e, no Mac, pelo VoiceStudio via ponte (POST /transcrever; o áudio é apagado do Mac depois).
import {$, esc, quando, aviso} from "../core/ui.js";
import {salvar, pagina, pegar, atualizar, apagar, agoraISO} from "../core/db.js";
import {ler} from "../core/config.js";
import {criarGravador, temTranscricao, temGravacao} from "../core/voz.js";

export default async function abrir(el) {
  let grav = null, ultimo = null, inicio = 0, relogio = null;
  const emCurso = new Set();
  el.innerHTML = `<div class="card grava">
      <button class="mic" id="ng" aria-label="Gravar nota"><svg viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/></svg></button>
      <b id="nst">Toque e fale uma ideia</b><div class="tempo" id="nt" hidden>00:00</div>
      <div class="transc" id="nx" hidden></div>
      <p class="muted small">${temGravacao() ? "O áudio fica só neste aparelho." : "Este navegador não grava áudio."} ${temTranscricao() ? "Transcrição ao vivo em português." : "Sem transcrição ao vivo aqui."}</p></div>
    <h2 class="sec">Notas</h2><div id="nl"></div><button class="ghost mais" id="nm" hidden>Carregar mais</button>`;
  const ESTADO = {
    transcrevendo: () => `<div class="small" style="color:var(--and)">Transcrevendo no Mac…</div>`,
    erro: n => `<div class="small" style="color:var(--err)">${esc(n.transc_erro || "Não consegui transcrever.")}</div>`
  };
  const item = n => {
    // Uma transcrição que ficou "transcrevendo" de uma visita anterior foi interrompida: mostra como erro.
    const st = n.transc_estado === "transcrevendo" && !emCurso.has(n.id) ? "erro" : n.transc_estado;
    if (st === "erro" && n.transc_estado === "transcrevendo") n = {...n, transc_erro: "A transcrição foi interrompida. Toque em Tentar de novo."};
    const corpo = n.texto ? esc(n.texto) : st === "transcrevendo" ? "" : `<span class="muted">(sem transcrição)</span>`;
    const tentar = n.audio && st !== "transcrevendo";
    return `<div class="item" data-id="${n.id}"><div class="item-h"><span class="st ${n.status === "tratada" ? "concluido" : "fila"}"></span><div class="item-t">${corpo}
    ${ESTADO[st] ? ESTADO[st](n) : ""}
    <div class="item-m">${quando(n.criado_em)}${n.duracao_s ? " · " + n.duracao_s + " s" : ""}${n.origem ? " · " + esc(n.origem) : ""}${n.fonte_texto === "voicestudio" ? " · transcrito no Mac" : ""}${n.destino ? " · " + esc(n.destino) : ""}</div></div></div>
    <div class="acoes">${n.audio ? `<button data-a="ouvir">Ouvir</button>` : ""}${n.texto ? `<button data-a="pedido">Virar pedido</button><button data-a="tarefa">Virar tarefa</button>` : ""}
      <button data-a="editar">Editar texto</button>${tentar ? `<button data-a="mac">${st === "erro" ? "Tentar de novo" : "Transcrever no Mac"}</button>` : ""}${st === "erro" && n.ponte_off && navigator.canShare ? `<button data-a="compartilhar">Mandar ao bot</button>` : ""}<button data-a="apagar">Apagar</button></div></div>`;
  };
  // Redesenha só a nota na tela (sem recarregar a lista).
  async function redesenhar(id) {
    const n = await pegar("notas", id), velho = $(`[data-id="${id}"]`, el);
    if (!velho) return;
    if (!n) return velho.remove();
    velho.insertAdjacentHTML("afterend", item(n)); velho.remove();
  }
  // Manda o áudio para a ponte do Mac (VoiceStudio) e grava o texto na nota. Erros ficam visíveis na própria nota.
  async function transcrever(id) {
    if (emCurso.has(id)) return;
    const n = await pegar("notas", id); if (!n?.audio) return;
    const bl = await pegar("blobs", n.audio);
    if (!bl) { await atualizar("notas", id, x => { x.transc_estado = "erro"; x.transc_erro = "O áudio desta nota não está neste aparelho."; }); return redesenhar(id); }
    emCurso.add(id);
    await atualizar("notas", id, x => { x.transc_estado = "transcrevendo"; x.transc_erro = null; x.ponte_off = false; });
    await redesenhar(id);
    try {
      const {transcreverNoMac} = await import("../engines/grok-webhook.js");
      const j = await transcreverNoMac(bl.blob);
      const texto = (j.texto || "").trim();
      if (texto) {
        await atualizar("notas", id, x => { x.texto = texto; x.fonte_texto = "voicestudio"; x.transc_estado = "ok"; x.transc_erro = null; });
        import("../memory/obsidian.js").then(m => m.capturar({modulo: "notas", titulo: texto.slice(0, 60), corpo: texto, id, tags: ["nota-de-voz"]})).catch(() => {});
      } else {
        await atualizar("notas", id, x => { x.transc_estado = "erro"; x.transc_erro = n.silencio
          ? "O microfone gravou silêncio. No Mac, veja Ajustes do Sistema > Privacidade e Segurança > Microfone e ligue o Google Chrome; confira também o microfone escolhido no cadeado da barra de endereço (com a tampa do notebook fechada o microfone interno fica mudo)."
          : "O Mac não reconheceu fala neste áudio. Ouça a gravação para conferir e tente de novo."; });
      }
    } catch (err) {
      const off = err.code === "PONTE_OFF";
      await atualizar("notas", id, x => { x.transc_estado = "erro"; x.ponte_off = off; x.transc_erro = off
        ? "Ponte do Mac desligada ou fora de alcance. No Mac, rode ./scripts/relay-status.sh; no Chrome, permita o acesso à rede local. No celular, use Mandar ao bot."
        : /VoiceStudio fechado/i.test(err.message) ? "VoiceStudio fechado. Abra o VoiceStudio no Mac e toque em Tentar de novo."
        : "Não consegui transcrever: " + err.message; });
    } finally { emCurso.delete(id); }
    return redesenhar(id);
  }
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
      $("#nst", el).textContent = "Finalizando...";
      const {texto, audio, silencio} = await grav.parar(); grav = null;
      const id = "n" + Date.now().toString(36);
      if (audio) await salvar("blobs", {id: id + "-audio", blob: audio, criado_em: agoraISO()});
      const n = await salvar("notas", {id, titulo: "Nota " + quando(agoraISO()), texto, audio: audio ? id + "-audio" : null, duracao_s: Math.round((Date.now() - inicio) / 1000), status: "nova", origem: "app", silencio: !!silencio, transc_estado: texto ? "ok" : null});
      if (texto) import("../memory/obsidian.js").then(m => m.capturar({modulo: "notas", titulo: texto.slice(0, 60), corpo: texto, id: n.id, tags: ["nota-de-voz"]})).catch(() => {});
      $("#nst", el).textContent = "Toque e fale uma ideia"; $("#nt", el).hidden = true; $("#nx", el).hidden = true;
      await carregar(true);
      // Sem transcrição ao vivo: manda o áudio para o Mac na hora, e a nota mostra o andamento.
      if (!texto && audio) transcrever(id);
      return;
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
    if (a === "editar") { const t = prompt("Texto da nota", n.texto || ""); if (t === null) return; await atualizar("notas", id, x => { x.texto = t.trim(); if (x.texto) { x.transc_estado = "ok"; x.transc_erro = null; } }); return redesenhar(id); }
    if (a === "tarefa") { await salvar("tarefas", {titulo: n.texto.slice(0, 200), status: "aberta", origem: "nota de voz"}); await atualizar("notas", id, x => { x.status = "tratada"; x.destino = "virou tarefa"; }); aviso("Tarefa criada"); return carregar(true); }
    if (a === "pedido") {
      const {novoPedido, enviarAoMotor} = await import("../core/pipeline.js");
      const p = await novoPedido({texto: n.texto, canal: "voz", modulo: "notas", motor: ler().motor});
      await atualizar("notas", id, x => { x.status = "tratada"; x.destino = "virou pedido"; });
      const r = await enviarAoMotor(p);
      aviso(r.status === "erro" ? r.historico.at(-1).nota : r.entrega?.estado === "aguardando_ponte" ? "Na fila: vai quando o Mac estiver ligado" : "Pedido enviado", r.status === "erro");
      return carregar(true);
    }
    if (a === "mac") return transcrever(id);
    if (a === "compartilhar") {
      const bl = await pegar("blobs", n.audio); if (!bl) return aviso("Áudio não está neste aparelho", true);
      const f = new File([bl.blob], `nota-${n.criado_em.slice(0, 10)}.${(bl.blob.type.split("/")[1] || "webm").split(";")[0]}`, {type: bl.blob.type});
      if (navigator.canShare?.({files: [f]})) navigator.share({files: [f]}).catch(() => {}); else aviso("Este aparelho não compartilha arquivos. Mande o áudio ao seu bot pelo Telegram.", true);
      return;
    }
    if (a === "apagar" && confirm("Apagar esta nota e o áudio deste aparelho?")) { if (n.audio) await apagar("blobs", n.audio); await apagar("notas", id); return carregar(true); }
  });
  await carregar(true);
}
