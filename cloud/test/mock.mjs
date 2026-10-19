// Servidor falso: Telegram Bot API + webhook da rotina. Registra chamadas em /log.
import http from "node:http";
const log = [];
http.createServer((q, s) => {
  let b = ""; q.on("data", c => b += c); q.on("end", () => {
    if (q.url === "/log") { s.end(JSON.stringify(log)); return; }
    log.push({url: q.url.replace(/bot[^/]+/, "bot<t>"), auth: q.headers.authorization || null, body: b.slice(0, 3000)});
    s.setHeader("Content-Type", "application/json");
    if (q.url.includes("/getFile")) return s.end(JSON.stringify({ok: true, result: {file_path: JSON.parse(b).file_id.startsWith("T") ? "doc.txt" : "voz.ogg"}}));
    if (q.url.includes("/file/")) return s.end(q.url.endsWith(".txt") ? "Ata: decidimos fechar a Sensify." : "OGGFAKE");
    if (q.url.startsWith("/webhook")) return s.end(JSON.stringify({camada: 4, status: "andamento"}));
    s.end(JSON.stringify({ok: true, result: {message_id: 1}}));
  });
}).listen(9911, () => console.log("mock on"));
