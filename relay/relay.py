#!/usr/bin/env python3
"""Ponte do Mac para o Chefe Geral (somente biblioteca padrão, Python 3.9+).

HTTP em 127.0.0.1:8788
  GET  /health          estado da ponte (sem segredos)
  POST /pedido          repassa o JSON do app ao webhook da rotina com o cabeçalho Authorization
  GET  /mensagens       últimas mensagens recebidas do seu bot (log local, sem segredos)
  GET  /memoria         capturas pendentes para o Obsidian (o app importa e grava no cofre)
  POST /memoria/ok      {"ids": [...]} marca capturas como importadas
  POST /obsidian/nota   {id, caminho, md, titulo, quando} ou {"notas": [...]}: grava no cofre, em "Chefe Geral/", sem duplicar por id
  GET  /obsidian/busca?q=   busca de texto no cofre inteiro (só leitura), até 5 trechos
  POST /transcrever     corpo = o áudio (audio/*). Transcreve no VoiceStudio (pt) e devolve {ok, texto}. O áudio é apagado depois.
  GET  /arquivos/raizes | /arquivos/lista?raiz=&caminho= | /arquivos/abrir?raiz=&caminho= | /arquivos/busca?q= | /arquivos/recentes?n=
                        viewer SOMENTE LEITURA, só nas raízes da lista branca (relay.json "arquivos_raizes"); nunca serve segredos.

Transcrição: VoiceStudio em 127.0.0.1:3900 (/v1/audio/transcriptions, faster-whisper large-v3). Nada sai do Mac.
Se o VoiceStudio estiver fechado, o áudio do Telegram fica em audios/ e a ponte tenta de novo a cada minuto.

Telegram (opcional): faz long polling de getUpdates do SEU bot, aceita só o seu chat_id,
transforma texto, nota de voz, áudio e documento em pedido e responde "Recebido".

Respostas do Chefe Geral no Obsidian (1.3): o bot não recebe as próprias mensagens no getUpdates.
A box manda cada resposta (cg-telegram-responder) com o botão "Guardando no Obsidian" e o cabeçalho
"Chefe Geral, resposta ao pedido <id>". A ponte sonda, só no SEU chat, os message_id que ela não viu
(lacunas e os próximos números) com editMessageReplyMarkup: a API devolve a mensagem inteira, a ponte
troca o botão para "No Obsidian" e grava em "Chefe Geral/Respostas". Nada é exposto à internet.

Segredos (nunca no repositório, nunca no log), em ~/Library/Application Support/ChefeGeral/:
  webhook.key      valor completo do cabeçalho Authorization (ex.: "Bearer ..."), chmod 600
  telegram.token   token do BotFather, chmod 600
Configuração sem segredo: relay.json (webhook_url, chat_id, porta).
"""
import json, os, re, shutil, subprocess, sys, threading, time, urllib.error, urllib.parse, urllib.request, uuid, base64
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSAO = "1.3"
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
ENVIO_LOCK = threading.Lock()   # a sondagem não roda enquanto a ponte está mandando mensagem
RESP_ESTADO = os.path.join(DIR, "respostas-estado.json")
RESP_LOCK = threading.Lock()
RESP_PREFIXO = "Chefe Geral, resposta ao pedido "
HUB_ARQUIVO = "https://guilh-abc.github.io/chefe-geral-hub/#/arquivo"
BOTAO_PENDENTE = json.dumps({"inline_keyboard": [[{"text": "Guardando no Obsidian…", "url": HUB_ARQUIVO}]]}, ensure_ascii=False)
BOTAO_OK = json.dumps({"inline_keyboard": [[{"text": "No Obsidian ✓", "url": HUB_ARQUIVO}]]}, ensure_ascii=False)
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
    payload = completar_contexto(payload)
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


# ---------- Obsidian (segundo cérebro) ----------
# Escreve SÓ dentro de <cofre>/<pasta> (padrão "Chefe Geral"). Nunca sobrescreve nem altera notas existentes;
# a única nota que recebe linhas novas é o diário do próprio Chefe Geral (Chefe Geral/Diario/AAAA-MM-DD.md).
# O caminho do cofre fica em relay.json ("obsidian_cofre") no Mac, nunca no código público.
OBS_INDICE = os.path.join(DIR, "obsidian-indice.json")
PASTAS_OBS = {"pedidos": "Pedidos", "reunioes": "Reunioes", "notas": "Notas de voz", "tarefas": "Tarefas",
              "agenda": "Agenda", "mensagens": "Mensagens", "decisoes": "Decisoes", "respostas": "Respostas",
              "transcricoes": "Transcricoes"}


