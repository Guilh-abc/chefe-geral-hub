// Módulo Reuniões: gravar, transcrever, gerar feedback de amigo, revisar e mandar no SEU Telegram (só com seu toque).
import {$, esc, quando, aviso} from "../core/ui.js";
import {salvar, pagina, atualizar, pegar, agoraISO} from "../core/db.js";
import {ler, gravar} from "../core/config.js";
import {confirmar} from "../core/gate.js";
import {criarGravador, temTranscricao, temGravacao} from "../core/voz.js";

const ETAPAS = ["Gravar", "Transcrição", "Resumo", "Revisar e enviar"];
export default async function abrir(el) {
  let r = null, grav = null, relogio = null, inicio = 0;
  const etapas = n => `<div class="etapas">${ETAPAS.map((e, i) => `<span class="${i === n ? "on" : ""}">${i + 1}. ${e}</span>`).join("")}</div>`;

  async function lista() {
    const rs = await pagina("reunioes", {limite: 10});
    el.innerHTML = etapas(0) + `<div class="card grava">
      <button class="mic" id="rg" aria-label="Gravar"><svg viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/></svg></button>
      <b>Quero gravar pra reunião</b>
      <p class="muted small">${temGravacao() ? "Grava o áudio no aparelho." : "Este navegador não grava áudio."} ${temTranscricao() ? "Transcreve ao vivo em português." : "Sem transcrição ao vivo aqui: ao final, cole a transcrição ou mande o áudio ao Chefe Geral."}</p>
      <label class="ghost" style="display:inline-block">Já tenho áudio ou transcrição<input type="file" id="rf" accept="audio/*,.txt,.md,.vtt,.srt,text/plain" hidden></label>
    </div><h2 class="sec">Reuniões</h2>` + (rs.length ? rs.map(x => `<div class="item" data-id="${x.id}"><div class="item-h"><span class="st ${x.status === "enviado" ? "enviado" : "andamento"}"></span><div class="item-t">${esc(x.titulo)}<div class="item-m">${quando(x.criado_em)} · ${x.status === "enviado" ? "Enviado no Telegram" : x.resumo ? "Resumo pronto para revisar" : "Sem resumo"}</div></div></div><div class="acoes"><button data-abrir="${x.id}">Abrir</button></div></div>`).join("") : `<div class="vazio">Nenhuma reunião ainda.</div>`);
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
    const {texto, audio} = await grav.parar(); grav = null;
    const id = "r" + Date.now().toString(36);
    if (audio) await salvar("blobs", {id: id + "-audio", blob: audio, criado_em: agoraISO()});
    r = await salvar("reunioes", {id, titulo: "Reunião " + quando(agoraISO()), transcricao: texto, audio: audio ? id + "-audio" : null, duracao_s: Math.round((Date.now() - inicio) / 1000), status: "rascunho"});
    if (texto) memoria(r.titulo + " (transcrição)", texto, ["transcricao"]);
    revisar();
  }
  async function revisar() {
    const regras = ler().regrasReuniao;
    const n = r.resumo ? 3 : r.transcricao ? 2 : 1;
    el.innerHTML = etapas(n) + `<div class="card"><label class="campo">Título<input id="rti" value="${esc(r.titulo)}"></label>
      <label class="campo">Transcrição ${r.transcricao ? `<span class="muted">(${r.transcricao.split(/\s+/).length} palavras)</span>` : ""}<textarea id="rtr" rows="6" placeholder="Sem transcrição. Cole aqui o texto da reunião.">${esc(r.transcricao || "")}</textarea></label>
      ${r.audio ? `<div class="row-btn"><button class="ghost" id="rplay">Ouvir áudio</button></div><audio id="rau" controls hidden style="width:100%;margin-top:8px"></audio>` : ""}</div>
      <details class="card regras"><summary><b>Regras do resumo</b> <span class="muted small">(${regras.length}, toque para editar)</span></summary><ol id="rr">${regras.map((x, i) => `<li><input value="${esc(x)}" data-i="${i}"><button data-del="${i}" aria-label="Remover">×</button></li>`).join("")}</ol>
        <div class="row-btn"><button class="ghost" id="radd">Adicionar regra</button><button class="ghost" id="rsalvar">Salvar regras</button></div></details>
      <div class="card"><h3>Gerar resumo</h3>
        <div class="row-btn"><button class="primary" id="rloc">Rascunho no navegador (já)</button><button class="ghost" id="rgrok">Pedir ao Chefe Geral</button><button class="ghost" id="roll">Motor 2 (Ollama)</button></div>
        <p class="muted small">Rascunho no navegador: estrutura automática, sem IA. Chefe Geral: recebe a transcrição pelo webhook e responde no chat ou Telegram; cole a resposta abaixo se quiser revisar aqui antes de enviar. Motor 2: experimental, roda no seu Mac.</p></div>
      <div class="card"><h3>Revisar</h3>${r.fonte_resumo ? `<span class="tag ${r.fonte_resumo}">${{local: "Rascunho do navegador", grok: "Do Chefe Geral", ollama: "Do Motor 2 (Ollama)"}[r.fonte_resumo]}</span>` : ""}
        <textarea class="resumo" id="rres" placeholder="O resumo aparece aqui para você revisar e editar.">${esc(r.resumo || "")}</textarea>
        <label class="check"><input type="checkbox" id="rdoc" ${r.transcricao ? "checked" : ""}> Anexar a transcrição completa (.md)</label>
        <div class="row-btn"><button class="primary" id="renv">Enviar no meu Telegram</button><button class="ghost" id="rcop">Copiar</button><button class="ghost" id="rvolta">Voltar</button></div>
        <p class="muted small">Vai só para o seu chat do Telegram e só depois do seu toque. Acima de 4096 caracteres vira arquivo .md.</p></div>`;
  }
  const salvarCampos = async () => { r = await atualizar("reunioes", r.id, x => { x.titulo = $("#rti", el).value; x.transcricao = $("#rtr", el).value; x.resumo = $("#rres", el).value; }); };
  const memoria = (titulo, corpo, tags) => import("../memory/obsidian.js").then(m => m.capturar({modulo: "reunioes", titulo, corpo, tags, id: r.id})).catch(() => {});

  el.addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "rg") return gravando();
    if (b.id === "rp") return parar();
    if (b.dataset.abrir) { r = await pegar("reunioes", b.dataset.abrir); return revisar(); }
    if (b.id === "rvolta") { await salvarCampos(); return lista(); }
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
      aviso("Áudio guardado. Sem transcrição automática de arquivo aqui: cole o texto ou peça ao Chefe Geral.");
    } else {
      r = await salvar("reunioes", {id, titulo: f.name.replace(/\.[^.]+$/, ""), transcricao: (await f.text()).slice(0, 400000), status: "rascunho"});
    }
    revisar();
  });
  await lista();
}
