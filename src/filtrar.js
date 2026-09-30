// Normaliza as vagas da API pública da Gupy e aplica os filtros da configuração.
// Roda dentro de um nó Code do n8n (o build injeta este arquivo) e nos testes com node --test.

const MODELOS = { remote: "remoto", hybrid: "hibrido", "on-site": "presencial" };

function semAcento(texto) {
  return (texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function normalizarVaga(bruta) {
  return {
    id: bruta.id,
    titulo: (bruta.name || "").trim(),
    empresa: (bruta.careerPageName || "").trim(),
    modelo: MODELOS[bruta.workplaceType] || bruta.workplaceType || "",
    cidade: bruta.city || "",
    estado: bruta.state || "",
    publicada: bruta.publishedDate,
    prazo: bruta.applicationDeadline || null,
    link: bruta.jobUrl,
    descricao: bruta.description || "",
  };
}

// Um termo casa como palavra inteira ("sr" não pode barrar "srta" nem "sre").
function contemTermo(texto, termo) {
  const t = semAcento(termo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`).test(semAcento(texto));
}

// Retorna as vagas aprovadas e a contagem de descartes por motivo, para o resumo ser auditável.
function filtrarVagas(respostas, cfg, agora = new Date()) {
  const limite = agora.getTime() - cfg.horas * 3600 * 1000;
  const cidades = (cfg.cidades || []).map(semAcento);
  const estat = { recebidas: 0, duplicadas: 0, antigas: 0, fora_do_modelo: 0, excluidas: 0, aprovadas: 0 };
  const vistas = new Set();
  const aprovadas = [];
  for (const resposta of respostas) {
    for (const bruta of resposta.data || []) {
      estat.recebidas += 1;
      const vaga = normalizarVaga(bruta);
      if (vistas.has(vaga.id)) { estat.duplicadas += 1; continue; }  // a mesma vaga aparece em vários termos
      vistas.add(vaga.id);
      if (!vaga.publicada || new Date(vaga.publicada).getTime() < limite) { estat.antigas += 1; continue; }
      // Remoto vale de qualquer lugar; híbrido e presencial só nas cidades escolhidas.
      const naCidade = cidades.includes(semAcento(vaga.cidade));
      const aceita = cfg.modelos.includes(vaga.modelo) && (vaga.modelo === "remoto" || naCidade);
      if (!aceita) { estat.fora_do_modelo += 1; continue; }
      if ((cfg.excluir || []).some((termo) => contemTermo(vaga.titulo, termo))) { estat.excluidas += 1; continue; }
      aprovadas.push(vaga);
    }
  }
  estat.aprovadas = aprovadas.length;
  return { vagas: aprovadas, estatisticas: estat };
}

if (typeof module !== "undefined") module.exports = { normalizarVaga, filtrarVagas, contemTermo, semAcento };
