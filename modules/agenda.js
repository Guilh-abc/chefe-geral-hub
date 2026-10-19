// Agenda: monta o evento aqui. Gravar na agenda só com o seu toque (no próprio Google/Outlook ou confirmando o pedido ao Chefe Geral).
import {$, esc, quando, aviso} from "../core/ui.js";
import {salvar, pagina, pegar, atualizar, apagar} from "../core/db.js";
import {confirmar} from "../core/gate.js";

const pad = n => String(n).padStart(2, "0");
const amanha = () => { const d = new Date(Date.now() + 864e5 - 3 * 3600e3); return d.toISOString().slice(0, 10); };
function intervalo(e) {
  const ini = new Date(`${e.data}T${e.hora || "09:00"}:00-03:00`), fim = new Date(ini.getTime() + (e.duracao || 30) * 60e3);
  const z = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return {ini, fim, gIni: z(ini), gFim: z(fim)};
}
const linkGoogle = e => { const t = intervalo(e); return "https://calendar.google.com/calendar/render?" + new URLSearchParams({action: "TEMPLATE", text: e.titulo, dates: `${t.gIni}/${t.gFim}`, details: e.descricao || "", location: e.local || "", add: e.convidados || "", ctz: "America/Sao_Paulo"}); };
const linkOutlook = e => { const t = intervalo(e); return "https://outlook.office.com/calendar/deeplink/compose?" + new URLSearchParams({subject: e.titulo, startdt: t.ini.toISOString(), enddt: t.fim.toISOString(), body: e.descricao || "", location: e.local || "", to: e.convidados || ""}); };
function ics(e) {
  const t = intervalo(e), esc2 = s => String(s || "").replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Chefe Geral//PT-BR", "BEGIN:VEVENT", `UID:${e.id}@chefe-geral`, `DTSTAMP:${t.gIni}`, `DTSTART:${t.gIni}`, `DTEND:${t.gFim}`,
    `SUMMARY:${esc2(e.titulo)}`, `LOCATION:${esc2(e.local)}`, `DESCRIPTION:${esc2(e.descricao)}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}

export default async function abrir(el) {
  let atual = null;
  async function lista() {
    const es = await pagina("eventos", {limite: 15});
    el.innerHTML = `<div class="etapas"><span class="on">1. Montar</span><span>2. Conferir</span><span>3. Gravar com seu toque</span></div>
    <form class="card" id="af" autocomplete="off"><h3>Novo evento</h3>
      <label class="campo">O quê<input id="at" required placeholder="Ex.: Lightera: alinhamento com o Arthur"></label>
      <div class="linha"><label class="campo" style="flex:1">Dia<input id="ad" type="date" value="${amanha()}"></label><label class="campo" style="flex:1">Hora<input id="ah" type="time" value="09:00"></label></div>
      <label class="campo">Duração<select id="adu"><option value="15">15 min</option><option value="30" selected>30 min</option><option value="45">45 min</option><option value="60">1 h</option><option value="90">1 h 30</option><option value="120">2 h</option></select></label>
      <label class="campo">Onde (ou link)<input id="al" placeholder="Teams, Meet ou endereço"></label>
      <label class="campo">Convidados (e-mails, separados por vírgula)<input id="ac"></label>
      <label class="campo">Agenda<select id="acal"><option value="google">Google Calendar</option><option value="m365">Microsoft 365 (Outlook)</option></select></label>
      <label class="campo">Detalhes<textarea id="ads" rows="2"></textarea></label>
      <div class="row-btn"><button class="primary">Conferir</button></div></form>
    <div class="card"><h3>Perguntar ao Chefe Geral</h3><div class="row-btn"><button class="ghost" data-q="Como está minha agenda hoje? Liste os compromissos e os buracos livres.">Agenda de hoje</button><button class="ghost" data-q="Quais são meus compromissos desta semana? Destaque conflitos.">Esta semana</button><button class="ghost" data-q="Ache 3 horários livres de 30 min amanhã para uma reunião.">Horários livres amanhã</button></div><p class="muted small">Só leitura: ele consulta Google Calendar e Microsoft 365 e responde no chat ou Telegram.</p></div>
    <h2 class="sec">Eventos montados</h2>` + (es.length ? es.map(e => `<div class="item"><div class="item-h"><span class="st ${e.status === "gravado" ? "concluido" : e.status === "pedido" ? "andamento" : "fila"}"></span><div class="item-t">${esc(e.titulo)}<div class="item-m">${e.data.split("-").reverse().slice(0, 2).join("/")} ${e.hora} · ${e.duracao} min · ${e.agenda === "m365" ? "Microsoft 365" : "Google"} · ${{rascunho: "Rascunho", pedido: "Pedido ao Chefe Geral", gravado: "Gravado"}[e.status] || e.status}</div></div></div><div class="acoes"><button data-abrir="${e.id}">Abrir</button></div></div>`).join("") : `<div class="vazio">Nenhum evento montado.</div>`);
    $("#af", el).onsubmit = async ev => {
      ev.preventDefault();
      atual = await salvar("eventos", {titulo: $("#at", el).value.trim(), data: $("#ad", el).value, hora: $("#ah", el).value, duracao: +$("#adu", el).value, local: $("#al", el).value.trim(), convidados: $("#ac", el).value.trim(), agenda: $("#acal", el).value, descricao: $("#ads", el).value.trim(), status: "rascunho"});
      conferir();
    };
  }
  function resumoTxt(e) { return `${e.titulo}\n${e.data.split("-").reverse().join("/")} às ${e.hora} (${e.duracao} min)\nAgenda: ${e.agenda === "m365" ? "Microsoft 365" : "Google Calendar"}${e.local ? "\nOnde: " + e.local : ""}${e.convidados ? "\nConvidados: " + e.convidados : ""}${e.descricao ? "\n\n" + e.descricao : ""}`; }
  function conferir() {
    const e = atual;
    el.innerHTML = `<div class="etapas"><span>1. Montar</span><span class="on">2. Conferir</span><span>3. Gravar com seu toque</span></div>
    <div class="card"><pre class="preview">${esc(resumoTxt(e))}</pre>
      <h3 style="margin-top:12px">Gravar na agenda</h3>
      <div class="row-btn"><a class="primary" style="text-decoration:none" href="${esc(e.agenda === "m365" ? linkOutlook(e) : linkGoogle(e))}" target="_blank" rel="noopener" id="alink">Abrir no ${e.agenda === "m365" ? "Outlook" : "Google Agenda"} (você salva lá)</a></div>
      <div class="row-btn"><button class="ghost" id="apedir">Pedir ao Chefe Geral gravar</button><button class="ghost" id="aics">Baixar .ics</button><button class="ghost" id="agrav">Já gravei</button></div>
      <p class="muted small">Abrir no Google ou Outlook mostra o evento preenchido; ele só é gravado quando você salva lá. Pedir ao Chefe Geral passa pela sua confirmação aqui${e.convidados ? " e envia convite aos convidados" : ""}.</p>
      <div class="row-btn"><button class="ghost" id="avolta">Voltar</button><button class="ghost" id="aapagar">Apagar rascunho</button></div></div>`;
  }
  el.addEventListener("click", async ev => {
    const b = ev.target.closest("button, a"); if (!b) return;
    if (b.dataset.q) { const {novoPedido, enviarAoMotor} = await import("../core/pipeline.js"); const {ler} = await import("../core/config.js"); const p = await novoPedido({texto: b.dataset.q, canal: "agenda", modulo: "agenda", motor: ler().motor}); aviso("Perguntando..."); const r = await enviarAoMotor(p); return aviso(r.status === "erro" ? r.historico.at(-1).nota : "Pedido enviado. Resposta no chat, Telegram ou em Pedidos.", r.status === "erro"); }
    if (b.dataset.abrir) { atual = await pegar("eventos", b.dataset.abrir); return conferir(); }
    if (b.id === "avolta") return lista();
    if (b.id === "aapagar") { await apagar("eventos", atual.id); return lista(); }
    if (b.id === "aics") { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([ics(atual)], {type: "text/calendar"})); a.download = "evento.ics"; a.click(); return; }
    if (b.id === "agrav") { atual = await atualizar("eventos", atual.id, x => x.status = "gravado"); aviso("Marcado como gravado"); return lista(); }
    if (b.id === "apedir") {
      const ok = await confirmar({titulo: "Pedir ao Chefe Geral gravar este evento?", para: atual.agenda === "m365" ? "Microsoft 365" : "Google Calendar", conteudo: resumoTxt(atual) + (atual.convidados ? "\n\nOs convidados recebem convite." : ""), botao: "Confirmar e pedir"});
      if (!ok) return aviso("Nada foi pedido.");
      const {novoPedido, enviarAoMotor} = await import("../core/pipeline.js");
      const p = await novoPedido({texto: "Criar evento na agenda: " + atual.titulo, canal: "agenda", modulo: "agenda", motor: "grok"});
      const r = await enviarAoMotor(p, {tipo: "agenda_evento", anexos: {confirmado_pelo_usuario: true, evento: {...atual, inicio: intervalo(atual).ini.toISOString(), fim: intervalo(atual).fim.toISOString(), fuso: "America/Sao_Paulo"}}});
      if (r.status === "erro") return aviso(r.historico.at(-1).nota, true);
      atual = await atualizar("eventos", atual.id, x => { x.status = "pedido"; x.pedido = p.id; });
      import("../memory/obsidian.js").then(m => m.capturar({modulo: "agenda", titulo: atual.titulo, corpo: resumoTxt(atual), id: atual.id})).catch(() => {});
      aviso("Pedido enviado ao Chefe Geral. Ele confirma no chat quando gravar.");
      return lista();
    }
  });
  await lista();
}
