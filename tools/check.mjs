#!/usr/bin/env node
// 리포 관리자용 검사기. 학습자에게는 필요 없다.
// 검사: 커리큘럼 형식·선수 관계, 국내 근거·글로벌 비교 칸(R10), 출처 URL·조회일(R11),
// 출처 공식 도메인 허용 목록(R11), 경계·연결 줄(R13), 미리 만든 시각 자료 없음(R5), 설정 JSON 유효성.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

const LEVELS = ["Explain", "Apply", "Evaluate", "Develop"];
const FIELDS = ["선수", "핵심 질문", "목표", "만들어 볼 것", "국내 근거", "글로벌 비교"];

function parseCurriculum(text) {
  const modules = new Map();
  const boundaryOf = new Map();
  const problems = [];
  const blocks = text.split(/^## (이 지도에 넣지 않은 영역|출처)/m)[0].split(/^### /m).slice(1);
  for (const block of blocks) {
    const head = block.split("\n")[0];
    const m = head.match(/^([BCMPKWX]\d+) · (.+)$/);
    if (!m) { problems.push(`모듈 제목 형식 오류: ${head}`); continue; }
    const id = m[1];
    if (modules.has(id)) problems.push(`${id}: 중복 id`);
    const fields = {};
    for (const line of block.split("\n").slice(1)) {
      const f = line.match(/^- ([^:]+): (.+)$/);
      if (f) fields[f[1]] = f[2];
    }
    for (const name of FIELDS) if (!fields[name]) problems.push(`${id}: 「${name}」 없음`);
    if (fields["목표"] && !LEVELS.some((l) => fields["목표"].startsWith(`${l} — `))) problems.push(`${id}: 목표 수준 형식 오류`);
    const prereq = !fields["선수"] || fields["선수"] === "없음" ? [] : fields["선수"].split(",").map((s) => s.trim());
    modules.set(id, prereq);
    boundaryOf.set(id, Boolean(fields["경계·연결"]));
  }
  for (const [id, prereq] of modules) for (const p of prereq) if (!modules.has(p)) problems.push(`${id}: 없는 선수 ${p}`);
  const state = new Map();
  const visit = (id, path) => {
    if (state.get(id) === 2 || !modules.has(id)) return;
    if (state.get(id) === 1) { problems.push(`선수 순환: ${[...path, id].join(" → ")}`); return; }
    state.set(id, 1);
    for (const p of modules.get(id)) visit(p, [...path, id]);
    state.set(id, 2);
  };
  for (const id of modules.keys()) visit(id, []);
  return { modules, boundaryOf, problems };
}

// R11(c) 공식 도메인 허용 목록 — docs/build/spec.md R11과 같게 유지한다.
const OFFICIAL = ["law.go.kr", "nhis.or.kr", "4insure.or.kr", "likms.assembly.go.kr", "moleg.go.kr", "fsc.go.kr", "fss.or.kr", "dart.fss.or.kr", "krx.co.kr", "kind.krx.co.kr", "kasb.or.kr", "kicpa.or.kr", "korea.kr", "imaglobal.org", "imanet.org", "aicpa-cima.com", "cgma.org", "fm-magazine.com", "afponline.org", "financialprofessionals.org", "apqc.org", "sec.gov", "ecfr.gov", "handbook.fca.org.uk", "eur-lex.europa.eu", "frc.org.uk", "ifrs.org", "fasb.org", "oecd.org", "ibcs.com", "bbrt.org", "hbr.org", "doi.org"];

// 출처 절: 목록 줄마다 URL과 조회일(YYYY-MM-DD)이 있어야 한다.
function checkSources(text) {
  const problems = [];
  const sec = text.split(/^## 출처\s*$/m)[1];
  if (!sec) return ["출처 절 없음"];
  const items = sec.split("\n").filter((l) => l.startsWith("- "));
  if (items.length === 0) problems.push("출처 절에 항목 없음");
  for (const l of items) {
    if (!/https?:\/\//.test(l)) problems.push(`출처 URL 없음: ${l.slice(0, 40)}`);
    if (!/조회 \d{4}-\d{2}-\d{2}/.test(l)) problems.push(`출처 조회일 없음: ${l.slice(0, 40)}`);
    for (const u of l.matchAll(/https?:\/\/([^/\s)>]+)/g)) {
      const host = u[1].toLowerCase().replace(/^www\./, "");
      if (!OFFICIAL.some((d) => host === d || host.endsWith(`.${d}`))) problems.push(`공식 도메인 밖 출처: ${host}`);
    }
  }
  return problems;
}

// 구축 기준의 경계 표에서 「걸리는 모듈」을 읽는다.
function boundaryModules(spec) {
  const ids = new Set();
  for (const line of spec.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length === 6 && /go-/.test(cells[3])) for (const id of cells[4].matchAll(/\b[BCMPKWX]\d+\b/g)) ids.add(id[0]);
  }
  return ids;
}

function findVisualAssets(files) {
  const allowedJs = /^tools\/.*\.m?js$/;
  return files.filter((f) => /\.(html?|css|svg|png|jpe?g|gif|webp|avif)$/i.test(f) || (/\.m?js$/i.test(f) && !allowedJs.test(f)));
}

function findTemplateMarkup(name, text) {
  const hits = [];
  for (const m of text.matchAll(/(```|~~~)[\s\S]*?\1/g)) if (/<(!doctype|html|svg|style|canvas|script)\b/i.test(m[0])) hits.push(name);
  return hits;
}

function main() {
  const mapText = read("curriculum/map.md");
  const { modules, boundaryOf, problems } = parseCurriculum(mapText);
  errors.push(...problems);
  errors.push(...checkSources(mapText));
  for (const id of boundaryModules(read("docs/build/spec.md"))) {
    if (!modules.has(id)) errors.push(`경계 표의 없는 모듈 ${id}`);
    else if (!boundaryOf.get(id)) errors.push(`${id}: 「경계·연결」 없음`);
  }
  if (modules.size === 0) errors.push("모듈을 찾지 못함");

  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  for (const f of findVisualAssets(files)) errors.push(`미리 만든 시각 자료 금지: ${f}`);
  for (const f of files.filter((x) => x.endsWith(".md") && existsSync(join(root, x)))) for (const n of findTemplateMarkup(f, read(f))) errors.push(`복사용 마크업 금지: ${n}`);

  for (const p of [".claude/settings.json", "learner-template/state.json"]) {
    try { JSON.parse(read(p)); } catch (e) { errors.push(`${p}: JSON 오류 ${e.constructor.name}`); }
  }
  if (!existsSync(join(root, "learner-template/log.md"))) errors.push("learner-template/log.md 없음");
  for (const s of readdirSync(join(root, ".claude/skills"))) {
    if (statSync(join(root, ".claude/skills", s)).isDirectory() && !existsSync(join(root, ".claude/skills", s, "SKILL.md"))) errors.push(`스킬 ${s}: SKILL.md 없음`);
  }
  if (!read(".gitignore").split("\n").includes("learner/")) errors.push(".gitignore에 learner/ 없음");

  if (errors.length) { console.error(errors.map((e) => `FAIL ${e}`).join("\n")); process.exit(1); }
  console.log(`OK 모듈 ${modules.size}개, 파일 ${files.length}개 검사`);
}

main();
