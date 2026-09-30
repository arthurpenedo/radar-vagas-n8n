// Gera a página pública do radar a partir do resumo que o workflow produziu.
//
//   node scripts/pagina.js resumo.json site/index.html
//
// O CI roda o workflow no n8n todo dia útil e publica esta página no GitHub Pages.

const fs = require("node:fs");
const path = require("node:path");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const MOTIVOS = [
  ["recebidas", "vagas recebidas da Gupy"],
  ["duplicadas", "repetidas entre termos"],
  ["antigas", "publicadas há mais tempo que a janela"],
  ["fora_do_modelo", "presenciais fora das cidades escolhidas"],
  ["excluidas", "com termo excluído no título (sênior, gerente...)"],
  ["abaixo_da_nota", "abaixo da nota mínima de aderência"],
  ["sem_nota", "sem nota (descrição vazia ou ats-match indisponível)"],
];

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--fg:#17181c;--muted:#65676e;--line:#e3e5ea;--accent:#ea4b71;--accent-bg:#fde8ee;
--ok:#1f8a4c;--warn:#b7791f;--bad:#c2372e}
@media (prefers-color-scheme:dark){:root{--bg:#121316;--card:#1b1c20;--fg:#ececf0;--muted:#9a9ba3;--line:#2b2d33;
--accent:#ff7896;--accent-bg:#3a1f28;--ok:#4cc38a;--warn:#e0a84a;--bad:#ff6b61}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:920px;margin:0 auto;padding:32px 16px 64px}h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:32px 0 12px}
a{color:var(--accent)}.muted{color:var(--muted)}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.fluxo{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:13px}.fluxo span{background:var(--accent-bg);color:var(--accent);
padding:3px 10px;border-radius:999px;font-weight:600}.fluxo i{color:var(--muted);font-style:normal}
.vaga{display:grid;grid-template-columns:64px 1fr;gap:14px;align-items:start;margin-bottom:10px}
.nota{font-size:24px;font-weight:700;text-align:center;font-variant-numeric:tabular-nums;border-radius:10px;padding:8px 0}
.alta{color:var(--ok);background:color-mix(in srgb,var(--ok) 12%,transparent)}.media{color:var(--warn);background:color-mix(in srgb,var(--warn) 12%,transparent)}
.vaga h3{margin:0 0 2px;font-size:16px}.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;font-size:12px}
.tags span{border:1px solid var(--line);border-radius:999px;padding:1px 8px}.tags .falta{border-color:var(--bad);color:var(--bad)}
table{width:100%;border-collapse:collapse}td{padding:6px 4px;border-bottom:1px solid var(--line)}td.n{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
footer{margin-top:40px;font-size:13px}`;

function render(resumo) {
  const e = resumo.estatisticas || {};
  const vagas = (resumo.vagas || []).map((v) => {
    const classe = v.nota >= 70 ? "alta" : "media";
    const falta = (v.faltando || []).map((f) => `<span class="falta">falta: ${esc(f)}</span>`).join("");
    const local = [v.modelo, v.cidade].filter(Boolean).join(" · ");
    return `<div class="card vaga"><div class="nota ${classe}">${esc(v.nota)}</div><div>
<h3><a href="${esc(v.link)}" rel="noopener">${esc(v.titulo)}</a></h3>
<div class="muted">${esc(v.empresa)} · ${esc(local)} · publicada em ${esc(String(v.publicada).slice(0, 10))}</div>
<div class="tags">${(v.atendidas || []).slice(0, 6).map((a) => `<span>${esc(a)}</span>`).join("")}${falta}</div></div></div>`;
  }).join("\n");
  const linhas = MOTIVOS.filter(([k]) => e[k] !== undefined)
    .map(([k, rotulo]) => `<tr><td>${esc(rotulo)}</td><td class="n">${esc(e[k])}</td></tr>`).join("");
  const dataBr = new Date(resumo.gerado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Radar de vagas · n8n</title><style>${CSS}</style></head><body><main>
<h1>Radar de vagas de IA e automação</h1>
<p class="muted">Gerado por um workflow do <strong>n8n</strong> que roda no GitHub Actions todo dia útil: busca vagas na Gupy,
filtra, pontua cada uma contra um currículo com o <a href="https://github.com/arthurpenedo/ats-match">ats-match</a> e ranqueia.
O currículo usado aqui é de uma personagem fictícia (analista de dados júnior com IA). Última execução: ${esc(dataBr)}.</p>
<div class="card fluxo"><span>Agendamento</span><i>→</i><span>Gupy (${esc((resumo.termos || []).length)} termos)</span><i>→</i>
<span>Filtros</span><i>→</i><span>ats-match /match</span><i>→</i><span>Ranking</span><i>→</i><span>Telegram / esta página</span></div>
<h2>${(resumo.vagas || []).length} vagas acima da nota mínima</h2>
${vagas || '<div class="card muted">Nenhuma vaga nova acima da nota mínima nesta execução.</div>'}
<h2>O que o filtro descartou</h2>
<div class="card"><table>${linhas}<tr><td><strong>no ranking</strong></td><td class="n">${esc((resumo.vagas || []).length)}</td></tr></table></div>
<footer class="muted">Termos: ${esc((resumo.termos || []).join(", "))}. Código e workflow:
<a href="https://github.com/arthurpenedo/radar-vagas-n8n">github.com/arthurpenedo/radar-vagas-n8n</a> · Feito por
<a href="https://github.com/arthurpenedo">Arthur Penedo</a>.</footer></main></body></html>`;
}

if (require.main === module) {
  const [entrada, saida] = process.argv.slice(2);
  const resumo = JSON.parse(fs.readFileSync(entrada, "utf8"));
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  fs.writeFileSync(saida, render(resumo));
  console.log(`página: ${saida} (${(resumo.vagas || []).length} vagas)`);
}

module.exports = { render };
