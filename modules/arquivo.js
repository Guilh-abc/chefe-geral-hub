// Arquivo: viewer SOMENTE LEITURA do que o Chefe Geral cria. Pela ponte do Mac (lista branca de pastas) e pelos dados deste aparelho.
import {$, $$, esc, aviso, quando} from "../core/ui.js";
import {ler} from "../core/config.js";
import {pagina, pegar} from "../core/db.js";
import {emCelular, BOT, nuvemAtiva} from "../core/aparelho.js";

const ABAS = [["recentes", "Recentes"], ["documentos", "Documentos"], ["mensagens", "Mensagens"], ["transcricoes", "Transcrições"], ["obsidian", "Obsidian"], ["busca", "Busca"]];
const base = () => (ler().grok.ponte || "http://127.0.0.1:8788").replace(/\/$/, "");
const tam = n => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(1) + " MB";

async function api(rota, params = {}) {
  const u = base() + rota + "?" + new URLSearchParams(params);
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(u, {signal: ctl.signal});
    if (!r.ok) { let e = "HTTP " + r.status; try { e = (await r.json()).erro || e; } catch {} throw new Error(e); }
    return r;
  } catch (e) { if (e.name === "AbortError" || e instanceof TypeError) { const x = new Error("PONTE_OFF"); x.code = "PONTE_OFF"; throw x; } throw e; }
  finally { clearTimeout(t); }
}
const json = async (rota, p) => (await api(rota, p)).json();

