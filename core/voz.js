// Gravação (MediaRecorder) + transcrição ao vivo (Web Speech API, pt-BR) quando o navegador suporta.
export const temTranscricao = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
export const temGravacao = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
export function criarGravador({aoTexto, aoParcial, aoErro, gravarAudio = true}) {
  let rec, sr, stream, partes = [], ativo = false, final = "", srFim = null, ctx, medidor, pico = 0;
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
    sr.onend = () => { if (ativo) { try { sr.start(); } catch {} } else srFim?.(); };  // reinicia em pausas longas
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
        // Mede o volume para saber se o microfone captou som (macOS sem permissão grava silêncio).
        try {
          ctx = new (window.AudioContext || window.webkitAudioContext)();
          const an = ctx.createAnalyser(); an.fftSize = 1024; ctx.createMediaStreamSource(stream).connect(an);
          const buf = new Uint8Array(an.fftSize);
          medidor = setInterval(() => { an.getByteTimeDomainData(buf); for (const v of buf) { const d = Math.abs(v - 128); if (d > pico) pico = d; } }, 100);
        } catch { pico = -1; }
      }
      iniciarSR();
    },
    async parar() {
      ativo = false;
      // Espera o último trecho da transcrição ao vivo (o navegador entrega o final depois do stop).
      const esperaSR = sr ? new Promise(ok => { srFim = ok; setTimeout(ok, 2500); }) : null;
      try { sr?.stop(); } catch {}
      clearInterval(medidor); try { ctx?.close(); } catch {}
      if (!rec) { await esperaSR; return {texto: final.trim(), audio: null, silencio: false}; }
      await Promise.all([new Promise(ok => { rec.onstop = ok; rec.stop(); }), esperaSR]);
      stream.getTracks().forEach(t => t.stop());
      return {texto: final.trim(), audio: new Blob(partes, {type: rec.mimeType || "audio/webm"}), silencio: pico >= 0 && pico < 3};
    },
    get texto() { return final; },
    set texto(v) { final = v; }
  };
}
