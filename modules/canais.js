// Canais e motores: tudo fica só no localStorage deste aparelho. Nada disso vai para o GitHub.
import {$, esc, aviso} from "../core/ui.js";
import {ler, gravar} from "../core/config.js";
import {exportarTudo} from "../core/db.js";

export default async function abrir(el) {
  const c = ler();
  const st = (ok, s1, s2) => `<span class="pill ${ok ? "ok" : "no"}">${ok ? s1 : s2}</span>`;
  const seg = (v, ph) => `placeholder="${v ? "salvo, cole para trocar" : ph}"`;
  el.innerHTML = `
  <div class="card"><h3>Motor padrão</h3>
    <label class="check"><input type="radio" name="motor" value="grok" ${c.motor === "grok" ? "checked" : ""}> Motor 1: Chefe Geral (Grok), pela rotina de webhook</label>
    <label class="check"><input type="radio" name="motor" value="ollama" ${c.motor === "ollama" ? "checked" : ""}> Motor 2: Ollama no Mac <span class="tag ollama" style="margin:0">experimental</span></label>
    <p class="muted small">Você também escolhe o motor em cada pedido, na tela inicial.</p></div>

  <form class="card" id="fg"><h3>Motor 1: Chefe Geral ${st(c.grok.url && c.grok.chave, "configurado", "falta configurar")}</h3>
    <p class="muted small">No painel da rotina "Console Chefe Geral, pedidos do app", copie a URL e a chave. O painel mostra o formato do cabeçalho: por padrão <code>Authorization</code> com o valor exatamente como aparece lá.</p>
    <label class="campo">URL do webhook<input id="gu" type="url" value="${esc(c.grok.url)}" placeholder="https://..."></label>
    <label class="campo">Cabeçalho<input id="gh" value="${esc(c.grok.header)}"></label>
    <label class="campo">Valor (chave)<input id="gk" type="password" ${seg(c.grok.chave, "cole aqui")}></label>
    <div class="row-btn"><button class="primary">Salvar</button><button type="button" class="ghost" data-t="grok">Testar motor</button></div></form>

  <form class="card" id="fo"><h3>Motor 2: Ollama <span class="tag ollama" style="margin:0">experimental</span></h3>
    <p class="muted small">IA aberta e gratuita rodando no Mac. Responde aqui no app; não executa nas ferramentas. Para este site falar com o Ollama, no Terminal do Mac: <code>launchctl setenv OLLAMA_ORIGINS "${esc(location.origin)}"</code> e reabra o Ollama. Funciona no Chrome do próprio Mac.</p>
    <label class="campo">Endereço<input id="ou" value="${esc(c.ollama.url)}"></label>
    <label class="campo">Modelo<input id="om" value="${esc(c.ollama.modelo)}" placeholder="llama3.2:3b"></label>
    <div class="row-btn"><button class="primary">Salvar</button><button type="button" class="ghost" data-t="ollama">Testar motor</button></div></form>

  <form class="card" id="ft"><h3>Telegram ${st(c.telegram.token && c.telegram.chat_id, "configurado", "falta configurar")}</h3>
    <div class="passo"><b>1</b><div>No Telegram, abra <b>@BotFather</b>, mande <code>/newbot</code>, escolha um nome e um usuário terminado em <code>bot</code>.</div></div>
    <div class="passo"><b>2</b><div>Copie o token que o BotFather mandar e cole aqui.</div></div>
    <label class="campo">Token do bot<input id="tk" type="password" ${seg(c.telegram.token, "123456:ABC...")}></label>
    <div class="passo"><b>3</b><div>Abra o seu bot no Telegram e mande <code>/start</code>. Depois toque em Descobrir chat_id.</div></div>
    <label class="campo">chat_id<input id="tc" value="${esc(c.telegram.chat_id)}" placeholder="ex.: 123456789"></label>
    <div class="row-btn"><button type="button" class="ghost" id="tdesc">Descobrir chat_id</button><button class="primary">Salvar</button><button type="button" class="ghost" data-t="telegram">Enviar teste</button></div>
    <p class="muted small">O app só manda mensagem para este chat, e só quando você toca em Enviar.</p></form>

  <form class="card" id="fob"><h3>Segundo cérebro: Obsidian ${st(c.obsidian.chave, "conectado", "na fila do app")}</h3>
    <p class="muted small">O app grava notas só dentro da pasta <b>${esc(c.obsidian.pasta)}</b> do cofre e nunca altera notas existentes. Sem conexão, as notas ficam na fila deste aparelho.</p>
    <div class="passo"><b>1</b><div>No Obsidian do Mac: Ajustes › Plugins da comunidade › Ativar › Procurar <b>Local REST API</b> › Instalar › Ativar.</div></div>
    <div class="passo"><b>2</b><div>Nas opções do plugin, copie a <b>API Key</b> e cole aqui.</div></div>
    <div class="passo"><b>3</b><div>No Chrome do Mac, abra <code>https://127.0.0.1:27124</code> uma vez e aceite o certificado.</div></div>
    <label class="campo">Endereço<input id="obu" value="${esc(c.obsidian.url)}"></label>
    <label class="campo">API Key<input id="obk" type="password" ${seg(c.obsidian.chave, "cole aqui")}></label>
    <label class="campo">Nome do cofre (para abrir notas pelo link obsidian://)<input id="obv" value="${esc(c.obsidian.cofre)}"></label>
    <label class="check"><input type="checkbox" id="obc" ${c.obsidian.captura ? "checked" : ""}> Captura contínua (pedidos, notas e reuniões viram notas)</label>
    <div class="row-btn"><button class="primary">Salvar</button><button type="button" class="ghost" data-t="obsidian">Testar</button><button type="button" class="ghost" id="obs">Sincronizar fila</button></div></form>

  <div class="card"><h3>Dados deste aparelho</h3><p class="muted small">Pedidos, reuniões e a fila de notas ficam no IndexedDB do navegador. Ajustes e chaves, no localStorage. Nada vai para o GitHub.</p>
    <div class="row-btn"><button class="ghost" id="dexp">Exportar dados (.json, sem chaves)</button><button class="ghost" id="dlimpa">Apagar chaves deste aparelho</button></div></div>`;

  const salvo = () => aviso("Salvo neste aparelho");
  el.addEventListener("change", e => { if (e.target.name === "motor") { gravar({motor: e.target.value}); salvo(); } });
  $("#fg", el).onsubmit = e => { e.preventDefault(); gravar({grok: {url: $("#gu", el).value.trim(), header: $("#gh", el).value.trim() || "Authorization", ...($("#gk", el).value ? {chave: $("#gk", el).value.trim()} : {})}}); salvo(); abrir(el); };
  $("#fo", el).onsubmit = e => { e.preventDefault(); gravar({ollama: {url: $("#ou", el).value.trim(), modelo: $("#om", el).value.trim()}}); salvo(); };
  $("#ft", el).onsubmit = e => { e.preventDefault(); gravar({telegram: {chat_id: $("#tc", el).value.trim(), ...($("#tk", el).value ? {token: $("#tk", el).value.trim()} : {})}}); salvo(); abrir(el); };
  $("#fob", el).onsubmit = e => { e.preventDefault(); gravar({obsidian: {url: $("#obu", el).value.trim(), cofre: $("#obv", el).value.trim(), captura: $("#obc", el).checked, ...($("#obk", el).value ? {chave: $("#obk", el).value.trim()} : {})}}); salvo(); abrir(el); };
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
        $("#tc", el).value = chats[0].chat_id; aviso("Encontrado: " + chats.map(x => x.chat_id + (x.nome ? " (" + x.nome + ")" : "")).join(", ") + ". Toque em Salvar.");
      }
      if (b.id === "dexp") { const d = await exportarTudo(); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], {type: "application/json"})); a.download = "chefe-geral-dados.json"; a.click(); }
      if (b.id === "dlimpa" && confirm("Apagar webhook, token do Telegram e chave do Obsidian deste aparelho?")) { gravar({grok: {chave: ""}, telegram: {token: "", chat_id: ""}, obsidian: {chave: ""}}); abrir(el); }
    } catch (err) { aviso(err.message, true); }
  });
}
