const { test } = require("node:test");
const assert = require("node:assert/strict");
const respostas = require("./fixtures/gupy.json");
const { filtrarVagas, contemTermo, normalizarVaga } = require("../src/filtrar.js");
const { montarResumo, escaparMarkdown } = require("../src/resumo.js");

const AGORA = new Date("2026-10-01T00:00:00Z");
const CFG = { horas: 24 * 30, modelos: ["remoto", "hibrido"], cidades: ["São Paulo"], excluir: ["sênior", "sr"],
  termos: ["inteligência artificial"], nota_minima: 40, maximo: 10 };

test("normaliza os campos da Gupy", () => {
  const v = normalizarVaga(respostas[0].data[0]);
  assert.ok(v.id && v.titulo && v.link.startsWith("https://"));
  assert.ok(["remoto", "hibrido", "presencial"].includes(v.modelo));
});

test("filtra por data, modelo/cidade e termos excluídos, contando cada descarte", () => {
  const { vagas, estatisticas: e } = filtrarVagas(respostas, CFG, AGORA);
  assert.equal(e.recebidas, 30);
  assert.equal(e.recebidas, e.duplicadas + e.antigas + e.fora_do_modelo + e.excluidas + e.aprovadas);
  for (const v of vagas) {
    assert.ok(v.modelo === "remoto" || v.cidade === "São Paulo", `${v.titulo}: ${v.modelo} ${v.cidade}`);
    assert.ok(!/s[eê]nior|\bsr\b/i.test(v.titulo), v.titulo);
  }
  assert.ok(e.fora_do_modelo > 0 && vagas.length > 0);
});

test("janela de horas corta vagas antigas", () => {
  const todas = filtrarVagas(respostas, CFG, AGORA).vagas.length;
  const ultimoDia = filtrarVagas(respostas, { ...CFG, horas: 24 }, AGORA);
  assert.ok(ultimoDia.vagas.length < todas);
  assert.ok(ultimoDia.vagas.every((v) => new Date(v.publicada) >= new Date("2026-09-30T00:00:00Z")));
});

test("híbrido e presencial só valem nas cidades escolhidas; remoto vale de qualquer lugar", () => {
  const vaga = (id, workplaceType, city) => ({ id, name: "Analista de IA", careerPageName: "E", workplaceType, city,
    publishedDate: "2026-09-30T10:00:00Z", jobUrl: "https://x/" + id });
  const cfg = { ...CFG, modelos: ["remoto", "hibrido", "presencial"] };
  const { vagas } = filtrarVagas([{ data: [vaga(1, "hybrid", "São Luís"), vaga(2, "hybrid", "Sao Paulo"),
    vaga(3, "on-site", "Recife"), vaga(4, "remote", "Recife"), vaga(5, "on-site", "São Paulo")] }], cfg, AGORA);
  assert.deepEqual(vagas.map((v) => v.id), [2, 4, 5]);
  const soRemoto = filtrarVagas([{ data: [vaga(5, "on-site", "São Paulo"), vaga(4, "remote", "Recife")] }],
    { ...CFG, modelos: ["remoto"] }, AGORA);
  assert.deepEqual(soRemoto.vagas.map((v) => v.id), [4]);
});

test("vaga repetida em dois termos conta uma vez só", () => {
  const { estatisticas } = filtrarVagas([respostas[0], respostas[0]], CFG, AGORA);
  assert.equal(estatisticas.duplicadas, respostas[0].data.length);
});

test("termo excluído casa palavra inteira e ignora acento", () => {
  assert.ok(contemTermo("Analista de Dados Sênior", "senior"));
  assert.ok(contemTermo("Dev Python Sr.", "sr"));
  assert.ok(!contemTermo("Engenheiro SRE", "sr"));
});

test("resumo ranqueia pela nota, respeita nota mínima e conta vagas sem nota", () => {
  const vagas = [{ id: 1, titulo: "A", empresa: "X", modelo: "remoto", link: "https://a", publicada: "2026-09-30" },
    { id: 2, titulo: "B", empresa: "Y", modelo: "hibrido", link: "https://b", publicada: "2026-09-30" },
    { id: 3, titulo: "C", empresa: "Z", modelo: "remoto", link: "https://c", publicada: "2026-09-30" },
    { id: 4, titulo: "D", empresa: "W", modelo: "remoto", link: "https://d", publicada: "2026-09-30" }];
  const notas = [{ score: 55, missing_required: ["Docker"] }, { score: 90, missing_required: [] }, { score: 20 }, {}];
  const r = montarResumo(vagas, notas, { recebidas: 4 }, CFG, AGORA);
  assert.deepEqual(r.vagas.map((v) => v.id), [2, 1]);
  assert.equal(r.estatisticas.abaixo_da_nota, 1);
  assert.equal(r.estatisticas.sem_nota, 1);
  assert.ok(r.vagas.every((v) => v.descricao === undefined)); // descrição não vai para o resumo
  assert.match(r.telegram, /\*90\* · \[B\]\(https:\/\/b\)/);
  assert.match(r.telegram, /falta: Docker/);
});

test("WhatsApp: modelo aprovado com 6 parâmetros, sem quebra de linha e com a melhor vaga", () => {
  const cfg = { ...CFG, whatsapp: { para: "5511900000000", modelo: "radar_vagas", link_pagina: "https://x/radar" } };
  const vagas = [{ id: 1, titulo: "Analista\nde IA   Jr", empresa: "Empresa X", modelo: "remoto", link: "https://a", publicada: "2026-09-30" }];
  const r = montarResumo(vagas, [{ score: 88 }], {}, cfg, AGORA);
  assert.equal(r.whatsapp.type, "template");
  assert.equal(r.whatsapp.template.name, "radar_vagas");
  assert.equal(r.whatsapp.template.language.code, "pt_BR");
  const params = r.whatsapp.template.components[0].parameters.map((p) => p.text);
  assert.deepEqual(params, ["2026-10-01", "1", "Analista de IA Jr", "Empresa X", "88", "https://x/radar"]);
  assert.ok(params.every((p) => !/\n|\t| {5}/.test(p)));
  const vazio = montarResumo([], [], {}, cfg, AGORA).whatsapp.template.components[0].parameters.map((p) => p.text);
  assert.deepEqual(vazio.slice(1, 5), ["0", "nenhuma hoje", "-", "-"]);
  assert.equal(montarResumo([], [], {}, CFG, AGORA).whatsapp, null); // sem configuração, sem WhatsApp
});

test("mensagem do Telegram escapa MarkdownV2 e respeita o limite", () => {
  assert.equal(escaparMarkdown("Dev (Jr.) - IA"), "Dev \\(Jr\\.\\) \\- IA");
  const muitas = Array.from({ length: 200 }, (_, i) => ({ id: i, titulo: "Vaga ".repeat(10), empresa: "E",
    modelo: "remoto", link: "https://x/" + i, publicada: "2026-09-30" }));
  const r = montarResumo(muitas, muitas.map(() => ({ score: 80 })), {}, { ...CFG, maximo: 200 }, AGORA);
  assert.ok(r.telegram.length <= 4096);
});
