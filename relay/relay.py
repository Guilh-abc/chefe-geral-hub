#!/usr/bin/env python3
"""Ponte do Mac para o Chefe Geral (somente biblioteca padrão, Python 3.9+).

HTTP em 127.0.0.1:8788
  GET  /health          estado da ponte (sem segredos)
  POST /pedido          repassa o JSON do app ao webhook da rotina com o cabeçalho Authorization
  GET  /mensagens       últimas mensagens recebidas do seu bot (log local, sem segredos)
  GET  /memoria         capturas pendentes para o Obsidian (o app importa e grava no cofre)
  POST /memoria/ok      {"ids": [...]} marca capturas como importadas

Telegram (opcional): faz long polling de getUpdates do SEU bot, aceita só o seu chat_id,
transforma texto, nota de voz, áudio e documento em pedido e responde "Recebido".

Segredos (nunca no repositório, nunca no log), em ~/Library/Application Support/ChefeGeral/:
  webhook.key      valor completo do cabeçalho Authorization (ex.: "Bearer ..."), chmod 600
  telegram.token   token do BotFather, chmod 600
Configuração sem segredo: relay.json (webhook_url, chat_id, porta).
"""
import json, os, re, shutil, subprocess, sys, threading, time, urllib.error, urllib.parse, urllib.request, uuid, base64
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSAO = "1.0"
HOME = os.path.expanduser("~")
DIR = os.environ.get("CHEFE_DIR", os.path.join(HOME, "Library", "Application Support", "ChefeGeral"))
LOGDIR = os.environ.get("CHEFE_LOGDIR", os.path.join(HOME, "Library", "Logs", "ChefeGeral"))
CFG = os.path.join(DIR, "relay.json")
KEY = os.path.join(DIR, "webhook.key")
TOKEN = os.path.join(DIR, "telegram.token")
ESTADO = os.path.join(DIR, "relay-estado.json")
MSGS = os.path.join(DIR, "mensagens.jsonl")
MEMORIA = os.path.join(DIR, "obsidian-fila.jsonl")
AUDIOS = os.path.join(DIR, "audios")
BRT = timezone(timedelta(hours=-3))
ORIGENS = ("https://guilh-abc.github.io",)
LOCAL_ORIGEM = re.compile(r"^http://(localhost|127\.0\.0\.1)(:\d+)?$")
LOCK = threading.Lock()
STATUS = {"telegram_ultimo_poll": None, "telegram_erro": None, "inicio": None}


def agora():
    return datetime.now(BRT).isoformat(timespec="seconds")


def log(msg):
    os.makedirs(LOGDIR, exist_ok=True)
    msg = re.sub(r"bot\d+:[\w-]+", "bot<token>", str(msg))  # nunca grava o token
    with open(os.path.join(LOGDIR, "relay.log"), "a", encoding="utf-8") as f:
        f.write(f"{agora()} {msg}\n")


def ler_json(path, padrao):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return padrao


def gravar_json(path, dados):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def ler_segredo(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    except FileNotFoundError:
        return ""


def cfg():
    c = ler_json(CFG, {})
    c.setdefault("porta", 8788)
    c.setdefault("webhook_url", "")
    c.setdefault("chat_id", "")
    return c


def anexar_jsonl(path, obj):
    with LOCK, open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def ler_jsonl(path, limite=200):
    try:
        with open(path, encoding="utf-8") as f:
            linhas = f.readlines()[-limite:]
    except FileNotFoundError:
        return []
    out = []
    for l in linhas:
        try:
            out.append(json.loads(l))
        except json.JSONDecodeError:
            pass
    return out


# ---------- Webhook ----------
def ja_enviado(pid):
    est = ler_json(ESTADO, {})
    return pid and pid in est.get("enviados", [])


def marcar_enviado(pid):
    if not pid:
        return
    with LOCK:
        est = ler_json(ESTADO, {})
        env = est.get("enviados", [])
        env.append(pid)
        est["enviados"] = env[-500:]
        gravar_json(ESTADO, est)


def repassar(payload):
    """Envia ao webhook. Retorna (status_http, texto_resposta)."""
    c = cfg()
    if not c["webhook_url"]:
        return 503, "webhook_url não configurada em relay.json"
    chave = ler_segredo(KEY)
    if not chave:
        return 503, "Chave do webhook ausente. Rode scripts/set-webhook-key.sh"
    pid = ((payload or {}).get("pedido") or {}).get("id")
    if pid and pid != "teste" and ja_enviado(pid):
        return 200, json.dumps({"duplicado": True, "detalhe": "Pedido já repassado antes"})
    dados = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(c["webhook_url"], data=dados, method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": chave,
                                          "User-Agent": "ChefeGeral-Ponte/" + VERSAO})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            corpo = r.read(65536).decode("utf-8", "replace")
            if pid and pid != "teste":
                marcar_enviado(pid)
            log(f"webhook {r.status} pedido={pid} tipo={payload.get('tipo')}")
            return r.status, corpo
    except urllib.error.HTTPError as e:
        corpo = e.read(2048).decode("utf-8", "replace")
        log(f"webhook {e.code} pedido={pid} tipo={payload.get('tipo')}")
        return e.code, corpo
    except Exception as e:
        log(f"webhook falha de rede: {e}")
        return 502, f"Falha de rede: {e}"


