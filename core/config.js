// Ajustes no localStorage deste aparelho. Segredos nunca vão para o código nem para o GitHub.
const K = "cg.ajustes.v1";
export const PADRAO = {
  motor: "grok",                      // "grok" (Motor 1) ou "ollama" (Motor 2, experimental)
  grok: {url: "", header: "Authorization", chave: ""},
  ollama: {url: "http://127.0.0.1:11434", modelo: "llama3.2:3b"},
  telegram: {token: "", chat_id: ""},
  obsidian: {url: "https://127.0.0.1:27124", chave: "", cofre: "", pasta: "Chefe Geral", captura: true},
  regrasReuniao: [
    "Comece com uma frase de amigo, direto e sincero, dizendo como foi a reunião",
    "Pontos principais em até 5 tópicos",
    "Decisões tomadas",
    "Ações com responsável e prazo (quem, o quê, até quando)",
    "O que foi bem",
    "O que melhorar na próxima",
    "Tom amigável e direto, sem enrolação, em português do Brasil"
  ]
};
function merge(a, b) { for (const k in b) a[k] = (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) ? merge(a[k] || {}, b[k]) : b[k]; return a; }
export function ler() {
  try { return merge(structuredClone(PADRAO), JSON.parse(localStorage.getItem(K) || "{}")); } catch { return structuredClone(PADRAO); }
}
export function gravar(patch) { const c = merge(ler(), patch); localStorage.setItem(K, JSON.stringify(c)); return c; }
export function semSegredos(c = ler()) {
  const x = structuredClone(c);
  x.grok.chave = x.grok.chave ? "(definida)" : ""; x.telegram.token = x.telegram.token ? "(definido)" : "";
  x.obsidian.chave = x.obsidian.chave ? "(definida)" : ""; return x;
}