def cofre():
    c = cfg()
    raiz = os.path.expanduser(c.get("obsidian_cofre") or "")
    if not raiz or not os.path.isdir(os.path.join(raiz, ".obsidian")):
        return None, None
    return os.path.realpath(raiz), (c.get("obsidian_pasta") or "Chefe Geral").strip("/")


def _dentro(raiz, pasta, rel):
    """Caminho absoluto seguro para rel (que precisa começar com a pasta), ou None."""
    rel = (rel or "").replace("\\", "/").lstrip("/")
    partes = rel.split("/")
    if not rel.endswith(".md") or partes[0] != pasta or any(x in ("", ".", "..") for x in partes) or len(rel) > 400:
        return None
    base = os.path.realpath(os.path.join(raiz, pasta))
    alvo = os.path.realpath(os.path.join(raiz, rel))
    if os.path.dirname(base) != raiz or not alvo.startswith(base + os.sep):
        return None
    return alvo


def montar_nota(modulo, titulo, corpo, nid, origem="ponte-mac", tags=()):
    q = agora()
    _, pasta = cofre()
    pasta = pasta or (cfg().get("obsidian_pasta") or "Chefe Geral")
    titulo = re.sub(r"\s+", " ", titulo or "Nota").strip()
    slug = re.sub(r"[^\w\s-]", "", titulo, flags=re.U).strip()[:50].strip() or "nota"
    caminho = f"{pasta}/{PASTAS_OBS.get(modulo, 'Inbox')}/{q[:10]} {q[11:16].replace(':', 'h')} {slug} {str(nid)[-4:]}.md"
    tg = ", ".join(json.dumps(t, ensure_ascii=False) for t in ("chefe-geral", modulo) + tuple(tags))
    md = f"---\ndata: {q}\nmodulo: {modulo}\nid: {json.dumps(str(nid))}\norigem: {origem}\ntags: [{tg}]\n---\n\n# {titulo}\n\n{corpo}\n"
    return {"id": str(nid), "caminho": caminho, "md": md, "titulo": titulo, "modulo": modulo, "quando": q}


def escrever_nota(n):
    """Grava a nota no cofre. Idempotente por id. Retorna (estado, caminho)."""
    raiz, pasta = cofre()
    if not raiz:
        return "sem_cofre", None
    nid = str(n.get("id") or "")
    if not nid:
        return "erro: sem id", None
    with LOCK:
        indice = ler_json(OBS_INDICE, {})
        if nid in indice:
            return "ja_existe", indice[nid]
        rel = n.get("caminho") or ""
        alvo = _dentro(raiz, pasta, rel)
        if not alvo:
            return "erro: caminho fora da pasta permitida", None
        if os.path.exists(alvo):
            base, ext = os.path.splitext(alvo)
            alvo = f"{base} {nid[-6:]}{ext}"
            rel = os.path.relpath(alvo, raiz)
            if os.path.exists(alvo):
                indice[nid] = rel
                gravar_json(OBS_INDICE, indice)
                return "ja_existe", rel
        os.makedirs(os.path.dirname(alvo), exist_ok=True)
        with open(alvo, "x", encoding="utf-8") as f:
            f.write(n.get("md") or "")
        indice[nid] = os.path.relpath(alvo, raiz)
        gravar_json(OBS_INDICE, indice)
        rel = indice[nid]
        # Diário do Chefe Geral: cria se não existir e acrescenta uma linha com link.
        q = n.get("quando") or agora()
        diario = os.path.join(raiz, pasta, "Diario", q[:10] + ".md")
        os.makedirs(os.path.dirname(diario), exist_ok=True)
        novo = not os.path.exists(diario)
        titulo = re.sub(r"[\[\]|\n]", " ", n.get("titulo") or "nota").strip()[:80]
        with open(diario, "a", encoding="utf-8") as f:
            if novo:
                f.write(f"---\ndata: {q[:10]}\nmodulo: diario\norigem: ponte-mac\ntags: [\"chefe-geral\", \"diario\"]\n---\n\n# Diário {q[:10]}\n\n")
            f.write(f"- {q[11:16]} [[{rel[:-3]}|{titulo}]]\n")
    log(f"obsidian nota criada: {rel}")
    return "criado", rel


def capturar(modulo, titulo, corpo, pid, tags=()):
    """Captura do Telegram: grava já no cofre; sem cofre configurado, vai para a fila (GET /memoria)."""
    n = montar_nota(modulo, titulo, corpo, str(pid), tags=("telegram",) + tuple(tags))
    try:
        estado, _ = escrever_nota(n)
    except Exception as e:
        log(f"obsidian falhou: {e}")
        estado = "erro"
    if estado not in ("criado", "ja_existe"):
        anexar_jsonl(MEMORIA, {**n, "importado": False})


