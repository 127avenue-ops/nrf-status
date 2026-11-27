#!/usr/bin/env node
// Dashboard pre-publish check (no dependencies). From the repo root:
//   node tools/check.mjs            check the working files
//   node tools/check.mjs --staged   check what is about to be committed (used by .githooks/pre-commit)
// Exit 1 on errors; warnings only print.
//
// Guards (decided 2026-11-27):
//  - progress.json is valid JSON with the keys the page reads; real calendar dates; start <= end.
//  - no U+2014 / U+2013 (em/en dash) in progress.json values, llms.txt or index.html.
//  - no per-condition progress or timing, no wording that presupposes Study 3 results (FORBIDDEN).
//  - progress figures, record counts and ETA dates shown outside the log match the `run` object.
//  - files under freeze/ that existed on 2026-11-27 keep their exact content (FREEZE_PINNED);
//    new correction files may be added.
//
// When the Study 3 run ends (run.state "done"), update together (checklist, not enforced):
//  run.state/at/done · badge if needed · stages s3/pub · studies[s3].compute/status · tasks (re-date;
//  mark finished rows "done": true) · flow node "본 계산" (연구 3) and easy step "본 계산" (s: "done") ·
//  now (3 lines) · easy.nowNote · gains.axesNote · quality "연구 3 계산 용량" · llms.txt 최신 공지 ·
//  a log line. Do not publish a skip count or a final percentage below 100 %: write "계산 끝남".
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const STAGED = process.argv.includes("--staged");
const errors = [], warns = [];
const err = (m) => errors.push(m), warn = (m) => warns.push(m);
const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 << 20 });
const read = (p) => (STAGED ? git("show", ":" + p) : readFileSync(p, "utf8"));
const N = (s) => String(s).normalize("NFKC");
const kstToday = new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10);
const isDate = (s) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number), t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const isKstTime = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?\+09:00$/.test(s) && isDate(s.slice(0, 10)) && !isNaN(Date.parse(s));

let raw, P, llms, html;
try { raw = read("progress.json"); P = JSON.parse(raw); } catch (e) { console.log("ERROR progress.json: " + e.message); process.exit(1); }
try { llms = read("llms.txt"); html = read("index.html"); } catch (e) { console.log("ERROR cannot read llms.txt/index.html: " + e.message); process.exit(1); }
if (!P || typeof P !== "object" || Array.isArray(P)) { console.log("ERROR progress.json is not an object"); process.exit(1); }

// ---- shape
for (const k of ["updated", "now", "tasks", "flow", "log", "easy", "gains", "value", "run"]) if (!(k in P)) err(`progress.json: missing key "${k}"`);
for (const k of ["tasks", "log"]) if (k in P && !Array.isArray(P[k])) err(`${k} is not an array`);
if (!isDate(P.updated)) err(`updated is not a real date: ${P.updated}`);
else if (P.updated !== kstToday) warn(`updated ${P.updated} is not today (KST ${kstToday})`);
(Array.isArray(P.tasks) ? P.tasks : []).forEach((t, i) => {
  if (!t || typeof t !== "object") return err(`tasks[${i}] is not an object`);
  if (!isDate(t.start) || !isDate(t.end)) err(`tasks[${i}] start/end not real dates`);
  else if (t.start > t.end) err(`tasks[${i}] start > end`);
  if (!t.what) err(`tasks[${i}] has no "what"`);
});
const seen = new Set();
(Array.isArray(P.log) ? P.log : []).forEach((x, i) => {
  if (!x || !isDate(x.date)) return err(`log[${i}] date is not a real date`);
  if (seen.has(x.date)) warn(`log has two entries for ${x.date}`);
  seen.add(x.date);
});

// ---- dashes (parsed values, so — escapes are caught too)
const pubAll = JSON.stringify(P);
for (const [name, text] of [["progress.json", pubAll], ["llms.txt", llms], ["index.html", html]]) {
  const n = (text.match(/[–—]/g) || []).length;
  if (n) err(`${name}: ${n} em/en dash character(s)`);
}

