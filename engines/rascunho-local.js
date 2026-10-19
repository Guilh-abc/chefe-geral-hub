// Rascunho estruturado feito no navegador (sem IA): separa frases por padrões simples. Serve para funcionar já.
const PAD = {
  decisoes: /\b(decid|ficou (definido|combinado|acertado)|fechamos|aprovad|vamos (seguir|com))/i,
  acoes: /\b(vou|vai|vamos|precisa|tem que|fica(r)? com|respons[aá]vel|at[eé] (amanh[aã]|segunda|ter[cç]a|quarta|quinta|sexta|o dia|dia)|prazo|enviar|mandar|marcar|preparar)\b/i,
  bem: /\b(gostei|bom|boa|excelente|funcionou|[oó]timo|parab[eé]ns|deu certo)\b/i,
  melhorar: /\b(problema|atras|faltou|dif[ií]cil|melhorar|risco|preocup|n[aã]o deu|demor)\w*/i,
};
export function rascunho(transcricao, regras) {
  const frases = transcricao.replace(/\s+/g, " ").split(/(?<=[.!?])\s+|\s+(?=e ent[aã]o|ent[aã]o|beleza|certo)\s*/i).map(s => s.trim()).filter(s => s.length > 12);
  const pega = re => frases.filter(f => re.test(f)).slice(0, 6);
  const longas = [...frases].sort((a, b) => b.length - a.length).slice(0, 5);
  const lista = (a, vazio) => a.length ? a.map(x => "- " + x).join("\n") : "- " + vazio;
  const min = Math.max(1, Math.round(transcricao.split(/\s+/).length / 140));
  return [
    `E aí, Guilherme! Rascunho automático da reunião (uns ${min} min de fala). Revise antes de mandar.`,
    "", "Pontos principais", lista(longas, "não identifiquei"),
    "", "Decisões", lista(pega(PAD.decisoes), "nenhuma decisão explícita na transcrição"),
    "", "Ações (quem, o quê, até quando)", lista(pega(PAD.acoes), "nenhuma ação explícita; defina responsáveis e prazos"),
    "", "O que foi bem", lista(pega(PAD.bem), "complete aqui"),
    "", "O que melhorar", lista(pega(PAD.melhorar), "complete aqui"),
    "", "Regras usadas: " + regras.length + " (o rascunho do navegador segue a estrutura, mas não entende o conteúdo como uma IA)."
  ].join("\n");
}
