// Junta as vagas filtradas com a nota do ats-match, ranqueia e monta o resumo do dia.
// Roda dentro de um nó Code do n8n (o build injeta este arquivo) e nos testes com node --test.

const LIMITE_TELEGRAM = 4000; // a API do Telegram aceita até 4096 caracteres por mensagem

function escaparMarkdown(texto) {
  return String(texto).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1"); // MarkdownV2
}

function ranquear(vagas, notas, cfg) {
  const juntas = vagas.map((vaga, i) => {
    const nota = notas[i] || {};
    return {
      ...vaga,
      descricao: undefined,
      nota: typeof nota.score === "number" ? nota.score : null,
      faltando: nota.missing_required || [],
      atendidas: nota.matched_required || [],
    };
  });
  const comNota = juntas.filter((v) => v.nota !== null && v.nota >= cfg.nota_minima);
  const semNota = juntas.filter((v) => v.nota === null).length; // ats-match fora do ar ou vaga sem descrição
  comNota.sort((a, b) => b.nota - a.nota || String(b.publicada).localeCompare(String(a.publicada)));
  return { vagas: comNota.slice(0, cfg.maximo), abaixo_da_nota: juntas.length - comNota.length - semNota, sem_nota: semNota };
}

function mensagemTelegram(ranking, data) {
  const linhas = [`*Radar de vagas · ${escaparMarkdown(data)}*`, ""];
  if (!ranking.vagas.length) linhas.push(escaparMarkdown("Nenhuma vaga nova acima da nota mínima hoje."));
  for (const v of ranking.vagas) {
    const falta = v.faltando.length ? `\n   falta: ${escaparMarkdown(v.faltando.slice(0, 3).join(", "))}` : "";
    const linha = `*${v.nota}* · [${escaparMarkdown(v.titulo)}](${v.link})\n   ${escaparMarkdown(v.empresa)} · ${escaparMarkdown(v.modelo)}${falta}`;
    if (linhas.join("\n").length + linha.length > LIMITE_TELEGRAM) break;
    linhas.push(linha);
  }
  return linhas.join("\n");
}

// Mensagem iniciada pela empresa (fora da janela de 24 h) só sai com modelo aprovado pela Meta.
// Parâmetros de modelo não podem ter quebra de linha, tabulação nem mais de 4 espaços seguidos.
function parametroModelo(texto, limite = 120) {
  const limpo = String(texto).replace(/\s+/g, " ").trim();
  return limpo.length > limite ? limpo.slice(0, limite - 1) + "…" : limpo;
}

function modeloWhatsApp(ranking, data, cfg) {
  const melhor = ranking.vagas[0];
  const valores = [data, String(ranking.vagas.length),
    melhor ? melhor.titulo : "nenhuma hoje", melhor ? melhor.empresa : "-", melhor ? String(melhor.nota) : "-",
    cfg.whatsapp.link_pagina];
  return {
    messaging_product: "whatsapp",
    to: cfg.whatsapp.para,
    type: "template",
    template: {
      name: cfg.whatsapp.modelo,
      language: { code: "pt_BR" },
      components: [{ type: "body", parameters: valores.map((v) => ({ type: "text", text: parametroModelo(v) })) }],
    },
  };
}

function montarResumo(vagas, notas, estatisticas, cfg, agora = new Date()) {
  const ranking = ranquear(vagas, notas, cfg);
  const data = agora.toISOString().slice(0, 10);
  return {
    data,
    gerado_em: agora.toISOString(),
    termos: cfg.termos,
    estatisticas: { ...estatisticas, abaixo_da_nota: ranking.abaixo_da_nota, sem_nota: ranking.sem_nota },
    vagas: ranking.vagas,
    telegram: mensagemTelegram(ranking, data),
    whatsapp: cfg.whatsapp ? modeloWhatsApp(ranking, data, cfg) : null,
  };
}

if (typeof module !== "undefined") module.exports = { ranquear, montarResumo, mensagemTelegram, escaparMarkdown, modeloWhatsApp, parametroModelo };
