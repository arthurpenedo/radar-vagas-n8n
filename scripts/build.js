// Gera workflows/radar-vagas.json a partir de src/*.js e config/.
//
//   node scripts/build.js           escreve o workflow
//   node scripts/build.js --check   falha se o arquivo commitado estiver desatualizado (usado no CI)
//
// Por que gerar: a lógica dos nós Code vive em arquivos .js de verdade, com testes (node --test).
// Editar JavaScript dentro de uma string num JSON de 600 linhas não é testável nem revisável.

const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..");
const SAIDA = path.join(RAIZ, "workflows", "radar-vagas.json");

// Sempre LF: o mesmo JSON precisa sair igual no Windows e no CI.
const CR = String.fromCharCode(13);
const ler = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), "utf8").split(CR).join("");

function fonte(nome) {
  const codigo = ler("src", nome);
  return codigo.replace(/^if \(typeof module !== "undefined"\).*$/m, "").trim();
}

function no(id, nome, tipo, versao, posicao, parametros, extra = {}) {
  return { id, name: nome, type: `n8n-nodes-base.${tipo}`, typeVersion: versao, position: posicao, parameters: parametros, ...extra };
}

function code(id, nome, posicao, js) {
  return no(id, nome, "code", 2, posicao, { jsCode: js });
}

function build() {
  const config = JSON.parse(ler("config", "config.json"));
  config.curriculo = ler("config", "curriculo.md");
  const CFG = "$('Configuração').first().json";

  const nodes = [
    no("a1", "Execução manual", "manualTrigger", 1, [0, 0], {}),
    no("a2", "Dias úteis às 8h", "scheduleTrigger", 1.2, [0, 200], {
      rule: { interval: [{ field: "cronExpression", expression: "0 8 * * 1-5" }] },
    }),
    code("b1", "Configuração", [220, 100],
      "// Edite aqui (ou em config/config.json + npm run build): termos, filtros, currículo e entrega.\n" +
      `return [{ json: ${JSON.stringify(config, null, 2)} }];`),
    code("b2", "Um item por termo", [440, 100],
      "return $input.first().json.termos.map((termo) => ({ json: { termo } }));"),
    no("b3", "Buscar na Gupy", "httpRequest", 4.2, [660, 100], {
      url: "https://portal.gupy.io/api/job-search/jobs",
      sendQuery: true,
      queryParameters: { parameters: [
        { name: "jobName", value: "={{ $json.termo }}" },
        { name: "limit", value: `={{ ${CFG}.limite_por_termo }}` },
        { name: "offset", value: "0" },
      ] },
      options: { timeout: 30000 },
    }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: "continueRegularOutput" }),
    code("b4", "Filtrar vagas", [880, 100],
      `${fonte("filtrar.js")}\n\nconst cfg = ${CFG};\n` +
      "const { vagas, estatisticas } = filtrarVagas($input.all().map((i) => i.json), cfg);\n" +
      "if (!vagas.length) return [{ json: { _vazio: true, _estatisticas: estatisticas } }];\n" +
      "return vagas.map((v) => ({ json: { ...v, _estatisticas: estatisticas } }));"),
    no("b5", "Tem vaga nova?", "if", 2.2, [1100, 100], {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 2 },
        conditions: [{ id: "c1", leftValue: "={{ $json._vazio }}", rightValue: true,
          operator: { type: "boolean", operation: "notEquals" } }],
        combinator: "and",
      },
      looseTypeValidation: true,
      options: {},
    }),
    no("b6", "Pontuar com ats-match", "httpRequest", 4.2, [1320, 0], {
      method: "POST",
      url: `={{ ${CFG}.ats_url }}/match`,
      sendBody: true,
      specifyBody: "json",
      jsonBody: `={{ JSON.stringify({ resume: ${CFG}.curriculo, job: $json.titulo + "\\n\\n" + $json.descricao }) }}`,
      options: { timeout: 30000 },
    }, { onError: "continueRegularOutput" }),
    code("b7", "Montar resumo", [1540, 100],
      `${fonte("resumo.js")}\n\nconst cfg = ${CFG};\n` +
      "const filtradas = $('Filtrar vagas').all().map((i) => i.json);\n" +
      "const vagas = filtradas.filter((v) => !v._vazio);\n" +
      "const notas = vagas.length ? $input.all().map((i) => i.json) : [];\n" +
      "return [{ json: montarResumo(vagas, notas, filtradas[0]._estatisticas, cfg) }];"),
    no("b8", "Enviar no Telegram?", "if", 2.2, [1760, 100], {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 2 },
        conditions: [{ id: "c2", leftValue: `={{ ${CFG}.telegram.ativo }}`, rightValue: true,
          operator: { type: "boolean", operation: "true", singleValue: true } }],
        combinator: "and",
      },
      looseTypeValidation: true,
      options: {},
    }),
    no("b9", "Telegram", "telegram", 1.2, [1980, 0], {
      chatId: `={{ ${CFG}.telegram.chat_id }}`,
      text: "={{ $json.telegram }}",
      additionalFields: { parse_mode: "MarkdownV2", disable_web_page_preview: true, appendAttribution: false },
    }),
  ];

  const liga = (destino) => ({ main: [[{ node: destino, type: "main", index: 0 }]] });
  const connections = {
    "Execução manual": liga("Configuração"),
    "Dias úteis às 8h": liga("Configuração"),
    "Configuração": liga("Um item por termo"),
    "Um item por termo": liga("Buscar na Gupy"),
    "Buscar na Gupy": liga("Filtrar vagas"),
    "Filtrar vagas": liga("Tem vaga nova?"),
    "Tem vaga nova?": { main: [[{ node: "Pontuar com ats-match", type: "main", index: 0 }],
      [{ node: "Montar resumo", type: "main", index: 0 }]] },
    "Pontuar com ats-match": liga("Montar resumo"),
    "Montar resumo": liga("Enviar no Telegram?"),
    "Enviar no Telegram?": { main: [[{ node: "Telegram", type: "main", index: 0 }], []] },
  };

  const workflow = {
    id: "radarVagasN8n001",
    name: "Radar de vagas (Gupy + ats-match)",
    active: false,
    nodes,
    connections,
    settings: { executionOrder: "v1", timezone: "America/Sao_Paulo" },
    pinData: {},
    tags: [],
  };
  return JSON.stringify(workflow, null, 2) + "\n";
}

const gerado = build();
if (process.argv.includes("--check")) {
  const atual = fs.existsSync(SAIDA) ? fs.readFileSync(SAIDA, "utf8") : "";
  if (atual.replace(/\r\n/g, "\n") !== gerado) {
    console.error("workflows/radar-vagas.json está desatualizado: rode `npm run build` e commite.");
    process.exit(1);
  }
  console.log("workflow em dia");
} else {
  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, gerado);
  console.log(`gerado ${path.relative(RAIZ, SAIDA)}`);
}