# ---------- Obsidian (fila de capturas) ----------
def capturar(modulo, titulo, corpo, pid, tags=()):
    q = agora()
    slug = re.sub(r"[^\w\s-]", "", titulo, flags=re.U).strip()[:50] or "nota"
    pasta = {"pedidos": "Pedidos", "reunioes": "Reunioes", "notas": "Notas de voz"}.get(modulo, "Inbox")
    caminho = f"Chefe Geral/{pasta}/{q[:10]} {q[11:16].replace(':', 'h')} {slug} {str(pid)[-4:]}.md"
    tg = ", ".join(json.dumps(t, ensure_ascii=False) for t in ("chefe-geral", modulo, "telegram") + tuple(tags))
    md = f"---\ndata: {q}\nmodulo: {modulo}\nid: {json.dumps(str(pid))}\norigem: ponte-mac\ntags: [{tg}]\n---\n\n# {titulo}\n\n{corpo}\n"
    anexar_jsonl(MEMORIA, {"id": "m" + uuid.uuid4().hex[:10], "caminho": caminho, "md": md, "titulo": titulo,
                           "modulo": modulo, "quando": q, "importado": False})


# ---------- Telegram ----------
def tg(metodo, params=None, timeout=60):
    token = ler_segredo(TOKEN)
    if not token:
        raise RuntimeError("sem token")
    dados = urllib.parse.urlencode(params or {}).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/{metodo}", data=dados)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        j = json.loads(r.read().decode("utf-8"))
    if not j.get("ok"):
        raise RuntimeError(j.get("description", "erro"))
    return j["result"]


def tg_responder(texto):
    try:
        tg("sendMessage", {"chat_id": cfg()["chat_id"], "text": texto[:4000]}, timeout=20)
    except Exception as e:
        log(f"telegram resposta falhou: {e}")


def baixar(file_id, nome):
    token = ler_segredo(TOKEN)
    f = tg("getFile", {"file_id": file_id}, timeout=30)
    os.makedirs(AUDIOS, exist_ok=True)
    destino = os.path.join(AUDIOS, nome + os.path.splitext(f["file_path"])[1])
    with urllib.request.urlopen(f"https://api.telegram.org/file/bot{token}/{f['file_path']}", timeout=120) as r, open(destino, "wb") as out:
        shutil.copyfileobj(r, out)
    return destino


def transcrever(arquivo):
    """Transcrição local PAUSADA: o motor (VoiceStudio ou SoundCraft) ainda não foi confirmado pelo Guilherme.
    Por enquanto o áudio fica em audios/ no Mac e o caminho vai no payload. Retorna None."""
    return None


def payload_base(tipo, texto, pid, modulo, anexos=None):
    return {"versao": 1, "origem": "chefe-geral-ponte-telegram", "tipo": tipo, "enviado_em": agora(),
            "pedido": {"id": pid, "texto": texto, "modulo": modulo, "vertente": None, "opcao": None,
                       "canal": "telegram", "criado_em": agora(), "camada": 4},
            "anexos": anexos, "confirmado_pelo_usuario": False, "obsidian_context": [],
            "instrucoes": {"responder_por": "telegram",
                           "confirmacao": "Antes de enviar algo a outra pessoa, publicar ou gravar na agenda, peça o OK do Guilherme.",
                           "memoria": "Notas novas vão para a pasta Chefe Geral do cofre."}}


