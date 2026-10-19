// Portão de confirmação: nada sai para ninguém, nem grava na agenda, sem o seu toque em "Enviar".
import {salvar, agoraISO} from "./db.js";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
export function confirmar({titulo, para, conteudo, botao = "Enviar"}) {
  return new Promise(resolve => {
    const d = document.createElement("dialog");
    d.className = "sheet";
    d.innerHTML = `<form method="dialog"><h3>${esc(titulo)}</h3>${para ? `<p class="muted small">Para: <b>${esc(para)}</b></p>` : ""}
      <pre class="preview">${esc(conteudo).slice(0, 6000)}</pre>
      <p class="muted small">Só sai depois do seu toque em ${esc(botao)}.</p>
      <div class="row-btn"><button value="nao" class="ghost">Cancelar</button><button value="sim" class="primary">${esc(botao)}</button></div></form>`;
    document.body.append(d);
    d.addEventListener("close", async () => {
      const ok = d.returnValue === "sim";
      d.remove();
      salvar("acoes", {titulo, para, resumo: String(conteudo).slice(0, 300), status: ok ? "confirmada" : "cancelada", em: agoraISO()}).catch(() => {});
      resolve(ok);
    });
    d.showModal();
  });
}