def guardar_seguro(n):
    try:
        estado, _ = escrever_nota(n)
    except Exception as e:
        log(f"obsidian falhou: {e}")
        estado = "erro"
    if estado not in ("criado", "ja_existe"):
        anexar_jsonl(MEMORIA, {**n, "importado": False})


def registrar_pedido_app(payload):
    """Todo pedido que passa pela ponte vira nota em Pedidos (mesmo id que o app usa: não duplica)."""
    try:
        p = (payload or {}).get("pedido") or {}
        pid = str(p.get("id") or "")
        if not pid or pid == "teste":
            return
        anx = (payload or {}).get("anexos") or {}
        if payload.get("tipo") == "reuniao_resumo":
            n = montar_nota("reunioes", anx.get("titulo") or (p.get("texto") or "Reunião")[:60], anx.get("transcricao") or p.get("texto") or "", pid, origem="ponte-mac", tags=("app",))
        else:
            n = montar_nota(p.get("modulo") if p.get("modulo") in PASTAS_OBS else "pedidos", (p.get("texto") or "Pedido")[:60], p.get("texto") or "", pid, origem="ponte-mac", tags=("app",))
        guardar_seguro(n)
        anexar_jsonl(MSGS, {"id": pid, "quando": agora(), "texto": (p.get("texto") or "")[:2000], "tipo": payload.get("tipo") or "pedido", "canal": p.get("canal") or "app"})
    except Exception as e:
        log(f"registrar pedido falhou: {e}")


def registrar_resposta(payload, st, txt):
    """Guarda em Respostas o retorno do webhook (aceite ou erro), para ficar visível no viewer."""
    try:
        pid = str(((payload or {}).get("pedido") or {}).get("id") or "")
        if not pid or pid == "teste":
            return
        corpo = f"Pedido: {pid}\nHTTP: {st}\n\n```\n{(txt or '')[:4000]}\n```\n\nA resposta completa do Chefe Geral fica no chat do Grok Bot. Para guardar aqui, mande /salvar + texto no Telegram."
        guardar_seguro(montar_nota("respostas", f"Retorno {pid}", corpo, "resp-" + pid, tags=("retorno",)))
    except Exception as e:
        log(f"registrar resposta falhou: {e}")


def esvaziar_fila_memoria():
    """Grava no cofre as capturas antigas que ficaram na fila. Retorna quantas foram gravadas."""
    if not cofre()[0]:
        return 0
    with LOCK:
        notas = ler_jsonl(MEMORIA, 100000)
    feitas = 0
    for x in notas:
        if x.get("importado") or x.get("no_cofre"):
            continue
        try:
            estado, _ = escrever_nota(x)
        except Exception as e:
            log(f"obsidian fila falhou: {e}")
            continue
        if estado in ("criado", "ja_existe"):
            x["no_cofre"] = True
            feitas += estado == "criado"
    with LOCK:
        with open(MEMORIA, "w", encoding="utf-8") as f:
            for x in notas:
                f.write(json.dumps(x, ensure_ascii=False) + "\n")
    return feitas


def buscar_cofre(q, maximo=5, excluir_id=None):
    """Busca simples de texto no cofre inteiro, só leitura. Ignora pastas ocultas (.obsidian, .trash)."""
    raiz, pasta = cofre()
    termos = [t for t in re.findall(r"\w+", (q or "").lower(), flags=re.U) if len(t) > 3][:8]
    if not raiz or not termos:
        return []
    achados, lidos = [], 0
    erros = []
    for d, ds, fs in os.walk(raiz, onerror=erros.append):
        ds[:] = [x for x in ds if not x.startswith(".") and not (x == "Diario" and os.path.basename(d) == pasta)]
        for f in fs:
            if not f.endswith(".md"):
                continue
            p = os.path.join(d, f)
            try:
                if os.path.getsize(p) > 2_000_000:
                    continue
                with open(p, encoding="utf-8", errors="replace") as h:
                    txt = h.read()
            except OSError:
                continue
            lidos += 1
            if excluir_id and f'id: "{excluir_id}"' in txt[:600]:
                continue
            txt = re.sub(r"\A---\n.*?\n---\n", "", txt, flags=re.S)
            baixo = txt.lower()
            score = sum(baixo.count(t) for t in termos) + 3 * sum(t in f.lower() for t in termos)
            if not score:
                continue
            achou = sum(1 for t in termos if t in baixo or t in f.lower())
            i = min([baixo.find(t) for t in termos if t in baixo] or [0])
            corpo = re.sub(r"\s+", " ", txt[max(0, i - 120):i + 240]).strip()
            achados.append({"arquivo": os.path.relpath(p, raiz), "score": achou * 100 + score, "trecho": corpo, "fonte": "obsidian"})
            if lidos > 20000:
                break
    STATUS["busca_erro"] = None
    if erros:
        if any(getattr(e, "errno", 0) == 1 for e in erros):
            STATUS["busca_erro"] = "macOS não deixa a ponte ler o cofre. Ajustes do Sistema › Privacidade e Segurança › Privacidade e Segurança › Arquivos e Pastas (ou Acesso Total ao Disco) › Chefe Geral Ponte. Veja o README"
        log(f"busca no cofre: {len(erros)} pasta(s) sem acesso, ex.: {erros[0]}")
    achados.sort(key=lambda x: -x["score"])
    return achados[:maximo]


