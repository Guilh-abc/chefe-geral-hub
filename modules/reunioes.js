// Módulo Reuniões: gravar, transcrever, gerar feedback de amigo, revisar e mandar no SEU Telegram (só com seu toque).
import {$, esc, quando, aviso} from "../core/ui.js";
import {salvar, pagina, atualizar, pegar, agoraISO} from "../core/db.js";
import {ler, gravar} from "../core/config.js";
import {confirmar} from "../core/gate.js";
import {criarGravador, temTranscricao, temGravacao} from "../core/voz.js";
import {emCelular, abrirLink, linkBot, BOT, cartaoBot} from "../core/aparelho.js";
import {linkTelegram} from "../engines/grok-webhook.js";

const ETAPAS = ["Gravar", "Transcrição", "Resumo", "Revisar e enviar"];
export default async function abrir(el) {
  let r = null, grav = null, relogio = null, inicio = 0;
  const emCurso = new Set();
  // Estado da transcrição no Mac; "transcrevendo" de uma visita anterior foi interrompida.
  const estadoT = x => {
    if (x.transc_estado === "transcrevendo" && !emCurso.has(x.id)) return {st: "erro", msg: "A transcrição foi interrompida. Toque em Tentar de novo."};
    return {st: x.transc_estado, msg: x.transc_erro || "Não consegui transcrever."};
  };
  const caixaT = x => {
    const {st, msg} = estadoT(x);
    if (st === "transcrevendo") return `<span style="color:var(--and)">Transcrevendo no Mac…</span>${x.duracao_s > 300 ? " <span class='muted'>Reunião longa: pode levar alguns minutos.</span>" : ""}`;
    if (st === "erro") return `<span style="color:var(--err)">${esc(msg)}</span>`;
    if (st === "celular") return `<span style="color:#7dd3fc">No celular a transcrição é feita no Mac pelo Telegram. Toque em Mandar áudio ao bot (vai com a legenda /reuniao) ou cole a transcrição acima.</span>`;
    return "";
  };
  const etapas = n => `<div class="etapas">${ETAPAS.map((e, i) => `<span class="${i === n ? "on" : ""}">${i + 1}. ${e}</span>`).join("")}</div>`;

  async function lista() {
    const rs = await pagina("reunioes", {limite: 10});
    el.innerHTML = etapas(0) + (emCelular() ? cartaoBot("No celular, a reunião vai pelo Telegram", `Mande o áudio da reunião no <b>@${BOT()}</b> com a legenda <code>/reuniao</code> (anexe o arquivo de áudio e escreva /reuniao na legenda). O Mac transcreve, o resumo de amigo volta no bot e tudo fica no Obsidian. Se gravar aqui, o áudio fica neste aparelho e você manda ao bot depois.`) : "") + `<div class="card grava">
      <button class="mic" id="rg" aria-label="Gravar"><svg viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/></svg></button>
      <b>Quero gravar pra reunião</b>
      <p class="muted small">${temGravacao() ? "Grava o áudio no aparelho." : "Este navegador não grava áudio."} ${temTranscricao() ? "Transcreve ao vivo em português." : "Sem transcrição ao vivo aqui: ao final, cole a transcrição ou mande o áudio ao Chefe Geral."}</p>
      <label class="ghost" style="display:inline-block">Já tenho áudio ou transcrição<input type="file" id="rf" accept="audio/*,.txt,.md,.vtt,.srt,text/plain" hidden></label>
    </div><h2 class="sec">Reuniões</h2>` + (rs.length ? rs.map(x => `<div class="item" data-id="${x.id}"><div class="item-h"><span class="st ${x.status === "enviado" ? "enviado" : "andamento"}"></span><div class="item-t">${esc(x.titulo)}<div class="item-m">${quando(x.criado_em)} · ${x.status === "enviado" ? "Enviado no Telegram" : x.resumo ? "Resumo pronto para revisar" : "Sem resumo"}</div>${caixaT(x) ? `<div class="small">${caixaT(x)}</div>` : ""}</div></div><div class="acoes"><button data-abrir="${x.id}">Abrir</button></div></div>`).join("") : `<div class="vazio">Nenhuma reunião ainda.</div>`);
  }
  function tempo() { const s = Math.floor((Date.now() - inicio) / 1000); $("#rt", el).textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }

  async function gravando() {
    el.innerHTML = etapas(1) + `<div class="card grava"><div class="tempo" id="rt">00:00</div>
      <button class="mic on" id="rp" aria-label="Parar"><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg></button><b>Gravando. Toque para parar.</b>
      <div class="transc" id="rx">${temTranscricao() ? "<span class='muted'>A transcrição aparece aqui...</span>" : "<span class='muted'>Transcrição ao vivo indisponível neste navegador.</span>"}</div><p class="parcial" id="rpar"></p></div>`;
    grav = criarGravador({aoTexto: t => $("#rx", el).textContent = t, aoParcial: t => { const p = $("#rpar", el); if (p) p.textContent = t; }, aoErro: e => aviso(e, true)});
    try { await grav.iniciar(); } catch (e) { aviso("Microfone bloqueado: " + e.message, true); grav = null; return lista(); }
    inicio = Date.now(); relogio = setInterval(tempo, 500);
  }
  async function parar() {
    clearInterval(relogio);
    $("#rx", el)?.insertAdjacentHTML("afterend", `<p class="muted small">Finalizando...</p>`);
    const {texto, audio, silencio} = await grav.parar(); grav = null;
    const id = "r" + Date.now().toString(36);
    if (audio) await salvar("blobs", {id: id + "-audio", blob: audio, criado_em: agoraISO()});
    r = await salvar("reunioes", {id, titulo: "Reunião " + quando(agoraISO()), transcricao: texto, audio: audio ? id + "-audio" : null, duracao_s: Math.round((Date.now() - inicio) / 1000), status: "rascunho", silencio: !!silencio, transc_estado: texto ? "ok" : null});
    if (texto) memoria(r.titulo + " (transcrição)", texto, ["transcricao"]);
    revisar();
    // Sem transcrição ao vivo: manda o áudio para o Mac na hora; o andamento aparece na própria reunião.
    if (!texto && audio) {
      // No celular a ponte não existe: orienta a mandar o áudio ao bot em vez de tentar o Mac.
      if (emCelular()) { r = await atualizar("reunioes", id, y => { y.transc_estado = "celular"; }); return revisar(); }
      transcrever(id);
    }
  }
  async function revisar() {
    const regras = ler().regrasReuniao;
    const n = r.resumo ? 3 : r.transcricao ? 2 : 1;
    el.innerHTML = etapas(n) + `<div class="card"><label class="campo">Título<input id="rti" value="${esc(r.titulo)}"></label>
      <label class="campo">Transcrição ${r.transcricao ? `<span class="muted">(${r.transcricao.split(/\s+/).length} palavras)</span>` : ""}<textarea id="rtr" rows="6" placeholder="Sem transcrição. Cole aqui o texto da reunião.">${esc(r.transcricao || "")}</textarea></label>
      ${r.audio ? `<div class="row-btn"><button class="ghost" id="rplay">Ouvir áudio</button>${botaoMac(r)}</div><p class="small" id="rmacst">${caixaT(r)}</p><audio id="rau" controls hidden style="width:100%;margin-top:8px"></audio>` : ""}</div>
      <details class="card regras"><summary><b>Regras do resumo</b> <span class="muted small">(${regras.length}, toque para editar)</span></summary><ol id="rr">${regras.map((x, i) => `<li><input value="${esc(x)}" data-i="${i}"><button data-del="${i}" aria-label="Remover">×</button></li>`).join("")}</ol>
        <div class="row-btn"><button class="ghost" id="radd">Adicionar regra</button><button class="ghost" id="rsalvar">Salvar regras</button></div></details>
      <div class="card"><h3>Gerar resumo</h3>
        <div class="row-btn"><button class="primary" id="rloc">Rascunho no navegador (já)</button><button class="ghost" id="rgrok">${emCelular() ? "Pedir pelo Telegram" : "Pedir ao Chefe Geral"}</button><button class="ghost" id="roll">Motor 2 (Ollama)</button></div>
        <p class="muted small">Rascunho no navegador: estrutura automática, sem IA. Chefe Geral: recebe a transcrição pelo webhook e responde no chat ou Telegram; cole a resposta abaixo se quiser revisar aqui antes de enviar. Motor 2: experimental, roda no seu Mac.</p></div>
      <div class="card"><h3>Revisar</h3>${r.fonte_resumo ? `<span class="tag ${r.fonte_resumo}">${{local: "Rascunho do navegador", grok: "Do Chefe Geral", ollama: "Do Motor 2 (Ollama)"}[r.fonte_resumo]}</span>` : ""}
        <textarea class="resumo" id="rres" placeholder="O resumo aparece aqui para você revisar e editar.">${esc(r.resumo || "")}</textarea>
        <label class="check"><input type="checkbox" id="rdoc" ${r.transcricao ? "checked" : ""}> Anexar a transcrição completa (.md)</label>
        <div class="row-btn"><button class="primary" id="renv">Enviar no meu Telegram</button><button class="ghost" id="rcop">Copiar</button><button class="ghost" id="rvolta">Voltar</button></div>
        <p class="muted small">Vai só para o seu chat do Telegram e só depois do seu toque. Acima de 4096 caracteres vira arquivo .md.</p></div>`;
  }
  // Mac fora de alcance (ex.: no celular): fica na fila e oferece mandar pelo Telegram.
  async function celular(p, regras) {
    const {linkTelegram} = await import("../engines/grok-webhook.js");
    const link = linkTelegram(p, {tipo: "reuniao_resumo", anexos: {titulo: r.titulo, regras, transcricao: r.transcricao}});
    const nome = `reuniao-${r.criado_em.slice(0, 10)}.txt`;
    const arquivo = new File([`Título: ${r.titulo}\n\nRegras:\n- ${regras.join("\n- ")}\n\nTranscrição:\n${r.transcricao}\n`], nome, {type: "text/plain"});
    const podeArquivo = navigator.canShare?.({files: [arquivo]});
    const box = document.createElement("div");
    box.className = "card"; box.innerHTML = `<h3>Mac fora de alcance</h3><p class="muted small">O pedido ficou na fila e vai sozinho quando a ponte do Mac ligar. Para ir já pelo Telegram:</p>
      <div class="row-btn">${link ? `<a class="tg" href="${esc(link)}" target="_blank" rel="noopener">Abrir no Telegram</a>` : ""}${podeArquivo ? `<button class="ghost" id="rshare">Compartilhar ${nome} no Telegram</button>` : ""}</div>
      <p class="muted small">${link ? "Abre o chat do seu bot com o texto pronto; toque em Enviar lá." : ""} ${podeArquivo ? "O arquivo chamado reuniao-... é entendido pela ponte como reunião." : ""} ${!link && !podeArquivo ? "Informe o usuário do bot em Canais > Telegram." : ""}</p>`;
    el.prepend(box); el.scrollIntoView();
    box.querySelector("#rshare")?.addEventListener("click", () => navigator.share({files: [arquivo], text: "/reuniao " + r.titulo}).catch(() => {}));
    aviso("Mac fora de alcance: na fila.");
  }
  const botaoMac = x => { const {st} = estadoT(x); if (emCelular()) return navigator.canShare ? `<button class="ghost" id="rshareau">Mandar áudio ao bot</button>` : `<a class="tg" href="https://t.me/${BOT()}" target="_blank" rel="noopener">Abrir @${BOT()}</a>`; return st === "transcrevendo" ? "" : `<button class="ghost" id="rmac">${st === "erro" ? "Tentar de novo" : "Transcrever no Mac"}</button>`; };
  // Atualiza na tela só a parte da transcrição, se esta reunião estiver aberta (não perde o que você digitou).
  function mostrarT(x) {
    if (r?.id !== x.id || !$("#rmacst", el)) { if (!$("#rtr", el) && $(`[data-id="${x.id}"]`, el)) lista(); return; }
    const st = $("#rmacst", el); st.innerHTML = caixaT(x);
    const linha = $("#rplay", el)?.parentElement; if (linha) { $("#rmac", el)?.remove(); linha.insertAdjacentHTML("beforeend", botaoMac(x)); }
  }
  async function transcrever(id) {
    if (emCurso.has(id)) return;
    let x = await pegar("reunioes", id); if (!x?.audio) return;
    const aberta = () => r?.id === id && $("#rtr", el);
    if (aberta()) await salvarCampos();
    const bl = await pegar("blobs", x.audio);
    if (!bl) { x = await atualizar("reunioes", id, y => { y.transc_estado = "erro"; y.transc_erro = "O áudio desta reunião não está neste aparelho."; }); if (r?.id === id) r = x; return mostrarT(x); }
    emCurso.add(id);
    x = await atualizar("reunioes", id, y => { y.transc_estado = "transcrevendo"; y.transc_erro = null; });
    if (r?.id === id) r = {...r, transc_estado: x.transc_estado, transc_erro: null};
    mostrarT(x);
    try {
      const {transcreverNoMac} = await import("../engines/grok-webhook.js");
      const j = await transcreverNoMac(bl.blob);
      const texto = (j.texto || "").trim();
      if (texto) {
        const digitado = aberta() ? $("#rtr", el).value.trim() : "";
        x = await atualizar("reunioes", id, y => { const base = digitado || (y.transcricao || "").trim(); y.transcricao = base ? base + "\n\n" + texto : texto; y.fonte_transcricao = "voicestudio"; y.transc_estado = "ok"; y.transc_erro = null; });
        memoria(x.titulo + " (transcrição)", texto, ["transcricao"], id);
      } else {
        x = await atualizar("reunioes", id, y => { y.transc_estado = "erro"; y.transc_erro = y.silencio
          ? "O microfone gravou silêncio. No Mac, veja Ajustes do Sistema > Privacidade e Segurança > Microfone e ligue o Google Chrome; confira também o microfone escolhido no cadeado da barra de endereço (com a tampa do notebook fechada o microfone interno fica mudo)."
          : "O Mac não reconheceu fala neste áudio. Ouça a gravação para conferir e tente de novo."; });
      }
    } catch (err) {
      const off = err.code === "PONTE_OFF";
      x = await atualizar("reunioes", id, y => { y.transc_estado = "erro"; y.transc_erro = off
        ? "Ponte do Mac desligada ou fora de alcance. No Mac, rode ./scripts/relay-status.sh; no Chrome, permita o acesso à rede local. No celular, mande o áudio ao seu bot com /reuniao na legenda."
        : /VoiceStudio fechado/i.test(err.message) ? "VoiceStudio fechado. Abra o VoiceStudio no Mac e toque em Tentar de novo."
        : "Não consegui transcrever: " + err.message; });
    } finally { emCurso.delete(id); }
    if (aberta()) {
      // Reunião aberta: mostra o texto na hora, guardando o título e o resumo que você está editando.
      const ti = $("#rti", el).value, rs = $("#rres", el).value;
      r = x; revisar(); $("#rti", el).value = ti; $("#rres", el).value = rs;
    } else if ($(`[data-id="${id}"]`, el)) lista();
  }
  const salvarCampos = async () => { r = await atualizar("reunioes", r.id, x => { x.titulo = $("#rti", el).value; x.transcricao = $("#rtr", el).value; if (x.transcricao.trim() && x.transc_estado === "erro") { x.transc_estado = "ok"; x.transc_erro = null; } x.resumo = $("#rres", el).value; }); };
  const memoria = (titulo, corpo, tags, id = r.id) => import("../memory/obsidian.js").then(m => m.capturar({modulo: "reunioes", titulo, corpo, tags, id})).catch(() => {});

  el.addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "rg") return gravando();
    if (b.id === "rp") return parar();
    if (b.dataset.abrir) { r = await pegar("reunioes", b.dataset.abrir); return revisar(); }
    if (b.id === "rvolta") { await salvarCampos(); return lista(); }
    if (b.id === "rmac") return transcrever(r.id);
    if (b.id === "rshareau") {
      const bl = await pegar("blobs", r.audio); if (!bl) return aviso("Áudio não está neste aparelho", true);
      const f = new File([bl.blob], `reuniao-${r.criado_em.slice(0, 10)}.${(bl.blob.type.split("/")[1] || "webm").split(";")[0]}`, {type: bl.blob.type});
      if (navigator.canShare?.({files: [f]})) navigator.share({files: [f], text: "/reuniao " + ($("#rti", el)?.value || r.titulo)}).catch(() => {});
      else aviso("Este aparelho não compartilha arquivos. Mande o áudio ao @" + BOT() + " com a legenda /reuniao.", true);
      return;
    }
    if (b.id === "rgrok" && emCelular()) {
      // Celular: abre o bot no mesmo toque com a reunião pronta (#reuniao), e guarda o registro aqui.
      const titulo = $("#rti", el).value, transcricao = $("#rtr", el).value.trim();
      if (!transcricao) return aviso("Sem transcrição. No celular, mande o áudio ao @" + BOT() + " com a legenda /reuniao.", true);
      const regras = ler().regrasReuniao;
      const pTmp = {id: "r" + Date.now().toString(36), texto: `Resumo da reunião "${titulo}" seguindo as regras`, modulo: "reunioes"};
      const link = linkTelegram(pTmp, {tipo: "reuniao_resumo", anexos: {titulo, regras, transcricao}});
      // Grande demais para link: compartilha o .txt (a ponte entende reuniao-*.txt como reunião) ou copia.
      const arq = new File([`Título: ${titulo}\n\nRegras:\n- ${regras.join("\n- ")}\n\nTranscrição:\n${transcricao}\n`], `reuniao-${new Date().toISOString().slice(0, 10)}.txt`, {type: "text/plain"});
      const porArquivo = !link && navigator.canShare?.({files: [arq]});
      if (link) abrirLink(link);
      else if (porArquivo) navigator.share({files: [arq], text: "/reuniao " + titulo}).catch(() => {});
      else { navigator.clipboard?.writeText("/reuniao " + titulo + "\n\n" + transcricao).catch(() => {}); abrirLink(linkBot()); }
      await salvarCampos();
      const {novoPedido, marcar} = await import("../core/pipeline.js");
      const p = await novoPedido({texto: pTmp.texto, canal: "celular", modulo: "reunioes", motor: "grok"});
      await atualizar("pedidos", p.id, x => { x.entrega = {estado: "telegram", em: agoraISO()}; });
      await marcar(p.id, {camada: 4, status: "andamento", nota: "Aberto no @" + BOT() + ". O resumo volta no Telegram e fica no Obsidian."});
      return aviso(link ? "Abrindo o Telegram: toque em Enviar lá." : porArquivo ? "Transcrição longa: escolha o Telegram e o @" + BOT() + " para mandar o arquivo." : "Transcrição longa: copiei com /reuniao. Cole no bot e envie.");
    }
    if (b.id === "rplay") { const a = $("#rau", el), bl = await pegar("blobs", r.audio); a.src = URL.createObjectURL(bl.blob); a.hidden = false; a.play(); return; }
    if (b.id === "radd") { $("#rr", el).insertAdjacentHTML("beforeend", `<li><input value="" placeholder="Nova regra"><button data-del>×</button></li>`); return; }
    if (b.dataset.del !== undefined) { b.closest("li").remove(); return; }
    if (b.id === "rsalvar") { gravar({regrasReuniao: [...el.querySelectorAll("#rr input")].map(i => i.value.trim()).filter(Boolean)}); return aviso("Regras salvas"); }
    if (["rloc", "rgrok", "roll"].includes(b.id)) {
      await salvarCampos();
      if (!r.transcricao?.trim()) return aviso("Sem transcrição. Cole o texto ou mande o áudio ao Chefe Geral.", true);
      const regras = ler().regrasReuniao;
      if (b.id === "rloc") {
        const {rascunho} = await import("../engines/rascunho-local.js");
        r = await atualizar("reunioes", r.id, x => { x.resumo = rascunho(x.transcricao, regras); x.fonte_resumo = "local"; });
        return revisar();
      }
      const {novoPedido, enviarAoMotor} = await import("../core/pipeline.js");
      const motor = b.id === "roll" ? "ollama" : "grok";
      const p = await novoPedido({texto: `Resumo da reunião "${r.titulo}" seguindo as regras`, canal: "reunioes", modulo: "reunioes", motor});
      aviso("Enviando ao " + (motor === "grok" ? "Chefe Geral" : "Motor 2") + "...");
      const res = await enviarAoMotor(p, {tipo: "reuniao_resumo", anexos: {reuniao_id: r.id, titulo: r.titulo, regras, transcricao: r.transcricao, duracao_s: r.duracao_s || null}});
      if (res.status === "erro") return aviso(res.historico.at(-1).nota, true);
      if (res.entrega?.estado === "aguardando_ponte") return celular(p, regras);
      if (res.resposta) { r = await atualizar("reunioes", r.id, x => { x.resumo = res.resposta; x.fonte_resumo = motor; }); return revisar(); }
      return aviso("Transcrição entregue ao Chefe Geral. O resumo chega no chat ou Telegram; cole aqui para revisar.");
    }
    if (b.id === "rcop") { await navigator.clipboard?.writeText($("#rres", el).value); return aviso("Copiado"); }
    if (b.id === "renv") {
      await salvarCampos();
      const texto = r.resumo?.trim(); if (!texto) return aviso("Gere ou escreva o resumo primeiro.", true);
      const c = ler().telegram; if (!c.token || !c.chat_id) return aviso("Configure o Telegram em Canais primeiro.", true);
      const doc = $("#rdoc", el).checked && r.transcricao ? {arquivo: `reuniao-${r.criado_em.slice(0, 10)}.md`, conteudo: `# ${r.titulo}\n\n## Resumo\n\n${texto}\n\n## Transcrição completa\n\n${r.transcricao}\n`, legenda: "Transcrição completa: " + r.titulo} : null;
      const ok = await confirmar({titulo: "Enviar resumo no seu Telegram?", para: "Seu chat no Telegram (" + c.chat_id + ")", conteudo: texto + (doc ? "\n\n+ arquivo " + doc.arquivo : "") + (texto.length > 4096 ? "\n\n(Mais de 4096 caracteres: vai como arquivo .md)" : "")});
      if (!ok) return aviso("Nada foi enviado.");
      try {
        const tg = await import("../channels/telegram.js");
        await tg.enviarTexto(texto, {arquivo: `resumo-${r.criado_em.slice(0, 10)}.md`, documentoExtra: doc});
        r = await atualizar("reunioes", r.id, x => { x.status = "enviado"; x.enviado_em = agoraISO(); });
        memoria(r.titulo, `## Resumo\n\n${texto}\n\n## Transcrição\n\n${r.transcricao || ""}`, ["reuniao"]);
        aviso("Enviado no seu Telegram.");
        lista();
      } catch (err) { aviso(err.message, true); }
    }
  });
  el.addEventListener("change", async e => {
    if (e.target.id !== "rf") return;
    const f = e.target.files[0]; if (!f) return;
    const id = "r" + Date.now().toString(36);
    if (f.type.startsWith("audio/")) {
      await salvar("blobs", {id: id + "-audio", blob: f, criado_em: agoraISO()});
      r = await salvar("reunioes", {id, titulo: f.name.replace(/\.[^.]+$/, ""), transcricao: "", audio: id + "-audio", status: "rascunho"});
    } else {
      r = await salvar("reunioes", {id, titulo: f.name.replace(/\.[^.]+$/, ""), transcricao: (await f.text()).slice(0, 400000), status: "rascunho"});
    }
    revisar();
    if (f.type.startsWith("audio/")) transcrever(id);
  });
  await lista();
}