// Markdown simples e seguro (escapa tudo antes).
function md(txt) {
  txt = txt.replace(/^---\n[\s\S]*?\n---\n/, "");
  const blocos = txt.split(/```/);
  return blocos.map((b, i) => i % 2 ? `<pre>${esc(b.replace(/^\w*\n/, ""))}</pre>` : esc(b)
    .replace(/^### (.*)$/gm, "<h4>$1</h4>").replace(/^## (.*)$/gm, "<h3>$1</h3>").replace(/^# (.*)$/gm, "<h2>$1</h2>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => `<a href="#" data-wiki="${a}">${b || a}</a>`)
    .replace(/^\s*[-*] (.*)$/gm, "• $1").replace(/\n/g, "<br>")).join("");
}

export default async function abrir(el) {
  let aba = "recentes", info = null, ligada = false, urlBlob = null;
  el.innerHTML = `<div class="card small" id="aest"></div>
    <div class="chips" id="abas">${ABAS.map(([id, n]) => `<button class="ghost" data-aba="${id}">${n}</button>`).join(" ")}</div>
    <div id="acont" style="margin-top:10px"></div>
    <div class="card" id="aview" hidden></div>`;
  const cont = $("#acont", el), view = $("#aview", el);

  try { info = await json("/arquivos/raizes"); ligada = true; } catch (e) { ligada = false; info = {erro: e.code === "PONTE_OFF" ? null : e.message}; }
  $("#aest", el).innerHTML = !ligada && nuvemAtiva()
    ? `<b>Pela ponte na nuvem.</b> Aqui aparecem pedidos, respostas, transcrições, reuniões e as notas do Obsidian (pasta Chefe Geral) guardados na sua conta Cloudflare, mesmo com o Mac desligado. PDFs e outros documentos aparecem no Chrome do Mac.`
    : ligada
    ? `Ponte do Mac ligada. Pastas liberadas (só leitura): ${info.raizes.map(r => `<b>${esc(r.nome)}</b>`).join(", ")}. Segredos e a pasta nrf9151-ntn nunca aparecem.`
    : emCelular() ? `<b>No celular, aqui aparece só o que está neste aparelho</b>: pedidos, notas de voz e reuniões feitos por aqui. Os documentos, transcrições e notas do Obsidian aparecem no Mac (abra este app no Chrome do Mac), e as respostas do Chefe Geral ficam no <a class="tg" href="https://t.me/${BOT()}" target="_blank" rel="noopener">@${BOT()}</a> e no Obsidian, em Chefe Geral/Respostas.`
    : `<b>Ponte do Mac fora de alcance.</b> ${info.erro ? esc(info.erro) + ". " : ""}No celular ou fora do Mac é normal: aqui aparece só o que está guardado neste aparelho (pedidos, notas de voz e reuniões). No Mac, abra no Chrome, permita o acesso à rede local e confira a ponte em Canais.`;

  const caminhoBox = it => `<div class="small muted" style="word-break:break-all;margin-top:6px">📁 ${esc(it.absoluto)}</div>
    <div class="acoes"><button data-copiar="${esc(it.absoluto)}">Copiar caminho</button>${obsLink(it) ? `<a class="ghost" href="${obsLink(it)}">Abrir no Obsidian</a>` : ""}</div>`;
  const obsLink = it => it.raiz === "obsidian" && /\.md$/.test(it.caminho) ? `obsidian://open?vault=${encodeURIComponent(info?.obsidian?.nome || "Obsidian")}&file=${encodeURIComponent(it.caminho.replace(/\.md$/, ""))}` : "";
  const linha = it => `<div class="item" data-raiz="${esc(it.raiz)}" data-cam="${esc(it.caminho)}" data-tipo="${it.tipo}"><div class="item-h"><span>${it.tipo === "pasta" ? "📁" : /^audio/.test(it.mime || "") ? "🎧" : /pdf/.test(it.mime || "") ? "📄" : /^image/.test(it.mime || "") ? "🖼️" : "📝"}</span>
    <div class="item-t"><b>${esc(it.nome)}</b>${it.trecho ? `<div class="small">${esc(it.trecho)}</div>` : ""}
    <div class="item-m">${esc(it.raiz)}/${esc(it.caminho)}${it.tipo === "arquivo" ? " · " + tam(it.tamanho) : ""} · ${quando(it.mtime)}</div></div></div></div>`;
  const lista = (itens, vazio = "Nada aqui ainda.") => itens.length ? itens.map(linha).join("") : `<div class="vazio">${vazio}</div>`;

  async function local(tipo) {
    const out = [];
    if (tipo !== "transcricoes") for (const p of await pagina("pedidos", {limite: 30, arquivados: true})) out.push({q: p.criado_em, t: "Pedido", x: p.texto, r: p.resposta});
    if (tipo !== "mensagens") {
      for (const n of await pagina("notas", {limite: 30})) out.push({q: n.criado_em, t: "Nota de voz", x: n.texto || "(sem transcrição)"});
      for (const r of await pagina("reunioes", {limite: 30, arquivados: true})) out.push({q: r.criado_em, t: "Reunião: " + (r.titulo || ""), x: r.transcricao || r.texto || "(sem transcrição)", r: r.resumo});
    }
    out.sort((a, b) => (b.q || "").localeCompare(a.q || ""));
    return `<h2 class="sec">Neste aparelho</h2>` + (out.length ? out.map(o => `<div class="item"><div class="item-t"><b>${esc(o.t)}</b> <span class="item-m">${quando(o.q)}</span>
      <div class="small" style="white-space:pre-wrap">${esc(String(o.x || "").slice(0, 1500))}</div>${o.r ? `<details><summary class="small">Resposta</summary><div class="small" style="white-space:pre-wrap">${esc(typeof o.r === "string" ? o.r : JSON.stringify(o.r, null, 1)).slice(0, 4000)}</div></details>` : ""}</div></div>`).join("") : `<div class="vazio">Nada guardado neste aparelho.</div>`);
  }

  // Ponte na nuvem: pedidos, respostas, transcrições e reuniões guardados no Worker (vistos no Mac e no celular).
  async function nuvemSec(tipos, titulo = "Na nuvem") {
    if (!nuvemAtiva()) return "";
    const {nuvemApi} = await import("../engines/grok-webhook.js");
    const NOME = {pedidos: "Pedido", respostas: "Resposta", transcricoes: "Transcrição", reunioes: "Reunião"};
    try {
      const res = (await Promise.all(tipos.map(t => nuvemApi("/" + t + "?limite=40").then(j => (j.itens || []).map(i => ({...i, rot: NOME[t]})))))).flat()
        .sort((a, b) => b.criado_em.localeCompare(a.criado_em));
      return `<h2 class="sec">${titulo}</h2>` + (res.length ? res.map(i => `<div class="item"><div class="item-t"><b>${esc(i.rot)}: ${esc(i.titulo || "")}</b> <span class="item-m">${quando(i.criado_em)}${i.meta?.canal ? " · " + esc(i.meta.canal) : ""}</span>
        <details${i.tipo === "resposta" ? " open" : ""}><summary class="small">Ver texto</summary><div class="small" style="white-space:pre-wrap">${esc(String(i.texto || "").slice(0, 6000))}</div></details></div></div>`).join("")
        : `<div class="vazio">Nada na nuvem ainda.</div>`);
    } catch (e) { return `<h2 class="sec">${titulo}</h2><div class="vazio">${esc(e.message)}</div>`; }
  }

  // Obsidian na nuvem: espelho da pasta Chefe Geral no R2 (lido no celular e com o Mac desligado). Só leitura aqui.
  async function obsNuvem(q = "") {
    if (!nuvemAtiva()) return "";
    const {nuvemApi} = await import("../engines/grok-webhook.js");
    const form = `<form id="onf" class="row"><input id="onq" placeholder="Buscar nas notas da nuvem" value="${esc(q)}" style="flex:1"><button class="ghost">Buscar</button></form>`;
    try {
      const itens = q ? (await nuvemApi("/obsidian/busca?q=" + encodeURIComponent(q))).resultados || []
        : ((await nuvemApi("/obsidian/list?limite=2000")).itens || []).sort((a, b) => (b.atualizado || "").localeCompare(a.atualizado || "")).slice(0, 80);
      return `<h2 class="sec">Obsidian na nuvem</h2><p class="small muted">Cópia da pasta Chefe Geral, sincronizada com o Obsidian do Mac sempre que ele está ligado.</p>${form}` +
        (itens.length ? itens.map(i => `<div class="item" data-obsn="${esc(i.caminho)}"><div class="item-h"><span>${/conflito/.test(i.caminho) ? "⚠️" : "📝"}</span><div class="item-t"><b>${esc(i.caminho.split("/").pop().replace(/\.md$/, ""))}</b>${i.trecho ? `<div class="small">${esc(i.trecho)}</div>` : ""}
          <div class="item-m">${esc(i.caminho.split("/").slice(1, -1).join("/") || "Chefe Geral")} · ${quando(i.atualizado)}${i.origem ? " · " + esc(i.origem) : ""}</div></div></div></div>`).join("")
          : `<div class="vazio">${q ? "Nada encontrado." : "Nenhuma nota na nuvem ainda. Elas sobem quando a ponte do Mac (1.5) estiver ligada."}</div>`);
    } catch (e) { return `<h2 class="sec">Obsidian na nuvem</h2>${form}<div class="vazio">${esc(e.message)}</div>`; }
  }
  async function verNuvem(cam) {
    view.hidden = false; view.innerHTML = `<p class="muted">Abrindo...</p>`; view.scrollIntoView({behavior: "smooth"});
    try {
      const {nuvemApi} = await import("../engines/grok-webhook.js");
      const j = await nuvemApi("/obsidian/get?caminho=" + encodeURIComponent(cam));
      if (!j.ok) throw new Error(j.erro || "nota não encontrada");
      view.innerHTML = `<div class="row"><b style="flex:1">${esc(cam.split("/").pop())}</b><button class="ghost" data-fechar>Fechar</button></div>
        <div class="small muted" style="word-break:break-all;margin-top:6px">☁️ ${esc(cam)} · ${quando(j.atualizado)}</div>
        <div class="acoes"><a class="ghost" href="obsidian://open?vault=${encodeURIComponent(info?.obsidian?.nome || "Obsidian")}&file=${encodeURIComponent(cam.replace(/\.md$/, ""))}">Abrir no Obsidian</a></div>
        <div class="md" style="margin-top:10px">${md(j.md || "")}</div>`;
    } catch (e) { view.innerHTML = `<div class="vazio">${esc(e.message)}</div>`; }
  }

  const pasta = info?.obsidian?.pasta || "Chefe Geral";
  async function prefixos(lst, n = 60) {
    const res = await Promise.all(lst.map(p => json("/arquivos/recentes", {n, raiz: "obsidian", prefixo: pasta + "/" + p}).then(j => j.itens).catch(() => [])));
    return res.flat().sort((a, b) => b.mtime.localeCompare(a.mtime));
  }

  async function mostrarPasta(raiz, cam) {
    const j = await json("/arquivos/lista", {raiz, caminho: cam});
    const partes = j.caminho ? j.caminho.split("/") : [];
    cont.innerHTML = `<div class="small" style="margin-bottom:8px"><a href="#" data-nav="${esc(raiz)}|">${esc(j.raiz.nome)}</a>${partes.map((p, i) => ` / <a href="#" data-nav="${esc(raiz)}|${esc(partes.slice(0, i + 1).join("/"))}">${esc(p)}</a>`).join("")}</div>
      ${caminhoBox({absoluto: j.absoluto})}${lista(j.itens, "Pasta vazia.")}`;
  }

  async function render() {
    $$("[data-aba]", el).forEach(b => b.classList.toggle("ativo", b.dataset.aba === aba));
    view.hidden = true;
    cont.innerHTML = `<p class="muted">Carregando...</p>`;
    try {
      if (!ligada && nuvemAtiva()) {
        cont.innerHTML = aba === "obsidian" || aba === "busca" ? await obsNuvem()
          : aba === "documentos"
          ? `<div class="vazio">PDFs, Word e imagens ficam no Mac: esta aba aparece no Chrome do Mac com a ponte ligada. As notas do Obsidian estão na aba Obsidian, pela nuvem.</div>` + await nuvemSec(["respostas", "pedidos", "transcricoes", "reunioes"])
          : await nuvemSec(aba === "mensagens" ? ["pedidos", "respostas"] : aba === "transcricoes" ? ["transcricoes", "reunioes"] : ["respostas", "pedidos", "transcricoes", "reunioes"]) + await local(aba);
        return;
      }
      if (!ligada) {
        cont.innerHTML = aba === "documentos" || aba === "obsidian" || aba === "busca"
          ? `<div class="vazio">${emCelular() ? "Esta aba mostra os arquivos do Mac, então só aparece no Chrome do Mac. No celular, as respostas e documentos que o Chefe Geral manda chegam no @" + BOT() + "." : "Esta aba precisa da ponte do Mac. Abra o app no Chrome do Mac."}</div>` + await local(aba)
          : await local(aba);
        return;
      }
      if (aba === "recentes") cont.innerHTML = lista((await json("/arquivos/recentes", {n: 60})).itens);
      else if (aba === "documentos") {
        const ids = info.raizes.filter(r => r.id !== "obsidian");
        const res = (await Promise.all(ids.map(r => json("/arquivos/recentes", {n: 80, raiz: r.id}).then(j => j.itens).catch(() => []))))
          .flat().filter(i => !/\.(md|txt|json)$/i.test(i.nome)).sort((a, b) => b.mtime.localeCompare(a.mtime));
        cont.innerHTML = `<p class="small muted">PDF, Word, imagens e áudios nas pastas liberadas. Toque numa pasta abaixo para navegar.</p>
          <div class="acoes">${info.raizes.map(r => `<button data-nav="${esc(r.id)}|">${esc(r.nome)}</button>`).join("")}</div>` + lista(res);
      }
      else if (aba === "mensagens") cont.innerHTML = `<p class="small muted">Pedidos e respostas gravados no Obsidian em ${esc(pasta)}/Pedidos e ${esc(pasta)}/Respostas.</p>` + lista(await prefixos(["Pedidos", "Respostas", "Mensagens"])) + await nuvemSec(["pedidos", "respostas"], "Na nuvem (ainda indo para o Obsidian)") + await local("mensagens");
      else if (aba === "transcricoes") cont.innerHTML = `<p class="small muted">Notas de voz, reuniões e transcrições feitas no Mac.</p>` + lista(await prefixos(["Notas de voz", "Reunioes", "Transcricoes"])) + await local("transcricoes");
      else if (aba === "obsidian") { await mostrarPasta("obsidian", ""); if (nuvemAtiva()) cont.insertAdjacentHTML("beforeend", await obsNuvem()); }
      else if (aba === "busca") {
        cont.innerHTML = `<form id="abf" class="row"><input id="abq" placeholder="Buscar por nome ou texto (md e txt)" style="flex:1"><button class="ghost">Buscar</button></form><div id="abr"></div>`;
        $("#abf", el).onsubmit = async e => { e.preventDefault(); const q = $("#abq", el).value.trim(); if (!q) return;
          $("#abr", el).innerHTML = `<p class="muted">Buscando...</p>`;
          try { $("#abr", el).innerHTML = lista((await json("/arquivos/busca", {q})).resultados, "Nada encontrado."); } catch (e) { $("#abr", el).innerHTML = `<div class="vazio">${esc(e.message)}</div>`; } };
        $("#abq", el).focus();
      }
    } catch (e) {
      cont.innerHTML = `<div class="vazio">${e.code === "PONTE_OFF" ? "A ponte do Mac parou de responder." : esc(e.message)}</div>`;
    }
  }

  async function verArquivo(raiz, cam) {
    if (urlBlob) URL.revokeObjectURL(urlBlob), urlBlob = null;
    view.hidden = false; view.innerHTML = `<p class="muted">Abrindo...</p>`; view.scrollIntoView({behavior: "smooth"});
    const it = {raiz, caminho: cam, absoluto: (info.raizes.find(r => r.id === raiz)?.caminho || "") + "/" + cam};
    try {
      const r = await api("/arquivos/abrir", {raiz, caminho: cam});
      const mime = (r.headers.get("Content-Type") || "").split(";")[0];
      const nome = cam.split("/").pop();
      let corpo;
      if (/^text\/|json/.test(mime)) {
        const t = await r.text();
        corpo = mime === "text/markdown" ? `<div class="md">${md(t)}</div>` : `<pre style="white-space:pre-wrap">${esc(t)}</pre>`;
      } else {
        const b = await r.blob(); urlBlob = URL.createObjectURL(new Blob([b], {type: mime}));
        corpo = /pdf/.test(mime) ? `<iframe src="${urlBlob}" style="width:100%;height:70vh;border:0;border-radius:10px"></iframe>`
          : /^image/.test(mime) ? `<img src="${urlBlob}" style="max-width:100%;border-radius:10px">`
          : /^audio/.test(mime) ? `<audio controls src="${urlBlob}" style="width:100%"></audio>`
          : /^video/.test(mime) ? `<video controls src="${urlBlob}" style="width:100%"></video>`
          : `<p class="muted">Este tipo não tem prévia aqui.</p>`;
        corpo += `<div class="acoes"><a class="ghost" href="${urlBlob}" download="${esc(nome)}">Baixar</a></div>`;
      }
      view.innerHTML = `<div class="row"><b style="flex:1">${esc(nome)}</b><button class="ghost" data-fechar>Fechar</button></div>${caminhoBox(it)}<div style="margin-top:10px">${corpo}</div>`;
    } catch (e) { view.innerHTML = `<div class="vazio">${esc(e.code === "PONTE_OFF" ? "Ponte do Mac fora de alcance." : e.message)}</div>${caminhoBox(it)}`; }
  }

  el.addEventListener("submit", async e => {
    if (e.target.id !== "onf") return;
    e.preventDefault(); const q = $("#onq", el).value.trim();
    const sec = document.createElement("div"); sec.innerHTML = `<p class="muted">Buscando...</p>`;
    const alvo = e.target.closest("#acont"); const h = [...alvo.querySelectorAll("h2.sec")].find(x => x.textContent === "Obsidian na nuvem");
    const html = await obsNuvem(q);
    if (h) { while (h.nextSibling) h.nextSibling.remove(); h.insertAdjacentHTML("afterend", html.replace(/^<h2 class="sec">Obsidian na nuvem<\/h2>/, "")); } else alvo.innerHTML = html;
  });
  el.addEventListener("click", async e => {
    const t = e.target.closest("[data-aba],[data-nav],[data-copiar],[data-fechar],[data-wiki],[data-obsn],.item[data-raiz]");
    if (!t) return;
    if (t.dataset.obsn) return verNuvem(t.dataset.obsn);
    if (t.dataset.wiki && !ligada) { e.preventDefault(); return verNuvem("Chefe Geral/" + t.dataset.wiki.replace(/^Chefe Geral\//, "") + ".md"); }
    if (t.dataset.aba) { aba = t.dataset.aba; return render(); }
    if (t.dataset.copiar !== undefined) { e.preventDefault(); try { await navigator.clipboard.writeText(t.dataset.copiar); aviso("Caminho copiado"); } catch { aviso("Não consegui copiar", true); } return; }
    if (t.dataset.fechar !== undefined) { view.hidden = true; return; }
    if (t.dataset.nav !== undefined) { e.preventDefault(); const [r, c] = t.dataset.nav.split("|"); aba = r === "obsidian" ? "obsidian" : aba; try { await mostrarPasta(r, c); } catch (x) { aviso(x.message, true); } return; }
    if (t.dataset.wiki) { e.preventDefault(); return verArquivo("obsidian", t.dataset.wiki + ".md"); }
    if (t.dataset.tipo === "pasta") { try { await mostrarPasta(t.dataset.raiz, t.dataset.cam); } catch (x) { aviso(x.message, true); } return; }
    if (t.dataset.raiz) verArquivo(t.dataset.raiz, t.dataset.cam);
  });
  render();
}