def completar_contexto(payload):
    """Se o app não mandou obsidian_context, a ponte preenche com a busca no cofre."""
    try:
        if isinstance(payload, dict) and not payload.get("obsidian_context"):
            texto = ((payload.get("pedido") or {}).get("texto") or "")[:500]
            pid = str((payload.get("pedido") or {}).get("id") or "")
            ctx = buscar_cofre(texto, 3, excluir_id=None if not pid else (pid if pid.startswith("tg") else pid))
            if ctx:
                payload["obsidian_context"] = ctx
    except Exception as e:
        log(f"contexto obsidian falhou: {e}")
    return payload


# ---------- Telegram ----------
def tg(metodo, params=None, timeout=60):
    token = ler_segredo(TOKEN)
    if not token:
        raise RuntimeError("sem token")
    dados = urllib.parse.urlencode(params or {}).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/{metodo}", data=dados)
    envio = metodo.startswith("send") or metodo in ("copyMessage", "forwardMessage")
    if envio:
        ENVIO_LOCK.acquire()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            j = json.loads(r.read().decode("utf-8"))
        if not j.get("ok"):
            raise RuntimeError(j.get("description", "erro"))
        res = j["result"]
        if envio and isinstance(res, dict) and res.get("message_id"):
            resp_visto(res["message_id"], meu=True)
        return res
    finally:
        if envio:
            ENVIO_LOCK.release()


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
        urllib.request.urlopen(f"{u.scheme}://{u.netloc}/health", timeout=2).close()
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
    if re.match(r"^/(salvar|nota)\b", texto):
        # Guarda no Obsidian sem mandar ao Chefe Geral (ex.: resposta do chat colada aqui).
        corpo = re.sub(r"^/(salvar|nota)\b\s*", "", texto).strip()
        if not corpo:
            tg_responder("Mande /salvar seguido do texto (por exemplo, a resposta do Chefe Geral copiada do chat).")
            return
        n = montar_nota("respostas", corpo.split("\n")[0][:60], corpo, pid, tags=("telegram", "resposta"))
        try:
            estado, rel = escrever_nota(n)
        except Exception as e:
            estado, rel = f"erro: {e}", None
        if estado not in ("criado", "ja_existe"):
            anexar_jsonl(MEMORIA, {**n, "importado": False})
            tg_responder("Guardei na fila do Mac; vai para o Obsidian quando o cofre estiver configurado.")
        else:
            tg_responder(f"Salvo no Obsidian: {rel}")
        return
    if texto.startswith("/start"):
        tg_responder("Ponte do Chefe Geral ligada. Mande texto ou nota de voz e eu repasso ao Chefe Geral. Use /reuniao na legenda de um áudio ou .txt para pedir o resumo da reunião. Use /salvar + texto para guardar algo no Obsidian (por exemplo, uma resposta do Chefe Geral).")
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
                if m.get("message_id"):
                    resp_visto(m["message_id"])
                try:
                    tratar_mensagem(m)
                except Exception as e:
                    log(f"erro ao tratar mensagem: {e}")
        except Exception as e:
            STATUS["telegram_erro"] = str(e)[:200]
            log(f"telegram poll: {e}")
            time.sleep(10)


# ---------- Respostas do Chefe Geral (box -> Telegram -> Obsidian) ----------
def resp_estado():
    e = ler_json(RESP_ESTADO, {})
    e.setdefault("max", None)
    e.setdefault("sondar", {})
    e.setdefault("meus", [])
    e.setdefault("capturadas", 0)
    return e


def resp_visto(mid, meu=False):
    """Registra um message_id do seu chat. Os números pulados viram candidatos a resposta da box."""
    try:
        mid = int(mid)
        with RESP_LOCK:
            e = resp_estado()
            if meu:
                e["meus"] = (e["meus"] + [mid])[-300:]
                e["sondar"].pop(str(mid), None)
            if e["max"] is None:
                e["max"] = mid
            elif mid > e["max"]:
                for i in range(e["max"] + 1, mid):
                    if len(e["sondar"]) < 300:
                        e["sondar"].setdefault(str(i), 0)
                e["max"] = mid
            gravar_json(RESP_ESTADO, e)
    except Exception as ex:
        log(f"respostas: visto falhou: {ex}")


