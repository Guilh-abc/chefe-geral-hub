#!/usr/bin/env python3
"""Ponte do Mac para o Chefe Geral (somente biblioteca padrão, Python 3.9+).

HTTP em 127.0.0.1:8788
  GET  /health          estado da ponte (sem segredos)
  POST /pedido          repassa o JSON do app ao webhook da rotina com o cabeçalho Authorization
  GET  /mensagens       últimas mensagens recebidas do seu bot (log local, sem segredos)
  GET  /memoria         capturas pendentes para o Obsidian (o app importa e grava no cofre)
  POST /memoria/ok      {"ids": [...]} marca capturas como importadas
  POST /transcrever     corpo = o áudio (audio/*). Transcreve no VoiceStudio (pt) e devolve {ok, texto}. O áudio é apagado depois.

Transcrição: VoiceStudio em 127.0.0.1:3900 (/v1/audio/transcriptions, faster-whisper large-v3). Nada sai do Mac.
Se o VoiceStudio estiver fechado, o áudio do Telegram fica em audios/ e a ponte tenta de novo a cada minuto.

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

VERSAO = "1.1"
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
PENDENTES = os.path.join(DIR, "stt-pendentes.json")
STT_URL = os.environ.get("CHEFE_STT_URL", "http://127.0.0.1:3900/v1/audio/transcriptions")
REGRAS_PADRAO = [
    "Comece com uma frase de amigo, direto e sincero, dizendo como foi a reunião",
    "Pontos principais em até 5 tópicos",
    "Decisões tomadas",
    "Ações com responsável e prazo (quem, o quê, até quando)",
    "O que foi bem",
    "O que melhorar na próxima",
    "Tom amigável e direto, sem enrolação, em português do Brasil",
]
ACK = "Recebido. A resposta completa chega no chat do Chefe Geral."
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


class STTFechado(Exception):
    pass


def stt_url():
    return cfg().get("stt_url") or STT_URL


def vs_ligado():
    u = urllib.parse.urlparse(stt_url())
    try:
        urllib.request.urlopen(f"{u.scheme}://{u.netloc}/", timeout=2).close()
        return True
    except urllib.error.HTTPError:
        return True  # respondeu, mesmo que 404: está aberto
    except Exception:
        return False


def transcrever(arquivo, mime=None):
    """Transcreve no VoiceStudio (pt). Retorna o texto. STTFechado se o VoiceStudio não responder."""
    limite = "----chefegeral" + uuid.uuid4().hex
    nome = os.path.basename(arquivo)
    with open(arquivo, "rb") as f:
        audio = f.read()
    partes = []
    for k, v in (("language", "pt"), ("response_format", "json")):
        partes.append(f'--{limite}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    partes.append(f'--{limite}\r\nContent-Disposition: form-data; name="file"; filename="{nome}"\r\nContent-Type: {mime or "application/octet-stream"}\r\n\r\n'.encode() + audio + b"\r\n")
    partes.append(f"--{limite}--\r\n".encode())
    req = urllib.request.Request(stt_url(), data=b"".join(partes), headers={"Content-Type": "multipart/form-data; boundary=" + limite})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=4 * 3600) as r:
            j = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"VoiceStudio HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:200]}")
    except (urllib.error.URLError, ConnectionError, OSError) as e:
        raise STTFechado(str(e))
    texto = (j.get("text") or "").strip()
    log(f"transcrição ok: {len(audio)} bytes em {time.time() - t0:.1f}s, {len(texto)} caracteres")
    return texto


def regras():
    return cfg().get("regras_reuniao") or REGRAS_PADRAO


def pendentes():
    return ler_json(PENDENTES, [])


def guardar_pendentes(lista):
    with LOCK:
        gravar_json(PENDENTES, lista)


def entregar_audio(item, transc):
    """Monta o payload com a transcrição (não o áudio), repassa, avisa no Telegram e apaga o áudio do Mac."""
    leg, pid = item.get("legenda") or "", item["pid"]
    if item.get("reuniao"):
        tipo, modulo = "reuniao_resumo", "reunioes"
        texto = leg or "Resumo da reunião enviada pelo Telegram"
        anexos = {"titulo": leg or "Reunião pelo Telegram", "regras": regras(), "transcricao": transc,
                  "duracao_s": item.get("duracao_s"), "origem_audio": "telegram"}
    else:
        tipo, modulo = "pedido", item.get("modulo") or "notas"
        texto = (leg + "\n\n" if leg else "") + (transc or "(áudio sem fala reconhecida)")
        anexos = {"transcricao": transc, "duracao_s": item.get("duracao_s"), "origem_audio": "telegram"}
    anexar_jsonl(MSGS, {"id": pid, "quando": agora(), "texto": texto[:2000], "tipo": tipo, "midia": True})
    capturar(modulo, (leg or transc or "Nota de voz")[:60], transc if tipo == "reuniao_resumo" else texto, pid)
    st, _ = repassar(payload_base(tipo, texto, pid, modulo, anexos))
    try:
        os.remove(item["arquivo"])
    except OSError:
        pass
    trecho = (transc[:300] + "...") if len(transc) > 300 else transc
    if 200 <= st < 300:
        tg_responder(f"{ACK}\n\nTranscrição: {trecho}")
    else:
        tg_responder(f"Transcrevi e guardei no Mac, mas o Chefe Geral não aceitou agora (HTTP {st}).\n\nTranscrição: {trecho}")


def loop_stt():
    """Tenta de novo os áudios que chegaram com o VoiceStudio fechado."""
    while True:
        time.sleep(60)
        lista = pendentes()
        if not lista or not vs_ligado():
            continue
        for item in list(lista):
            try:
                transc = transcrever(item["arquivo"], item.get("mime"))
            except STTFechado:
                break
            except Exception as e:
                item["tentativas"] = item.get("tentativas", 0) + 1
                log(f"transcrição pendente falhou ({item['pid']}): {e}")
                if item["tentativas"] < 5:
                    continue
                tg_responder(f"Não consegui transcrever um áudio depois de 5 tentativas. Ele ficou no Mac: {item['arquivo']}")
                transc = None
            lista = [x for x in pendentes() if x["pid"] != item["pid"]]
            guardar_pendentes(lista)
            if transc is not None:
                entregar_audio(item, transc)


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
    if midia:
        try:
            arq = baixar(midia["file_id"], pid)
        except Exception as e:
            tg_responder(f"Recebi o arquivo, mas não consegui baixar: {e}")
            return
        if arq.endswith((".txt", ".md", ".vtt", ".srt")):
            with open(arq, encoding="utf-8", errors="replace") as f:
                transc = f.read()
            if reuniao:
                tipo, modulo = "reuniao_resumo", "reunioes"
                anexos = {"titulo": texto or "Reunião pelo Telegram", "regras": regras(), "transcricao": transc}
                texto = texto or "Resumo da reunião enviada pelo Telegram"
            else:
                anexos = {"transcricao": transc}
                texto = (texto + "\n\n" if texto else "") + transc
        else:
            item = {"pid": pid, "arquivo": arq, "mime": midia.get("mime_type"), "duracao_s": midia.get("duration"),
                    "legenda": texto, "reuniao": reuniao, "modulo": "notas" if not m.get("caption") else modulo, "quando": agora()}
            try:
                transc = transcrever(arq, item["mime"])
            except STTFechado:
                guardar_pendentes(pendentes() + [item])
                tg_responder("VoiceStudio fechado, transcrevo quando abrir.")
                return
            except Exception as e:
                log(f"transcrição falhou ({pid}): {e}")
                guardar_pendentes(pendentes() + [item])
                tg_responder("Não consegui transcrever agora; o áudio ficou no Mac e eu tento de novo em instantes.")
                return
            return entregar_audio(item, transc)
    elif reuniao and tipo != "reuniao_resumo":
        tipo, modulo, anexos = "reuniao_resumo", "reunioes", {"titulo": "Reunião pelo Telegram", "regras": [], "transcricao": texto}
    if not texto and not anexos:
        return
    anexar_jsonl(MSGS, {"id": pid, "quando": agora(), "texto": texto[:2000], "tipo": tipo, "midia": bool(midia)})
    capturar(modulo, (texto or "Mensagem")[:60], texto if tipo != "reuniao_resumo" else (anexos or {}).get("transcricao", texto), pid)
    st, corpo = repassar(payload_base(tipo, texto, pid, modulo, anexos))
    if 200 <= st < 300:
        tg_responder(ACK)
    else:
        tg_responder(f"Recebido e guardado no Mac, mas o Chefe Geral não aceitou agora (HTTP {st}).")


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

    def post_transcrever(self, n):
        """Áudio do app no Mac: grava num arquivo temporário, transcreve, apaga e devolve só o texto."""
        if n <= 0 or n > 1_000_000_000:
            return self.responder(400, {"ok": False, "erro": "áudio vazio ou grande demais"})
        tipo = (self.headers.get("Content-Type") or "application/octet-stream").split(";")[0].strip()
        ext = {"audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a", "audio/mpeg": ".mp3",
               "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/wave": ".wav", "audio/aac": ".aac", "audio/flac": ".flac"}.get(tipo, ".bin")
        os.makedirs(AUDIOS, exist_ok=True)
        arq = os.path.join(AUDIOS, "app-" + uuid.uuid4().hex[:10] + ext)
        try:
            with open(arq, "wb") as f:
                falta = n
                while falta > 0:
                    bloco = self.rfile.read(min(falta, 1 << 20))
                    if not bloco:
                        break
                    f.write(bloco)
                    falta -= len(bloco)
            t0 = time.time()
            texto = transcrever(arq, tipo)
            return self.responder(200, {"ok": True, "texto": texto, "segundos": round(time.time() - t0, 1), "motor": "VoiceStudio"})
        except STTFechado:
            return self.responder(503, {"ok": False, "erro": "VoiceStudio fechado. Abra o VoiceStudio no Mac e tente de novo."})
        except Exception as e:
            log(f"/transcrever falhou: {e}")
            return self.responder(502, {"ok": False, "erro": str(e)[:300]})
        finally:
            try:
                os.remove(arq)
            except OSError:
                pass

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
                                        "transcricao_local": {"motor": "VoiceStudio (faster-whisper large-v3)", "ligado": vs_ligado(),
                                                              "pendentes": len(pendentes())}})
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
        if urllib.parse.urlparse(self.path).path == "/transcrever":
            return self.post_transcrever(n)
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
    threading.Thread(target=loop_stt, daemon=True).start()
    log(f"ponte ligada em 127.0.0.1:{porta}")
    print(f"Ponte do Chefe Geral em http://127.0.0.1:{porta}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