def tratar_mensagem(m):
    texto = (m.get("text") or m.get("caption") or "").strip()
    pid = "tg" + str(m.get("message_id"))
    tipo, modulo, anexos = "pedido", "pedidos", None
    # Mensagem do app no celular: "#pedido {json}" ou "#reuniao {json}"
    tag = re.match(r"^#(pedido|reuniao)\b\s*(.*)$", texto, re.S)
    if tag:
        corpo = tag.group(2).strip()
        try:
            j = json.loads(corpo)
            pid = j.get("id") or pid
            texto = j.get("texto") or ""
            modulo = j.get("modulo") or modulo
            if tag.group(1) == "reuniao" or j.get("tipo") == "reuniao_resumo":
                tipo, modulo = "reuniao_resumo", "reunioes"
                anexos = {"titulo": j.get("titulo"), "regras": j.get("regras") or [], "transcricao": j.get("transcricao") or texto}
        except json.JSONDecodeError:
            texto = corpo
            if tag.group(1) == "reuniao":
                tipo, modulo, anexos = "reuniao_resumo", "reunioes", {"transcricao": corpo, "regras": []}
    if texto.startswith("/start"):
        tg_responder("Ponte do Chefe Geral ligada. Mande texto ou nota de voz e eu repasso ao Chefe Geral. Use /reuniao na legenda de um áudio ou .txt para pedir o resumo da reunião.")
        return
    nome_doc = ((m.get("document") or {}).get("file_name") or "").lower()
    reuniao = texto.startswith("/reuniao") or tipo == "reuniao_resumo" or nome_doc.startswith("reuniao")
    if texto.startswith("/reuniao"):
        texto = texto[len("/reuniao"):].strip()
    midia = m.get("voice") or m.get("audio") or (m.get("document") if ((m.get("document") or {}).get("mime_type") or "").startswith(("audio/", "text/")) or nome_doc.endswith((".txt", ".md")) else None)
    aviso_transc = ""
    if midia:
        try:
            arq = baixar(midia["file_id"], pid)
        except Exception as e:
            tg_responder(f"Recebi o arquivo, mas não consegui baixar: {e}")
            return
        if arq.endswith((".txt", ".md", ".vtt", ".srt")):
            with open(arq, encoding="utf-8", errors="replace") as f:
                transc = f.read()
        else:
            transc = transcrever(arq)
        info = {"arquivo_no_mac": arq, "mime": midia.get("mime_type"), "duracao_s": midia.get("duration")}
        if transc:
            info["transcricao"] = transc
        else:
            aviso_transc = " Transcrição no Mac em pausa (motor a confirmar). O áudio ficou no Mac; mandei só o caminho."
        if reuniao:
            tipo, modulo = "reuniao_resumo", "reunioes"
            anexos = {"titulo": texto or "Reunião pelo Telegram", "regras": [], "transcricao": transc or "", **info}
            texto = texto or "Resumo da reunião enviada pelo Telegram"
        else:
            anexos = info
            texto = (texto + "\n\n" if texto else "") + (transc or "(nota de voz sem transcrição)")
            modulo = "notas" if not m.get("caption") else modulo
    elif reuniao and tipo != "reuniao_resumo":
        tipo, modulo, anexos = "reuniao_resumo", "reunioes", {"titulo": "Reunião pelo Telegram", "regras": [], "transcricao": texto}
    if not texto and not anexos:
        return
    anexar_jsonl(MSGS, {"id": pid, "quando": agora(), "texto": texto[:2000], "tipo": tipo, "midia": bool(midia)})
    capturar(modulo, (texto or "Mensagem")[:60], texto if tipo != "reuniao_resumo" else (anexos or {}).get("transcricao", texto), pid)
    st, corpo = repassar(payload_base(tipo, texto, pid, modulo, anexos))
    if 200 <= st < 300:
        tg_responder(f"Recebido. Camada 1 (captura) ok; camada 4: entregue ao Chefe Geral (HTTP {st}).{aviso_transc}")
    else:
        tg_responder(f"Recebido e guardado no Mac, mas o Chefe Geral não aceitou agora (HTTP {st}). Vou manter na fila do log.{aviso_transc}")