def tg_bruto(metodo, params, timeout=30):
    """Como tg(), mas devolve (ok, resultado_ou_descricao, erro_da_api). Nunca grava o token."""
    token = ler_segredo(TOKEN)
    if not token:
        return False, "sem token", False
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/{metodo}", data=urllib.parse.urlencode(params).encode())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            j = json.loads(r.read().decode("utf-8"))
        return bool(j.get("ok")), j.get("result") if j.get("ok") else j.get("description", ""), not j.get("ok")
    except urllib.error.HTTPError as ex:
        try:
            d = json.loads(ex.read().decode("utf-8")).get("description", "")
        except Exception:
            d = f"HTTP {ex.code}"
        return False, d, ex.code == 400
    except Exception as ex:
        return False, str(ex)[:200], False


def ler_documento(file_id):
    token = ler_segredo(TOKEN)
    f = tg("getFile", {"file_id": file_id}, timeout=30)
    if int(f.get("file_size") or 0) > 2_000_000:
        raise RuntimeError("documento grande demais")
    with urllib.request.urlopen(f"https://api.telegram.org/file/bot{token}/{f['file_path']}", timeout=60) as r:
        return r.read(2_000_001).decode("utf-8", "replace")


def resp_capturar(chat_id, mid):
    """Sonda um message_id. Devolve 'capturada', 'outra', 'nao_editavel', 'ja_ok' ou 'transitorio'."""
    ok, res, api = tg_bruto("editMessageReplyMarkup", {"chat_id": chat_id, "message_id": mid, "reply_markup": BOTAO_OK})
    if not ok:
        if not api:
            return "transitorio"
        return "ja_ok" if "not modified" in str(res).lower() else "nao_editavel"
    m = res if isinstance(res, dict) else {}
    texto = m.get("text") or m.get("caption") or ""
    if not ((m.get("from") or {}).get("is_bot") and texto.startswith(RESP_PREFIXO)):
        tg_bruto("editMessageReplyMarkup", {"chat_id": chat_id, "message_id": mid})  # desfaz: não era resposta da box
        return "outra"
    try:
        cab, _, resto = texto.partition("\n")
        if m.get("document"):
            conteudo = ler_documento(m["document"]["file_id"])
            if conteudo.startswith(RESP_PREFIXO):
                conteudo = conteudo.partition("\n")[2]
            resto = conteudo
        mm = re.match(r"^Chefe Geral, resposta ao pedido (\S+?):?(?: (.*))?$", cab.strip())
        pid = (mm.group(1) if mm else "sem-id").strip()
        titulo = ((mm.group(2) if mm else "") or "").strip()
        quando = datetime.fromtimestamp(int(m.get("date") or time.time()), BRT).isoformat(timespec="seconds")
        corpo = f"Pedido: {pid}\nEntregue no Telegram: {quando} (message_id {mid})\n\n{resto.strip()}"
        n = montar_nota("respostas", f"Resposta {pid} {titulo}".strip(), corpo, f"tgresp-{mid}", origem="telegram-bot", tags=("resposta", "telegram"))
        guardar_seguro(n)
        with RESP_LOCK:
            e = resp_estado()
            e["capturadas"] += 1
            e["ultima"] = {"message_id": mid, "pedido": pid, "quando": agora()}
            gravar_json(RESP_ESTADO, e)
        log(f"respostas: pedido {pid} (message_id {mid}) gravado no Obsidian")
        return "capturada"
    except Exception as ex:
        log(f"respostas: falha ao gravar message_id {mid}: {ex}")
        tg_bruto("editMessageReplyMarkup", {"chat_id": chat_id, "message_id": mid, "reply_markup": BOTAO_PENDENTE})
        return "transitorio"


def loop_respostas():
    time.sleep(15)
    while True:
        try:
            c = cfg()
            if ler_segredo(TOKEN) and c["chat_id"]:
                with ENVIO_LOCK:
                    with RESP_LOCK:
                        e = resp_estado()
                    if e["max"] is not None:
                        meus = set(e["meus"])
                        alvos = sorted(int(i) for i in e["sondar"]) + list(range(e["max"] + 1, e["max"] + 6))
                        for mid in alvos:
                            if mid in meus:
                                continue
                            r = resp_capturar(c["chat_id"], mid)
                            with RESP_LOCK:
                                e2 = resp_estado()
                                k = str(mid)
                                if r in ("capturada", "outra", "ja_ok"):
                                    e2["sondar"].pop(k, None)
                                elif r == "nao_editavel" and k in e2["sondar"]:
                                    e2["sondar"][k] += 1
                                    if e2["sondar"][k] >= 3:
                                        e2["sondar"].pop(k, None)
                                gravar_json(RESP_ESTADO, e2)
                            if r in ("capturada", "outra"):
                                resp_visto(mid)
                            if r == "transitorio":
                                break
                            time.sleep(0.3)
            STATUS["respostas_erro"] = None
        except Exception as ex:
            STATUS["respostas_erro"] = str(ex)[:200]
            log(f"respostas: {ex}")
        time.sleep(30)