// ---- forbidden wording (NFKC-normalised; log included except where noted)
const FORBIDDEN = [
  [/조건\s*\d+\s*개\s*(중|가운데)\s*\d+/, "per-condition progress count"],
  [/\d+\s*개\s*조건\s*(중|가운데)/, "per-condition progress count"],
  [/\d+\s*번째/, "per-condition progress position"],
  [/난이?도/, "condition difficulty (timing hint)"],
  [/(어려운|까다로운|쉬운)\s*조건/, "condition difficulty (timing hint)"],
  [/조건[^.\n"]{0,20}?\d+\s*(시간|분)\s*(넘게|이상|가까이)?\s*(걸|소요)/, "per-condition timing"],
  [/조건\s*\S{1,6}\s*:\s*[\d,]+\s*건/, "per-condition record count"],
  [/더\s*필요(할까|할지|한지)|몇\s*명이\s*더\s*필요/, "presupposes Study 3 direction"],
  [/결과\s*(를\s*)?(열람|보기|열기)\s*전에?\s*조사/, "wrong: Study 1 was opened on 10-24"],
  [/핵심\s*일정\s*\d+\s*개/, "hard-coded task count"],
];
const pubN = N(pubAll), llmsN = N(llms);
for (const [re, why] of FORBIDDEN) {
  const g = new RegExp(re.source, "g");
  const a = (pubN.match(g) || []), b = (llmsN.match(g) || []);
  if (a.length || b.length) err(`forbidden (${why}): ${[...a, ...b].slice(0, 3).join(" / ")}`);
}

// ---- run object and the figures shown from it
const R = P.run || {};
const okInt = (v) => Number.isSafeInteger(v) && v >= 0;
if (!okInt(R.done) || !okInt(R.total) || !(R.total > 0) || !okInt(R.errors)) err("run.done/total/errors must be non-negative integers and total > 0");
else if (R.done > R.total) err(`run.done ${R.done} > total ${R.total}`);
if (!["running", "done", "paused"].includes(R.state)) err(`run.state must be running/done/paused: ${R.state}`);
if (!isKstTime(R.at)) err(`run.at must be a KST time like 2026-11-27T07:22+09:00: ${R.at}`);
if (!isKstTime(R.deadline)) err(`run.deadline must be a KST time: ${R.deadline}`);
for (const k of ["eta", "etaLate"]) if (R[k] != null && !isDate(R[k])) err(`run.${k} is not a real date`);
if (okInt(R.done) && okInt(R.total) && R.total > 0) {
  const pct10 = Math.floor((R.done * 1000) / R.total), pct = (pct10 / 10).toFixed(1), pctInt = String(Math.floor(pct10 / 10));
  const { log, ...rest } = P;
  const strings = [];
  (function walk(o) { if (typeof o === "string") strings.push(N(o)); else if (o && typeof o === "object") Object.values(o).forEach(walk); })(rest);
  const notice = N((llms.match(/## 최신 공지[\s\S]*?(?=\n## )/) || [""])[0]);
  strings.push(notice);
  const md = (iso) => iso ? `${+iso.slice(5, 7)}월 ${+iso.slice(8, 10)}일` : null;
  for (const s of strings) {
    for (const m of s.matchAll(/약\s*(\d+(?:\.\d+)?)\s*%/g)) {
      const v = m[1], aboutRun = /계산|진행/.test(s);
      if (R.state === "done" && aboutRun) err(`run is done but a progress figure remains: "${m[0]}"`);
      else if (v.includes(".") ? v !== pct : aboutRun && v !== pctInt) err(`"${m[0]}" does not match run (${pct} %)`);
    }
    for (const m of s.matchAll(/(\d{1,3}(?:,\d{3})+)\s*건/g)) {
      const v = Number(m[1].replace(/,/g, ""));
      if (v !== R.done && v !== R.total && /계산|진행/.test(s)) err(`record count "${m[0]}" is neither run.done nor run.total`);
    }
    if (R.state === "running") {
      for (const m of s.matchAll(/(\d{1,2})월\s*(\d{1,2})일쯤/g)) if (R.eta && `${+m[1]}월 ${+m[2]}일` !== md(R.eta)) err(`"${m[0]}" does not match run.eta ${R.eta}`);
      for (const m of s.matchAll(/(\d{1,2})-(\d{2})쯤/g)) if (R.eta && `${m[1].padStart(2, "0")}-${m[2]}` !== R.eta.slice(5)) err(`"${m[0]}" does not match run.eta ${R.eta}`);
      for (const m of s.matchAll(/늦어지면\s*(\d{1,2})월\s*(\d{1,2})일/g)) if (R.etaLate && `${+m[1]}월 ${+m[2]}일` !== md(R.etaLate)) err(`"${m[0]}" does not match run.etaLate ${R.etaLate}`);
    }
  }
}
const flowNode = ((P.flow?.lanes || []).find((l) => l?.name === "연구 3")?.nodes || []).find((n) => n?.t === "본 계산" || n?.t === "새 표본 계산");
const easyStep = (P.easy?.steps || []).find((s) => s?.t === "본 계산");
if (flowNode && easyStep && flowNode.s !== easyStep.s) err(`flow "본 계산" is ${flowNode.s} but easy "본 계산" is ${easyStep.s}`);
if (R.state === "running" && flowNode && flowNode.s !== "now") err("run is running but the flow node is not now");
const nd = llms.match(/## 최신 공지 \((\d{4}-\d{2}-\d{2})/);
if (!nd) warn("llms.txt has no 최신 공지 heading");
else if (nd[1] !== P.updated) warn(`llms.txt 최신 공지 ${nd[1]} != updated ${P.updated}`);

// ---- freeze/: pinned contents (blob ids at 2026-11-27); new files allowed
const FREEZE_PINNED = {
  "freeze/study1_42288bbd92569f0b.json": "ef01753641afcda46745514461d8b5e26221d637",
  "freeze/study2_6c514d2f78ddaefe.json": "e5efe3faa31db8034298c7ee3019179f78fb3807",
  "freeze/study3_0d104041e50cee1d.json": "37d7afe7200c8327c4f871c4f9183734710761c7",
  "freeze/study3_amend5_816e39e3aa8acae5.json": "60c5798a0489cfab0b0bbdfa26a252c0ababb12f",
  "freeze/study3_erratum1_note_role.json": "26af5206f069ea8696643a22616d662af403102e", // published 2026-11-27
};
try {
  const listing = STAGED ? git("ls-files", "-s", "--", "freeze") : git("ls-files", "-s", "--", "freeze");
  const now = new Map(listing.split("\n").filter(Boolean).map((l) => { const [meta, path] = l.split("\t"); return [path, meta.split(" ")[1]]; }));
  for (const [path, blob] of Object.entries(FREEZE_PINNED)) {
    if (!now.has(path)) err(`freeze file removed or renamed: ${path}`);
    else if (now.get(path) !== blob) err(`freeze file changed: ${path}`);
  }
  if (!STAGED) {
    const wt = git("status", "--porcelain", "--", "freeze").split("\n").filter((l) => l && !/^(\?\?|A.)/.test(l));
    if (wt.length) err("freeze/ has modified or deleted files: " + wt.join("; "));
  }
} catch (e) { err("freeze/ check failed: " + (e.message || e)); }

for (const w of warns) console.log("warn  " + w);
for (const e of errors) console.log("ERROR " + e);
console.log(errors.length ? `check: ${errors.length} error(s)` : `check: ok (${warns.length} warning(s))`);
process.exit(errors.length ? 1 : 0);
