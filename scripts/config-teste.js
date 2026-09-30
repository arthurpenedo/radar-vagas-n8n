// Liga o WhatsApp apontando para a Meta falsa e regenera o workflow (usado só no CI).
//   node scripts/config-teste.js http://localhost:9999/v23.0
const fs = require("node:fs");
const path = require("node:path");
const arquivo = path.join(__dirname, "..", "config", "config.json");
const cfg = JSON.parse(fs.readFileSync(arquivo, "utf8"));
Object.assign(cfg.whatsapp, { ativo: true, graph_url: process.argv[2], phone_number_id: "PNID-TESTE", para: "5511900000000" });
fs.writeFileSync(arquivo, JSON.stringify(cfg, null, 2) + "\n");
require("./build.js");