# ---------- Arquivo (viewer, SOMENTE LEITURA) ----------
# Lista branca de raízes em relay.json ("arquivos_raizes": [{"id","nome","caminho","ligada"}]). Sem config, usa o padrão.
# Nunca serve segredos: a pasta de suporte da ponte, *.key, *token*, .env, chaves privadas, nem ~/Documents/nrf9151-ntn.
MIMES = {".md": "text/markdown", ".txt": "text/plain", ".json": "application/json", ".csv": "text/csv", ".log": "text/plain",
         ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
         ".webp": "image/webp", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".webm": "audio/webm",
         ".ogg": "audio/ogg", ".oga": "audio/ogg", ".wav": "audio/wav", ".mp4": "video/mp4", ".mov": "video/quicktime",
         ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
         ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
         ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".html": "text/plain"}
TEXTO_EXT = (".md", ".txt")
PROIBIDO_NOME = re.compile(r"(\.key$|token|^\.env|\.env$|\.pem$|\.p12$|\.pfx$|^id_(rsa|ed25519|ecdsa)|secret|senha|password|credential|\.keychain)", re.I)


def raizes():
    c = cfg()
    lst = c.get("arquivos_raizes")
    if not isinstance(lst, list) or not lst:
        cof = cofre()[0] or os.path.expanduser(c.get("obsidian_cofre") or os.path.join(HOME, "Documents", "Obsidian"))
        lst = [{"id": "obsidian", "nome": "Obsidian", "caminho": cof, "ligada": True},
               {"id": "cv", "nome": "CV", "caminho": "~/Documents/CV", "ligada": True},
               {"id": "chefegeral", "nome": "ChefeGeral", "caminho": "~/Documents/ChefeGeral", "ligada": True},
               {"id": "mariaalice", "nome": "Maria Alice", "caminho": "~/Documents/Maria Alice", "ligada": True},
               {"id": "downloads", "nome": "Downloads", "caminho": "~/Downloads", "ligada": False}]
    out = []
    for r in lst:
        p = os.path.realpath(os.path.expanduser(str(r.get("caminho") or "")))
        if r.get("ligada", True) and r.get("id") and os.path.isdir(p) and not proibido(p):
            out.append({"id": str(r["id"]), "nome": r.get("nome") or r["id"], "caminho": p})
    return out


def proibido(p):
    p = os.path.realpath(p)
    bloq = [os.path.realpath(DIR), os.path.realpath(os.path.join(HOME, "Documents", "nrf9151-ntn")),
            os.path.realpath(os.path.join(HOME, "Library")), os.path.realpath(os.path.join(HOME, ".ssh"))]
    if any(p == b or p.startswith(b + os.sep) for b in bloq):
        return True
    return any(PROIBIDO_NOME.search(x) for x in p.split(os.sep) if x)


def resolver(rid, rel):
    """(raiz, caminho_absoluto) dentro da raiz, ou levanta PermissionError/FileNotFoundError."""
    r = next((x for x in raizes() if x["id"] == rid), None)
    if not r:
        raise FileNotFoundError("raiz desconhecida")
    rel = (rel or "").replace("\\", "/").strip("/")
    if any(x in (".", "..") for x in rel.split("/")) or "\x00" in rel or len(rel) > 1000:
        raise PermissionError("caminho inválido")
    alvo = os.path.realpath(os.path.join(r["caminho"], rel))  # resolve symlinks
    if alvo != r["caminho"] and not alvo.startswith(r["caminho"] + os.sep):
        raise PermissionError("fora da raiz")
    if proibido(alvo) or any(x.startswith(".") for x in os.path.relpath(alvo, r["caminho"]).split(os.sep) if x != "."):
        raise PermissionError("bloqueado")
    if not os.path.exists(alvo):
        raise FileNotFoundError("não existe")
    return r, alvo


def info(r, p):
    st = os.stat(p)
    rel = os.path.relpath(p, r["caminho"])
    return {"nome": os.path.basename(p), "tipo": "pasta" if os.path.isdir(p) else "arquivo", "tamanho": st.st_size,
            "mtime": datetime.fromtimestamp(st.st_mtime, BRT).isoformat(timespec="seconds"), "raiz": r["id"],
            "caminho": "" if rel == "." else rel, "absoluto": p, "mime": MIMES.get(os.path.splitext(p)[1].lower())}


