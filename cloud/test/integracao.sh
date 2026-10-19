#!/bin/bash
# Integração contra `wrangler dev --local` (porta 8799) + test/mock.mjs (porta 9911). Sem rede externa.
B=${B:-http://localhost:8799}; F=0
ok(){ if eval "$2"; then echo "ok   $1"; else echo "FALHA $1"; F=1; fi; }
tgp(){ curl -s -o /dev/null -w '%{http_code}' -X POST $B/telegram -H "X-Telegram-Bot-Api-Secret-Token: ${2:-sec}" -H 'Content-Type: application/json' -d "$1"; }
ok "telegram sem segredo 401" '[ "$(tgp "{}" errado)" = 401 ]'
ok "texto do Guilherme" '[ "$(tgp "{\"update_id\":1,\"message\":{\"message_id\":10,\"chat\":{\"id\":42},\"from\":{\"id\":42},\"text\":\"prepara pauta Skylo\"}}")" = 200 ]'
ok "update repetido não duplica" '[ "$(tgp "{\"update_id\":1,\"message\":{\"message_id\":10,\"chat\":{\"id\":42},\"from\":{\"id\":42},\"text\":\"prepara pauta Skylo\"}}")" = 200 ]'
ok "estranho ignorado" '[ "$(tgp "{\"update_id\":2,\"message\":{\"message_id\":11,\"chat\":{\"id\":7},\"from\":{\"id\":7},\"text\":\"oi\"}}")" = 200 ]'
tgp '{"update_id":3,"message":{"message_id":12,"chat":{"id":42},"from":{"id":42},"caption":"/reuniao Sensify","document":{"file_id":"T1","file_name":"ata.txt","mime_type":"text/plain"}}}' >/dev/null
tgp '{"update_id":4,"message":{"message_id":13,"chat":{"id":42},"from":{"id":42},"voice":{"file_id":"V1","duration":4,"mime_type":"audio/ogg"}}}' >/dev/null
tgp '{"update_id":5,"message":{"message_id":14,"chat":{"id":42},"from":{"id":42},"text":"/salvar resposta colada"}}' >/dev/null
A='-H Authorization:Bearer\ app'
ok "lista sem token 401" '[ "$(curl -s -o /dev/null -w %{http_code} $B/pedidos)" = 401 ]'
ok "origem estranha 403" '[ "$(curl -s -o /dev/null -w %{http_code} -H "Origin: https://evil.com" -H "Authorization: Bearer app" $B/pedidos)" = 403 ]'
ok "preflight do app" 'curl -s -i -X OPTIONS -H "Origin: https://guilh-abc.github.io" $B/pedido | grep -qi "access-control-allow-origin: https://guilh-abc.github.io"'
P=$(curl -s -H "Authorization: Bearer app" $B/pedidos)
ok "1 pedido do telegram (sem duplicar, sem estranho)" '[ "$(echo "$P" | grep -o "\"id\":\"tg1[01]\"" | wc -l)" = 1 ]'
ok "reunião .txt" 'curl -s -H "Authorization: Bearer app" $B/reunioes | grep -q "decidimos fechar a Sensify"'
ok "voz sem IA vira pendente" 'curl -s -H "Authorization: Bearer app" "$B/sync?depois=0" | grep -q "pend-tg13"'
ok "salvar vira resposta" 'curl -s -H "Authorization: Bearer app" $B/respostas | grep -q "resposta colada"'
ok "pedido do app" 'curl -s -X POST -H "Authorization: Bearer app" -H "Origin: https://guilh-abc.github.io" -d "{\"tipo\":\"pedido\",\"origem\":\"chefe-geral-hub\",\"pedido\":{\"id\":\"app1\",\"texto\":\"resume Electrolux\",\"modulo\":\"pedidos\"}}" $B/pedido | grep -q "\"ok\":true"'
ok "resposta com token da box" 'curl -s -X POST -H "Authorization: Bearer resp" -d "{\"pedido_id\":\"app1\",\"titulo\":\"Electrolux\",\"texto\":\"Resumo...\",\"message_id\":99}" $B/resposta | grep -q "\"novo\":true"'
ok "token da box não lê listas" '[ "$(curl -s -o /dev/null -w %{http_code} -H "Authorization: Bearer resp" $B/pedidos)" = 401 ]'
ok "indice + contexto" 'curl -s -X POST -H "Authorization: Bearer app" -d "{\"notas\":[{\"arquivo\":\"Chefe Geral/Projetos/Electrolux.md\",\"titulo\":\"Electrolux\"}]}" $B/indice | grep -q "\"notas\":1"'
curl -s -X POST -H "Authorization: Bearer app" -d '{"tipo":"pedido","pedido":{"id":"app2","texto":"status Electrolux"}}' $B/pedido >/dev/null
L=$(curl -s localhost:9911/log)
ok "webhook recebeu Authorization" 'echo "$L" | grep -q "\"auth\":\"Bearer teste\""'
ok "origem nuvem-telegram e nuvem-app" 'echo "$L" | grep -q chefe-geral-nuvem-telegram && echo "$L" | grep -q chefe-geral-nuvem-app'
ok "contexto do índice no payload" 'echo "$L" | grep -q "indice-nuvem"'
ok "ack no Telegram" 'echo "$L" | grep -q "Recebido. A resposta"'
ok "pendente/ok" 'curl -s -X POST -H "Authorization: Bearer app" -d "{\"id\":\"pend-tg13\",\"texto\":\"oi\"}" $B/pendente/ok | grep -q "\"ok\":true"'
exit $F