def loop_telegram():
    while True:
        c = cfg()
        if not (ler_segredo(TOKEN) and c["chat_id"]):
            time.sleep(30)
            continue
        est = ler_json(ESTADO, {})
        try:
            ups = tg("getUpdates", {"offset": est.get("offset", 0), "timeout": 50, "allowed_updates": json.dumps(["message"])}, timeout=65)
            STATUS["telegram_ultimo_poll"], STATUS["telegram_erro"] = agora(), None
            for u in ups:
                with LOCK:
                    est = ler_json(ESTADO, {})
                    est["offset"] = u["update_id"] + 1
                    gravar_json(ESTADO, est)
                m = u.get("message") or {}
                if str((m.get("chat") or {}).get("id")) != str(c["chat_id"]) or str((m.get("from") or {}).get("id")) != str(c["chat_id"]):
                    continue  # ignora qualquer outra pessoa ou grupo
                try:
                    tratar_mensagem(m)
                except Exception as e:
                    log(f"erro ao tratar mensagem: {e}")
        except Exception as e:
            STATUS["telegram_erro"] = str(e)[:200]
            log(f"telegram poll: {e}")
            time.sleep(10)


# ---------- HTTP ----------
class Ponte(BaseHTTPRequestHandler):
    server_version = "ChefeGeralPonte/" + VERSAO

    def log_message(self, fmt, *args):
        log(f"http {self.command} {self.path.split('?')[0]} {args[1] if len(args) > 1 else ''}")

    def origem_ok(self):
        o = self.headers.get("Origin")
        return o is None or o in ORIGENS or bool(LOCAL_ORIGEM.match(o))

    def cors(self):
        o = self.headers.get("Origin")
        if o and (o in ORIGENS or LOCAL_ORIGEM.match(o)):
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Vary", "Origin")

    def responder(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def do_OPTIONS(self):
        if not self.origem_ok():
            self.send_response(403)
            self.end_headers()
            return
        self.send_response(204)
        self.cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self):
        if not self.origem_ok():
            return self.responder(403, {"erro": "origem não permitida"})
        u = urllib.parse.urlparse(self.path)
        if u.path == "/health":
            c = cfg()
            return self.responder(200, {"ok": True, "ponte": "ligada", "versao": VERSAO, "hora": agora(),
                                        "webhook_configurado": bool(c["webhook_url"]), "chave_presente": bool(ler_segredo(KEY)),
                                        "telegram": {"token_presente": bool(ler_segredo(TOKEN)), "chat_id_definido": bool(c["chat_id"]),
                                                     "ultimo_poll": STATUS["telegram_ultimo_poll"], "erro": STATUS["telegram_erro"]},
                                        "transcricao_local": "pausada (motor a confirmar)"})
        if u.path == "/mensagens":
            lim = int((urllib.parse.parse_qs(u.query).get("limite") or ["30"])[0])
            return self.responder(200, {"mensagens": list(reversed(ler_jsonl(MSGS, min(lim, 200))))})
        if u.path == "/memoria":
            return self.responder(200, {"notas": [n for n in ler_jsonl(MEMORIA, 1000) if not n.get("importado")]})
        return self.responder(404, {"erro": "rota desconhecida"})

    def do_POST(self):
        if not self.origem_ok():
            return self.responder(403, {"erro": "origem não permitida"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > 8_000_000:
            return self.responder(400, {"erro": "corpo vazio ou grande demais"})
        try:
            corpo = json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return self.responder(400, {"erro": "JSON inválido"})
        path = urllib.parse.urlparse(self.path).path
        if path == "/pedido":
            st, txt = repassar(corpo)
            try:
                resp = json.loads(txt)
            except Exception:
                resp = None
            return self.responder(st if st >= 200 else 502, {"ok": 200 <= st < 300, "webhook_status": st,
                                                            "resposta": resp, "detalhe": None if resp is not None else txt[:300]})
        if path == "/memoria/ok":
            ids = set(corpo.get("ids") or [])
            with LOCK:
                notas = ler_jsonl(MEMORIA, 100000)
                for x in notas:
                    if x["id"] in ids:
                        x["importado"] = True
                with open(MEMORIA, "w", encoding="utf-8") as f:
                    for x in notas:
                        f.write(json.dumps(x, ensure_ascii=False) + "\n")
            return self.responder(200, {"ok": True, "marcadas": len(ids)})
        return self.responder(404, {"erro": "rota desconhecida"})


def main():
    os.makedirs(DIR, exist_ok=True)
    os.makedirs(LOGDIR, exist_ok=True)
    STATUS["inicio"] = agora()
    porta = int(os.environ.get("CHEFE_PORTA") or cfg()["porta"])
    srv = ThreadingHTTPServer(("127.0.0.1", porta), Ponte)
    threading.Thread(target=loop_telegram, daemon=True).start()
    log(f"ponte ligada em 127.0.0.1:{porta}")
    print(f"Ponte do Chefe Geral em http://127.0.0.1:{porta}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
