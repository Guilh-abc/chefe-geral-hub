# Payload que o app envia ao webhook do Chefe Geral

`POST <URL do webhook>`
Cabeçalhos: `Content-Type: application/json` e `<cabeçalho>: <valor>` (padrão `Authorization: <valor exatamente como no painel da rotina>`).

```json
{
  "versao": 1,
  "origem": "chefe-geral-hub",
  "tipo": "pedido | reuniao_resumo | teste",
  "enviado_em": "2026-10-19T07:43:10-03:00",
  "pedido": {
    "id": "mgx1k2ab3c",
    "texto": "Marca 30 min com o Arthur amanhã sobre a Lightera",
    "modulo": "pedidos | reunioes",
    "vertente": null,
    "opcao": null,
    "canal": "app | reunioes",
    "criado_em": "2026-10-19T07:43:09-03:00",
    "camada": 4
  },
  "anexos": null,
  "obsidian_context": [
    {"arquivo": "Chefe Geral/Pedidos/....md", "score": 2, "trecho": "...", "fonte": "obsidian | fila-do-app"}
  ],
  "instrucoes": {
    "responder_por": "telegram",
    "confirmacao": "Antes de enviar algo a outra pessoa, publicar ou gravar na agenda, peça o OK do Guilherme.",
    "memoria": "Use obsidian_context como contexto. Notas novas vão para a pasta Chefe Geral do cofre."
  }
}
```

Para `tipo: "reuniao_resumo"`, `anexos` traz:
```json
{"reuniao_id": "r...", "titulo": "...", "regras": ["..."], "transcricao": "texto completo", "duracao_s": 1830}
```

Para `tipo: "agenda_evento"` (só sai depois do seu toque), `confirmado_pelo_usuario: true` e `anexos.evento`:
```json
{"titulo": "...", "inicio": "2026-10-20T10:00:00-03:00", "fim": "...", "local": "...", "convidados": ["a@b.com"], "agenda": "google|m365", "detalhes": "..."}
```
Para `tipo: "teste"`: só confirmar o recebimento. Pedidos vindos do Telegram têm `origem: "chefe-geral-ponte-telegram"`, `pedido.canal: "telegram"` e, para voz, a transcrição do VoiceStudio em `pedido.texto` e `anexos.transcricao` (o áudio não vai). Áudio com `/reuniao` na legenda vira `reuniao_resumo` com `anexos.titulo`, `anexos.regras` e `anexos.transcricao`.

Resposta esperada: qualquer HTTP 2xx. Opcionalmente JSON `{"camada": 5, "status": "andamento", "resposta": "texto"}`; se vier `resposta`, o app mostra e marca o pedido como concluído.

## CORS
O app usa a **Ponte do Mac** (`http://127.0.0.1:8788/pedido`), que repassa com o cabeçalho `Authorization` lido de `~/Library/Application Support/ChefeGeral/webhook.key`. A ponte devolve `{ok, webhook_status, resposta}`. O texto abaixo vale só para o modo direto.

O app roda no navegador (GitHub Pages). O webhook precisa responder ao preflight `OPTIONS` com
`Access-Control-Allow-Origin: https://guilh-abc.github.io` (ou `*`), `Access-Control-Allow-Headers: Authorization, Content-Type` e `Access-Control-Allow-Methods: POST`.
Se não responder, o teste mostra "rede ou CORS bloqueado". Nesse caso o pedido fica salvo no app com erro e pode ser reenviado depois.