def andar(r, maximo=50000):
    """Gera (dir, arquivo) seguros da raiz, sem ocultos, sem symlinks para fora, sem proibidos."""
    n = 0
    for d, ds, fs in os.walk(r["caminho"], onerror=lambda e: None):
        ds[:] = [x for x in ds if not x.startswith(".") and not proibido(os.path.join(d, x))
                 and os.path.realpath(os.path.join(d, x)).startswith(r["caminho"] + os.sep)]
        for f in fs:
            p = os.path.join(d, f)
            if f.startswith(".") or proibido(p) or not os.path.realpath(p).startswith(r["caminho"] + os.sep):
                continue
            n += 1
            if n > maximo:
                return
            yield p


def arq_lista(rid, rel):
    r, p = resolver(rid, rel)
    if not os.path.isdir(p):
        raise NotADirectoryError("não é pasta")
    itens = []
    for f in sorted(os.listdir(p)):
        q = os.path.join(p, f)
        if f.startswith(".") or proibido(q):
            continue
        rq = os.path.realpath(q)
        if not rq.startswith(r["caminho"] + os.sep):
            continue
        try:
            itens.append(info(r, rq if rq == q else q))
        except OSError:
            pass
    itens.sort(key=lambda x: (x["tipo"] != "pasta", x["nome"].lower()))
    return {"raiz": r, "caminho": "" if p == r["caminho"] else os.path.relpath(p, r["caminho"]), "absoluto": p, "itens": itens}


def arq_busca(q, maximo=40):
    termos = [t for t in re.findall(r"\w+", (q or "").lower(), flags=re.U) if len(t) > 1][:8]
    if not termos:
        return []
    out = []
    for r in raizes():
        for p in andar(r):
            nome = os.path.basename(p).lower()
            sn = sum(t in nome for t in termos)
            sc, trecho = 0, ""
            if p.lower().endswith(TEXTO_EXT):
                try:
                    if os.path.getsize(p) <= 2_000_000:
                        with open(p, encoding="utf-8", errors="replace") as h:
                            txt = h.read()
                        b = txt.lower()
                        sc = sum(b.count(t) for t in termos)
                        if sc:
                            i = min(b.find(t) for t in termos if t in b)
                            trecho = re.sub(r"\s+", " ", txt[max(0, i - 100):i + 200]).strip()
                except OSError:
                    pass
            if sn or sc:
                try:
                    out.append({**info(r, p), "score": sn * 50 + sc, "trecho": trecho})
                except OSError:
                    pass
    out.sort(key=lambda x: -x["score"])
    return out[:maximo]


