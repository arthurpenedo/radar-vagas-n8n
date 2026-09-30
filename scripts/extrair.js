// Lê a saída de `n8n execute --rawOutput`, confere que a execução não teve erro e extrai o resumo.
//
//   node scripts/extrair.js execucao.json resumo.json
//
// A saída do CLI traz linhas de log antes do JSON; o JSON começa na primeira linha que é só "{".

const fs = require("node:fs");

function lerExecucao(texto) {
  const inicio = texto.search(/^\{\s*$/m);
  if (inicio < 0) throw new Error("A saída do n8n não contém o JSON da execução.");
  return JSON.parse(texto.slice(inicio));
}

function extrairResumo(execucao) {
  const { runData, error } = execucao.data.resultData;
  if (error) throw new Error(`Execução falhou: ${error.message}`);
  const comErro = Object.entries(runData).filter(([, runs]) => runs.some((r) => r.error)).map(([nome]) => nome);
  if (comErro.length) throw new Error(`Nós com erro: ${comErro.join(", ")}`);
  const resumo = runData["Montar resumo"]?.[0]?.data?.main?.[0]?.[0]?.json;
  if (!resumo) throw new Error("O nó 'Montar resumo' não produziu saída.");
  // Chamadas que falharam mas foram toleradas (onError: continue) aparecem como itens com "error".
  const falhas = (nome) => (runData[nome]?.[0]?.data?.main?.[0] || []).filter((i) => i.json.error).length;
  resumo.falhas = { gupy: falhas("Buscar na Gupy"), ats_match: falhas("Pontuar com ats-match"), whatsapp: falhas("WhatsApp") };
  resumo.whatsapp_enviado = Boolean(runData["WhatsApp"]) && resumo.falhas.whatsapp === 0;
  resumo.nos_executados = Object.keys(runData);
  return resumo;
}

if (require.main === module) {
  const [entrada, saida] = process.argv.slice(2);
  const resumo = extrairResumo(lerExecucao(fs.readFileSync(entrada, "utf8")));
  fs.writeFileSync(saida, JSON.stringify(resumo, null, 2));
  const e = resumo.estatisticas;
  console.log(`recebidas ${e.recebidas} → aprovadas no filtro ${e.aprovadas} → no ranking ${resumo.vagas.length}` +
    ` (falhas: gupy ${resumo.falhas.gupy}, ats-match ${resumo.falhas.ats_match})`);
  if (resumo.falhas.gupy === resumo.termos.length) {
    console.error("Todas as buscas na Gupy falharam: a API pode ter mudado.");
    process.exit(1);
  }
}

module.exports = { lerExecucao, extrairResumo };
