// Canais e motores: tudo fica só no localStorage deste aparelho. Nada disso vai para o GitHub.
import {$, esc, aviso} from "../core/ui.js";
import {ler, gravar} from "../core/config.js";
import {exportarTudo} from "../core/db.js";
import {emCelular, BOT} from "../core/aparelho.js";

// Reabre num contêiner novo para não acumular ouvintes de evento.
function reabrir(el) { const n = document.createElement("div"); n.className = el.className; el.replaceWith(n); abrir(n); }
export default async function abrir(el) {
  const c = ler();
  const st = (ok, s1, s2) => `<span class="pill ${ok ? "ok" : "no"}">${ok ? s1 : s2}</span>`;
  const seg = (v, ph) => `placeholder="${v ? "salvo, cole para trocar" : ph}"`;
  el.innerHTML = `
  <div class="card"><h3>Motor padrão</h3>
    <label class="check"><input type="radio" name="motor" value="grok" ${c.motor === "grok" ? "checked" : ""}> Motor 1: Chefe Geral (Grok), pela rotina de webhook</label>
    <label class="check"><input type="radio" name="motor" value="ollama" ${c.motor === "ollama" ? "checked" : ""}> Motor 2: Ollama no Mac <span class="tag ollama" style="margin:0">experimental</span></label>
    <p class="muted small">Você também escolhe o motor em cada pedido, na tela inicial.</p></div>

  <form class="card" id="fn"><h3>Ponte na nuvem <span class="pill" id="nst">${c.grok.modo === "nuvem" ? "verificando..." : "desligada"}</span></h3>
    <p class="muted small">Funciona 24 h, com o Mac desligado, no Mac e no celular. Pedidos, áudios, transcrições e respostas ficam na sua conta Cloudflare, e a ponte do Mac copia tudo para o Obsidian quando ligar. A URL e o token aparecem uma vez no fim do <code>./scripts/nuvem-instalar.sh</code>.</p>
    <label class="check"><input type="checkbox" id="nuse" ${c.grok.modo === "nuvem" ? "checked" : ""}> Usar a ponte na nuvem neste aparelho</label>
    <label class="campo">URL do Worker<input id="nu" type="url" value="${esc(c.grok.nuvem?.url || "")}" placeholder="https://chefe-geral-ponte.SEU-USUARIO.workers.dev"></label>
    <label class="campo">Token do app (fica só neste aparelho)<input id="nt" type="password" autocomplete="off" ${seg(c.grok.nuvem?.token, "cole o token do app")}></label>
    <p class="muted small">Sem a nuvem, o celular volta ao modo só Telegram e o Mac usa a ponte local.</p>
    <div class="row-btn"><button class="primary">Salvar</button><button type="button" class="ghost" id="ntest">Testar</button></div></form>

  <form class="card" id="fg"><h3>Motor 1: Chefe Geral <span class="pill" id="pst">verificando...</span></h3>
    <p class="muted small">O webhook da rotina não aceita chamadas direto do navegador, então o app fala com a <b>Ponte do Mac</b>, que guarda a chave no Mac e repassa. A chave não fica no navegador.</p>
    <label class="campo">Endereço da ponte<input id="gp" value="${esc(c.grok.ponte)}"></label>
    <label class="campo">Token da ponte na nuvem (só se usar a versão Cloudflare; a do Mac não pede)<input id="gpt" type="password" placeholder="${c.grok.ponte_token ? "guardado neste aparelho" : "vazio"}" autocomplete="off"></label>
    <div class="passo"><b>1</b><div>No Terminal do Mac: <code>cd ~/Documents/ChefeGeral/chefe-geral-hub && ./scripts/set-webhook-key.sh</code> e cole o valor do cabeçalho como aparece no painel da rotina.</div></div>
    <div class="passo"><b>2</b><div>Conferir: <code>./scripts/relay-status.sh</code></div></div>
    <p class="muted small">Use o Chrome no Mac (o Safari bloqueia o acesso a 127.0.0.1 a partir de um site https). No celular a ponte não é alcançável: os pedidos ficam na fila e vão quando o Mac ligar, ou você manda pelo Telegram.</p>
    <details><summary class="muted small">Avançado: chamar o webhook direto (só se ele liberar CORS)</summary>
      <label class="check"><input type="checkbox" id="gdir" ${c.grok.modo === "direto" ? "checked" : ""}> Usar modo direto</label>
      <label class="campo">URL do webhook<input id="gu" type="url" value="${esc(c.grok.url)}" placeholder="https://..."></label>
      <label class="campo">Cabeçalho<input id="gh" value="${esc(c.grok.header)}"></label>
      <label class="campo">Valor (fica no localStorage deste aparelho)<input id="gk" type="password" ${seg(c.grok.chave, "cole aqui")}></label></details>
    <div class="row-btn"><button class="primary">Salvar</button><button type="button" class="ghost" data-t="grok">Testar motor</button></div></form>

  <form class="card" id="fo"><h3>Motor 2: Ollama <span class="tag ollama" style="margin:0">experimental</span></h3>
    <p class="muted small">IA aberta e gratuita rodando no Mac. Responde aqui no app; não executa nas ferramentas. Para este site falar com o Ollama, no Terminal do Mac: <code>./scripts/install-relay.sh</code> já deixa isso fixo a cada login (LaunchAgent com.chefegeral.ollama-origins); na primeira vez, reabra o Ollama. Manual: <code>launchctl setenv OLLAMA_ORIGINS "https://guilh-abc.github.io,http://localhost:*,http://127.0.0.1:*"</code>. Funciona no Chrome do próprio Mac.</p>
    <label class="campo">Endereço<input id="ou" value="${esc(c.ollama.url)}"></label>
    <label class="campo">Modelo<input id="om" value="${esc(c.ollama.modelo)}" placeholder="llama3.2"></label>
    <div class="row-btn"><button class="primary">Salvar</button><button type="button" class="ghost" data-t="ollama">Testar motor</button></div></form>

  <form class="card" id="ft"><h3>Telegram ${st(c.telegram.token && c.telegram.chat_id, "configurado", "falta configurar")}</h3>
    <div class="passo"><b>1</b><div>No Telegram, abra <b>@BotFather</b>, mande <code>/newbot</code>, escolha um nome e um usuário terminado em <code>bot</code>.</div></div>
    <div class="passo"><b>2</b><div>Copie o token que o BotFather mandar e cole aqui.</div></div>
    <label class="campo">Token do bot<input id="tk" type="password" ${seg(c.telegram.token, "123456:ABC...")}></label>
    <div class="passo"><b>3</b><div>Abra o seu bot no Telegram e mande <code>/start</code>. Depois toque em Descobrir chat_id.</div></div>
    <label class="campo">chat_id<input id="tc" value="${esc(c.telegram.chat_id)}" placeholder="ex.: 123456789"></label>
    <label class="campo">Usuário do bot (para "Abrir no Telegram" no celular)<input id="tb" value="${esc(c.telegram.bot)}" placeholder="ex.: chefegeral_gui_bot"></label>
    <div class="row-btn"><button type="button" class="ghost" id="tdesc">Descobrir chat_id</button><button class="primary">Salvar</button><button type="button" class="ghost" data-t="telegram">Enviar teste</button></div>
    <p class="muted small">O app só manda mensagem para este chat, e só quando você toca em Enviar.</p>
    <p class="muted small"><b>Ponte do Mac + Telegram:</b> para o Mac receber o que você manda ao bot (texto e voz), rode no Mac <code>./scripts/set-telegram.sh</code>. Depois disso, use "Descobrir chat_id" só antes de ligar a ponte (os dois disputam as mensagens).</p></form>

  <form class="card" id="fob"><h3>Segundo cérebro: Obsidian <span class="pill" id="obst2">pela ponte do Mac</span></h3>
    <p class="muted small">Padrão: a <b>Ponte do Mac</b> grava as notas direto no cofre, só dentro da pasta <b>Chefe Geral</b>, e nunca altera notas existentes. Uma vez no Mac: <code>./scripts/set-obsidian.sh ~/Documents/Obsidian</code>. Sem o Mac ao alcance (celular), as notas ficam na fila deste aparelho e vão quando o Mac aparecer.</p>
    <label class="check"><input type="checkbox" id="obrest" ${c.obsidian.via === "rest" ? "checked" : ""}> Usar o plugin Local REST API em vez da ponte (opcional)</label>
    <details><summary class="muted small">Plugin Local REST API (opcional)</summary>
    <div class="passo"><b>1</b><div>No Obsidian do Mac: Ajustes › Plugins da comunidade › Ativar › Procurar <b>Local REST API</b> › Instalar › Ativar.</div></div>
    <div class="passo"><b>2</b><div>Nas opções do plugin, copie a <b>API Key</b> e cole aqui.</div></div>
    <div class="passo"><b>3</b><div>No Chrome do Mac, abra <code>https://127.0.0.1:27124</code> uma vez e aceite o certificado.</div></div>
    <label class="campo">Endereço<input id="obu" value="${esc(c.obsidian.url)}"></label>
    <label class="campo">API Key<input id="obk" type="password" ${seg(c.obsidian.chave, "cole aqui")}></label>
    </details>
    <label class="campo">Nome do cofre (para abrir notas pelo link obsidian://; o Testar preenche)<input id="obv" value="${esc(c.obsidian.cofre)}"></label>
    <label class="check"><input type="checkbox" id="obc" ${c.obsidian.captura ? "checked" : ""}> Captura contínua (pedidos, notas e reuniões viram notas)</label>
    <div class="row-btn"><button class="primary">Salvar</button><button type="button" class="ghost" data-t="obsidian">Testar</button><button type="button" class="ghost" id="obs">Sincronizar fila</button></div></form>

  <div class="card" id="fdados"><h3>Dados deste aparelho</h3><p class="muted small">Pedidos, reuniões e a fila de notas ficam no IndexedDB do navegador. Ajustes e chaves, no localStorage. Nada vai para o GitHub.</p>
    <div class="row-btn"><button class="ghost" id="dexp">Exportar dados (.json, sem chaves)</button><button class="ghost" id="dlimpa">Apagar chaves deste aparelho</button></div></div>`;

  // Celular: o caminho é o bot do Telegram. Os passos de Terminal do Mac ficam recolhidos.
  if (emCelular()) {
    const bot = BOT();
    const det = document.createElement("details"); det.className = "mac-avancado";
    det.innerHTML = `<summary>Ajustes do Mac (Terminal, motores e ponte). Só servem no Mac.</summary>`;
    [...el.children].filter(x => x.id !== "fdados").forEach(x => det.append(x));
    el.prepend(det);
    el.insertAdjacentHTML("afterbegin", `<div class="card cel-card" id="fcel"><h3>No celular você usa o Telegram</h3>
      <p class="small">Aqui no celular a ponte do Mac não aparece, e isso é normal. O seu canal é o bot <b>@${bot}</b>: o Mac lê o que você manda, o Chefe Geral responde no próprio bot e a resposta fica no Obsidian, em <b>Chefe Geral/Respostas</b>.</p>
      <div class="row-btn"><a class="tg" href="https://t.me/${bot}" target="_blank" rel="noopener">Abrir @${bot}</a></div>
      <div class="passo"><b>1</b><div>Escreva o pedido no bot, ou use Pedir na tela inicial: o app abre o bot com o texto pronto e você toca em Enviar.</div></div>
      <div class="passo"><b>2</b><div>Para áudio, segure o microfone no próprio bot e mande a nota de voz. O Mac transcreve.</div></div>
      <div class="passo"><b>3</b><div>Reunião: mande o áudio no bot com a legenda <code>/reuniao</code> e o resumo volta lá.</div></div>
      <p class="muted small">Se o Mac estiver desligado, o bot guarda as mensagens e a ponte pega tudo quando ele ligar.</p></div>`);
  }
  const salvo = () => aviso("Salvo neste aparelho");
  el.addEventListener("change", e => { if (e.target.name === "motor") { gravar({motor: e.target.value}); salvo(); } });
  $("#fg", el).onsubmit = e => { e.preventDefault(); gravar({grok: {modo: $("#gdir", el).checked ? "direto" : ler().grok.modo === "nuvem" ? "nuvem" : "ponte", ponte: $("#gp", el).value.trim() || "http://127.0.0.1:8788", url: $("#gu", el).value.trim(), header: $("#gh", el).value.trim() || "Authorization", ...($("#gk", el).value ? {chave: $("#gk", el).value.trim()} : {}), ...($("#gpt", el).value ? {ponte_token: $("#gpt", el).value.trim()} : {})}}); salvo(); reabrir(el); };
  $("#fn", el).onsubmit = e => { e.preventDefault(); const usa = $("#nuse", el).checked, url = $("#nu", el).value.trim();
    if (usa && !/^https:\/\//.test(url)) return aviso("A URL do Worker começa com https://", true);
    if (usa && !$("#nt", el).value && !ler().grok.nuvem?.token) return aviso("Cole o token do app", true);
    gravar({grok: {modo: usa ? "nuvem" : (ler().grok.modo === "nuvem" ? "ponte" : ler().grok.modo), nuvem: {url, ...($("#nt", el).value ? {token: $("#nt", el).value.trim()} : {})}}}); salvo(); reabrir(el); };
  $("#ntest", el).onclick = async () => { try { const m = await import("../engines/grok-webhook.js"); if (!m.nuvem()) throw new Error("Marque a opção, cole URL e token e salve antes");
    const j = await m.nuvemApi("/respostas?limite=1"); if (j.erro) throw new Error(j.erro); aviso("Ponte na nuvem ok: token aceito"); } catch (err) { aviso(err.message, true); } };
  if (c.grok.modo === "nuvem") import("../engines/grok-webhook.js").then(m => m.saude()).then(s => { const p = $("#nst", el); if (p) { p.className = "pill " + (s.ligada ? "ok" : "no"); p.textContent = s.ligada ? "ligada" : "fora do ar"; } });
  import("../engines/grok-webhook.js").then(m => m.saude()).then(s => { const p = $("#pst", el); if (!p) return; p.className = "pill " + (s.ligada && s.chave_presente ? "ok" : "no"); p.textContent = c.grok.modo === "nuvem" ? (s.ligada ? "pela nuvem" : "nuvem fora do ar") : c.grok.modo !== "ponte" ? "modo direto" : s.ligada ? (s.chave_presente ? "ponte ligada" : "ponte sem chave") : emCelular() ? "no celular: pelo Telegram" : "ponte desligada"; if (!s.ligada && emCelular()) p.className = "pill ok"; });
  $("#fo", el).onsubmit = e => { e.preventDefault(); gravar({ollama: {url: $("#ou", el).value.trim(), modelo: $("#om", el).value.trim()}}); salvo(); };
  $("#ft", el).onsubmit = e => { e.preventDefault(); gravar({telegram: {chat_id: $("#tc", el).value.trim(), bot: $("#tb", el).value.trim().replace(/^@/, ""), ...($("#tk", el).value ? {token: $("#tk", el).value.trim()} : {})}}); salvo(); reabrir(el); };
  $("#fob", el).onsubmit = e => { e.preventDefault(); gravar({obsidian: {via: $("#obrest", el).checked ? "rest" : "ponte", url: $("#obu", el).value.trim(), cofre: $("#obv", el).value.trim(), captura: $("#obc", el).checked, ...($("#obk", el).value ? {chave: $("#obk", el).value.trim()} : {})}}); salvo(); reabrir(el); };
  el.addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    try {
      if (b.dataset.t === "grok") aviso(await (await import("../engines/grok-webhook.js")).testar());
      if (b.dataset.t === "ollama") aviso(await (await import("../engines/ollama.js")).testar());
      if (b.dataset.t === "telegram") {
        const {confirmar} = await import("../core/gate.js");
        if (await confirmar({titulo: "Enviar mensagem de teste?", para: "Seu chat no Telegram (" + ler().telegram.chat_id + ")", conteudo: "Teste do app Chefe Geral: o Telegram está funcionando."})) { await (await import("../channels/telegram.js")).testar(); aviso("Teste enviado. Confira no Telegram."); }
      }
      if (b.dataset.t === "obsidian") aviso(await (await import("../memory/obsidian.js")).testar());
      if (b.id === "obs") { const r = await (await import("../memory/obsidian.js")).sincronizar(); aviso(`${r.ok} de ${r.total} notas gravadas no Obsidian`); }
      if (b.id === "tdesc") {
        if ($("#tk", el).value) gravar({telegram: {token: $("#tk", el).value.trim()}});
        const chats = await (await import("../channels/telegram.js")).descobrirChats();
        if (!chats.length) return aviso("Nenhuma conversa. Mande /start ao seu bot e tente de novo.", true);
        $("#tc", el).value = chats[0].chat_id;
        const me = await (await import("../channels/telegram.js")).quemSou().catch(() => null); if (me) $("#tb", el).value = me.username; aviso("Encontrado: " + chats.map(x => x.chat_id + (x.nome ? " (" + x.nome + ")" : "")).join(", ") + ". Toque em Salvar.");
      }
      if (b.id === "dexp") { const d = await exportarTudo(); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], {type: "application/json"})); a.download = "chefe-geral-dados.json"; a.click(); }
      if (b.id === "dlimpa" && confirm("Apagar webhook, token do Telegram e chave do Obsidian deste aparelho?")) { gravar({grok: {chave: "", ponte_token: "", nuvem: {token: ""}}, telegram: {token: "", chat_id: ""}, obsidian: {chave: ""}}); reabrir(el); }
    } catch (err) { aviso(err.message, true); }
  });
}