def arq_recentes(n=50, rid=None, prefixo=""):
    out = []
    for r in raizes():
        if rid and r["id"] != rid:
            continue
        base = r["caminho"]
        if prefixo:
            try:
                _, base = resolver(r["id"], prefixo)
            except (PermissionError, FileNotFoundError):
                continue
        for p in andar(r):
            if base != r["caminho"] and not p.startswith(base + os.sep):
                continue
            try:
                out.append((os.path.getmtime(p), r, p))
            except OSError:
                pass
    out.sort(key=lambda x: -x[0])
    return [info(r, p) for _, r, p in out[:n]]


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
            if texto:
                tid = self.headers.get("X-Chefe-Id") or ("st" + uuid.uuid4().hex[:10])
                tid = re.sub(r"[^\w-]", "", tid)[:40] or "st" + uuid.uuid4().hex[:10]
                guardar_seguro(montar_nota("transcricoes", texto[:60], texto, "transc-" + tid, origem="ponte-mac", tags=("transcricao",)))
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

    def get_arquivos(self, u):
        if not self.headers.get("Origin"):
            return self.responder(403, {"erro": "o viewer exige o cabeçalho Origin do app"})
        qs = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        try:
            if u.path == "/arquivos/raizes":
                return self.responder(200, {"raizes": raizes(), "obsidian": {"cofre": cofre()[0], "pasta": cofre()[1], "nome": os.path.basename(cofre()[0] or "")}})
            if u.path == "/arquivos/lista":
                return self.responder(200, arq_lista(qs.get("raiz", ""), qs.get("caminho", "")))
            if u.path == "/arquivos/busca":
                return self.responder(200, {"resultados": arq_busca(qs.get("q", ""), min(int(qs.get("max", "40")), 100))})
            if u.path == "/arquivos/recentes":
                return self.responder(200, {"itens": arq_recentes(min(int(qs.get("n", "50")), 300), qs.get("raiz"), qs.get("prefixo", ""))})
            if u.path == "/arquivos/abrir":
                r, p = resolver(qs.get("raiz", ""), qs.get("caminho", ""))
                if os.path.isdir(p):
                    return self.responder(400, {"erro": "é uma pasta"})
                ext = os.path.splitext(p)[1].lower()
                mime = MIMES.get(ext, "application/octet-stream")
                if mime.startswith("text/") or mime == "application/json":
                    mime += "; charset=utf-8"
                tam = os.path.getsize(p)
                if tam > 300_000_000:
                    return self.responder(413, {"erro": "arquivo grande demais para o viewer", "absoluto": p})
                self.send_response(200)
                self.cors()
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(tam))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Content-Disposition", "inline; filename*=UTF-8''" + urllib.parse.quote(os.path.basename(p)))
                self.send_header("Access-Control-Expose-Headers", "Content-Disposition")
                self.end_headers()
                with open(p, "rb") as f:
                    shutil.copyfileobj(f, self.wfile, 1 << 20)
                return
        except PermissionError as e:
            return self.responder(403, {"erro": "bloqueado: " + str(e)})
        except (FileNotFoundError, NotADirectoryError) as e:
            return self.responder(404, {"erro": str(e)})
        except ValueError:
            return self.responder(400, {"erro": "parâmetro inválido"})
        return self.responder(404, {"erro": "rota desconhecida"})

    def do_GET(self):
        if not self.origem_ok():
            return self.responder(403, {"erro": "origem não permitida"})
        u = urllib.parse.urlparse(self.path)
        if u.path == "/health":
            c = cfg()
            return self.responder(200, {"ok": True, "ponte": "ligada", "versao": VERSAO, "hora": agora(),
                                        "webhook_configurado": bool(c["webhook_url"]), "chave_presente": bool(ler_segredo(KEY)),
                                        "telegram": {"token_presente": bool(ler_segredo(TOKEN)), "chat_id_definido": bool(c["chat_id"]),
                                                     "ultimo_poll": STATUS["telegram_ultimo_poll"], "erro": STATUS["telegram_erro"],
                                                     "respostas": {k: v for k, v in resp_estado().items() if k in ("max", "capturadas", "ultima")} | {"pendentes": len(resp_estado()["sondar"]), "erro": STATUS.get("respostas_erro")}},
                                        "obsidian": {"cofre_configurado": bool(cofre()[0]), "pasta": cofre()[1], "cofre_nome": os.path.basename(cofre()[0] or ""),
                                                     "notas_criadas": len(ler_json(OBS_INDICE, {})), "busca_erro": STATUS.get("busca_erro")},
                                        "transcricao_local": {"motor": "VoiceStudio (faster-whisper large-v3)", "ligado": vs_ligado(),
                                                              "pendentes": len(pendentes())}})
        if u.path == "/mensagens":
            lim = int((urllib.parse.parse_qs(u.query).get("limite") or ["30"])[0])
            return self.responder(200, {"mensagens": list(reversed(ler_jsonl(MSGS, min(lim, 200))))})
        if u.path == "/obsidian/busca":
            qs = urllib.parse.parse_qs(u.query)
            return self.responder(200, {"resultados": buscar_cofre((qs.get("q") or [""])[0], min(int((qs.get("max") or ["5"])[0]), 10))})
        if u.path.startswith("/arquivos/"):
            return self.get_arquivos(u)
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
            registrar_pedido_app(corpo)
            st, txt = repassar(corpo)
            registrar_resposta(corpo, st, txt)
            try:
                resp = json.loads(txt)
            except Exception:
                resp = None
            return self.responder(st if st >= 200 else 502, {"ok": 200 <= st < 300, "webhook_status": st,
                                                            "resposta": resp, "detalhe": None if resp is not None else txt[:300]})
        if path == "/obsidian/nota":
            if not cofre()[0]:
                return self.responder(503, {"ok": False, "erro": "Cofre do Obsidian não configurado na ponte (scripts/set-obsidian.sh)"})
            res = []
            for nota in (corpo.get("notas") if isinstance(corpo.get("notas"), list) else [corpo])[:500]:
                try:
                    estado, rel = escrever_nota(nota)
                except Exception as e:
                    estado, rel = f"erro: {e}", None
                res.append({"id": nota.get("id"), "estado": estado, "caminho": rel})
            return self.responder(200, {"ok": all(r["estado"] in ("criado", "ja_existe") for r in res), "resultados": res})
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
    threading.Thread(target=loop_respostas, daemon=True).start()
    try:
        n = esvaziar_fila_memoria()
        if n:
            log(f"obsidian: {n} captura(s) antigas gravadas no cofre")
    except Exception as e:
        log(f"obsidian fila inicial falhou: {e}")
    log(f"ponte ligada em 127.0.0.1:{porta}")
    print(f"Ponte do Chefe Geral em http://127.0.0.1:{porta}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
