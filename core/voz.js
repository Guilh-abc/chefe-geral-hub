// Gravação (MediaRecorder) + transcrição ao vivo (Web Speech API, pt-BR) quando o navegador suporta.
export const temTranscricao = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
export const temGravacao = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
export function criarGravador({aoTexto, aoParcial, aoErro, gravarAudio = true}) {
  let rec, sr, stream, partes = [], ativo = false, final = "";
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function iniciarSR() {
    if (!SR) return;
    sr = new SR(); sr.lang = "pt-BR"; sr.continuous = true; sr.interimResults = true;
    sr.onresult = e => {
      let parcial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) { final += (final ? " " : "") + t.trim(); aoTexto?.(final); } else parcial += t;
      }
      aoParcial?.(parcial);
    };
    sr.onerror = e => { if (e.error !== "no-speech" && e.error !== "aborted") aoErro?.("Transcrição: " + e.error); };
    sr.onend = () => { if (ativo) try { sr.start(); } catch {} };  // reinicia em pausas longas
    try { sr.start(); } catch {}
  }
  return {
    async iniciar() {
      ativo = true; partes = []; final = "";
      if (gravarAudio && temGravacao()) {
        stream = await navigator.mediaDevices.getUserMedia({audio: true});
        const tipo = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(t => MediaRecorder.isTypeSupported?.(t)) || "";
        rec = new MediaRecorder(stream, tipo ? {mimeType: tipo} : {});
        rec.ondataavailable = e => e.data.size && partes.push(e.data);
        rec.start(1000);
      }
      iniciarSR();
    },
    async parar() {
      ativo = false;
      try { sr?.stop(); } catch {}
      if (!rec) return {texto: final, audio: null};
      await new Promise(ok => { rec.onstop = ok; rec.stop(); });
      stream.getTracks().forEach(t => t.stop());
      return {texto: final, audio: new Blob(partes, {type: rec.mimeType || "audio/webm"})};
    },
    get texto() { return final; },
    set texto(v) { final = v; }
  };
}
