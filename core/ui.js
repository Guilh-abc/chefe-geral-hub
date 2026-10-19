export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
export function quando(iso) {
  if (!iso) return "";
  const [d, h] = iso.split("T"); const [, m, dd] = d.split("-");
  return `${dd}/${m}` + (h ? " " + h.slice(0, 5) : "");
}
export function aviso(msg, erro = false) {
  let t = $("#aviso");
  t.textContent = msg; t.className = "aviso show" + (erro ? " err" : "");
  clearTimeout(t._t); t._t = setTimeout(() => t.className = "aviso", 4500);
}
export const STATUS = {fila: "Fila", andamento: "Em andamento", concluido: "Concluído", erro: "Erro", cancelado: "Cancelado"};
