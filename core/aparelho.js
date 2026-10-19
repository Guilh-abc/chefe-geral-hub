// Celular x Mac. No celular a ponte 127.0.0.1:8788 nunca existe: o canal é o bot do Telegram.
// A ponte do Mac lê o que você manda ao bot; a resposta volta no Telegram e vai para o Obsidian.
import {ler} from "./config.js";

export const BOT = () => (ler().telegram.bot || "Chefegui_bot").replace(/^@/, "");
export const LIMITE_LINK = 3500;
// Link do bot, com o texto pronto quando cabe no link (null quando é grande demais).
export function linkBot(texto) {
  const b = "https://t.me/" + BOT();
  if (!texto) return b;
  return texto.length > LIMITE_LINK ? null : b + "?text=" + encodeURIComponent(texto);
}
// Parece celular: user agent móvel, ou tela estreita com toque (um Mac com janela estreita não conta).
export function pareceCelular() {
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPod|Mobile|Windows Phone/i.test(ua)) return true;
  return matchMedia("(max-width: 760px)").matches && (navigator.maxTouchPoints || 0) > 0;
}
// Modo celular: parece celular e a ponte não responde. Atualizado pela casca a cada checagem da ponte.
let ponte = null;   // null = ainda não checou
export function definirPonte(ligada) {
  ponte = !!ligada;
  document.body.classList.toggle("celular", emCelular());
}
export const emCelular = () => pareceCelular() && ponte !== true && !nuvemAtiva();
// Com a ponte na nuvem configurada, o celular usa o app normalmente (não abre o Telegram).
export function nuvemAtiva() { const g = ler().grok; return g.modo === "nuvem" && !!(g.nuvem?.url && g.nuvem?.token); }
// Abre o bot com o texto pronto. Chame direto no toque (sem await antes) para o navegador não bloquear.
export function abrirBot(texto) {
  const u = linkBot(texto) || linkBot();
  abrirLink(u);
  return u !== linkBot() || !texto;
}
export function abrirLink(u) {
  const a = document.createElement("a");
  a.href = u; a.target = "_blank"; a.rel = "noopener";
  document.body.append(a); a.click(); a.remove();
}
export const cartaoBot = (titulo, texto) => `<div class="card cel-card"><h3>${titulo}</h3><p class="small">${texto}</p>
  <div class="row-btn"><a class="tg" href="https://t.me/${BOT()}" target="_blank" rel="noopener">Abrir @${BOT()}</a></div></div>`;
