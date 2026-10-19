// IndexedDB leve: registros com paginação por cursor e arquivamento.
const NOME = "chefe-geral", VERSAO = 1;
const STORES = ["pedidos", "reunioes", "acoes", "memoria", "blobs", "tarefas", "notas", "mensagens"];
let dbp;
function abrir() {
  if (dbp) return dbp;
  dbp = new Promise((ok, erro) => {
    const r = indexedDB.open(NOME, VERSAO);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) {
        const os = db.createObjectStore(s, {keyPath: "id"});
        if (s !== "blobs") os.createIndex("criado_em", "criado_em");
      }
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  });
  return dbp;
}
const tx = async (s, modo = "readonly") => (await abrir()).transaction(s, modo).objectStore(s);
const req = r => new Promise((ok, erro) => { r.onsuccess = () => ok(r.result); r.onerror = () => erro(r.error); });

export const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const agoraISO = () => {
  const d = new Date(Date.now() - 3 * 3600e3);
  return d.toISOString().slice(0, 19) + "-03:00";
};

export async function salvar(s, obj) {
  obj.id ||= novoId();
  obj.criado_em ||= agoraISO();
  obj.atualizado_em = agoraISO();
  await req((await tx(s, "readwrite")).put(obj));
  return obj;
}
export async function pegar(s, id) { return req((await tx(s)).get(id)); }
export async function apagar(s, id) { return req((await tx(s, "readwrite")).delete(id)); }
export async function atualizar(s, id, fn) {
  const o = await pegar(s, id); if (!o) return null;
  fn(o); return salvar(s, o);
}
// Página do mais novo para o mais antigo. filtro(o) opcional. antes = criado_em do último item da página anterior.
export async function pagina(s, {limite = 20, antes = null, filtro = null, arquivados = false} = {}) {
  const os = await tx(s);
  const faixa = antes ? IDBKeyRange.upperBound(antes, true) : null;
  return new Promise((ok, erro) => {
    const out = [];
    const c = os.index("criado_em").openCursor(faixa, "prev");
    c.onsuccess = () => {
      const cur = c.result;
      if (!cur || out.length >= limite) return ok(out);
      const v = cur.value;
      if ((arquivados || !v.arquivado) && (!filtro || filtro(v))) out.push(v);
      cur.continue();
    };
    c.onerror = () => erro(c.error);
  });
}
export async function contar(s, filtro) {
  const os = await tx(s);
  if (!filtro) return req(os.count());
  return new Promise(ok => {
    let n = 0; const c = os.openCursor();
    c.onsuccess = () => { const cur = c.result; if (!cur) return ok(n); if (filtro(cur.value)) n++; cur.continue(); };
  });
}
// Arquiva itens concluídos/cancelados mais velhos que N dias (somem das listas, continuam no aparelho).
export async function arquivarAntigos(s, dias = 30, finais = ["concluido", "cancelado", "enviado"]) {
  const limite = new Date(Date.now() - dias * 864e5 - 3 * 3600e3).toISOString().slice(0, 19);
  const os = await tx(s, "readwrite");
  return new Promise(ok => {
    let n = 0; const c = os.openCursor();
    c.onsuccess = () => {
      const cur = c.result; if (!cur) return ok(n);
      const v = cur.value;
      if (!v.arquivado && finais.includes(v.status) && (v.atualizado_em || "") < limite) { v.arquivado = true; cur.update(v); n++; }
      cur.continue();
    };
  });
}
export async function exportarTudo() {
  const out = {};
  for (const s of STORES) if (s !== "blobs") out[s] = await req((await tx(s)).getAll());
  return out;
}
