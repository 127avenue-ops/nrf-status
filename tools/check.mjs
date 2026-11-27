#!/usr/bin/env node
// Dashboard pre-publish check (no dependencies). Run from the repo root:  node tools/check.mjs
// Exit 1 on errors (blocks the commit when used as the pre-commit hook), warnings only print.
//
// What it guards (decided 2026-11-27):
//  - progress.json is valid JSON with the keys the page reads; task/log dates are ISO; start <= end.
//  - public text has no U+2014 / U+2013 (em/en dash).
//  - no per-condition progress or timing, no wording that presupposes Study 3 results (see FORBIDDEN).
//  - every "약 NN.N %" outside the log equals run.done / run.total (one source for the progress figure).
//  - existing files under freeze/ are never modified or deleted (new correction files may be added).
//
// When the Study 3 run ends (state "done"), update together (checklist, not enforced):
//  run.state/at/done · badge if needed · stages s3/pub · studies[s3].compute/status · tasks (re-date;
//  mark finished rows "done": true) · flow node "새 표본 계산" and easy step "본 계산" (s: "done") ·
//  now (3 lines) · easy.nowNote · gains.axesNote · quality "연구 3 계산 용량" · llms.txt 최신 공지 ·
//  a log line. Do not publish a skip count or a final percentage below 100 %: write "계산 끝남".
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const errors = [], warns = [];
const err = (m) => errors.push(m), warn = (m) => warns.push(m);
const read = (p) => readFileSync(p, "utf8");
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const kstToday = new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10);

let raw, P;
try { raw = read("progress.json"); P = JSON.parse(raw); } catch (e) { console.error("progress.json: " + e.message); process.exit(1); }
const llms = read("llms.txt");

for (const k of ["updated", "now", "tasks", "flow", "log", "easy", "gains", "value", "run"]) if (!(k in P)) err(`progress.json: missing key "${k}"`);
if (!ISO.test(P.updated || "")) err(`updated is not YYYY-MM-DD: ${P.updated}`);
else if (P.updated !== kstToday) warn(`updated ${P.updated} is not today (KST ${kstToday})`);

(P.tasks || []).forEach((t, i) => {
  if (!ISO.test(t.start || "") || !ISO.test(t.end || "")) err(`tasks[${i}] start/end not ISO`);
  else if (t.start > t.end) err(`tasks[${i}] start > end`);
  if (!t.what) err(`tasks[${i}] has no "what"`);
});
const seen = new Set();
(P.log || []).forEach((x, i) => {
  if (!ISO.test(x.date || "")) err(`log[${i}] date not ISO`);
  if (seen.has(x.date)) warn(`log has two entries for ${x.date}`);
  seen.add(x.date);
});

for (const [name, text] of [["progress.json", raw], ["llms.txt", llms]]) {
  const n = (text.match(/[–—]/g) || []).length;
  if (n) err(`${name}: ${n} em/en dash character(s)`);
}

const FORBIDDEN = [
  [/조건 \d+개 중 \d+개/, "per-condition progress count"],
  [/\d+번째를? 계산/, "per-condition progress position"],
  [/어려운 조건/, "condition difficulty (timing hint)"],
  [/난이도/, "condition difficulty (timing hint)"],
  [/더 필요할까|몇 명이 더 필요/, "presupposes Study 3 direction"],
  [/결과 열람 전 조사|결과를 열기 전/, "wrong: Study 1 was opened on 10-24"],
  [/핵심 일정 \d+개/, "hard-coded task count"],
];
const pub = JSON.stringify(P);
for (const [re, why] of FORBIDDEN) {
  const g = new RegExp(re.source, "g");
  const a = (pub.match(g) || []).length, b = (llms.match(g) || []).length;
  if (a || b) err(`forbidden "${re.source}" (${why}): progress.json ${a}, llms.txt ${b}`);
}

const R = P.run || {};
if (R.done != null && R.total != null) {
  if (!(R.done >= 0 && R.done <= R.total)) err(`run.done ${R.done} not within 0..${R.total}`);
  const pct = (Math.floor((R.done / R.total) * 1000) / 10).toFixed(1);
  const { log, ...rest } = P;
  const shown = [...new Set((JSON.stringify(rest).match(/약 \d+\.\d %/g) || []))];
  for (const s of shown) if (s !== `약 ${pct} %`) err(`"${s}" outside the log does not match run (${pct} %)`);
  if (!shown.length && R.state === "running") warn("no progress figure shown outside the log");
  if (R.at && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(R.at)) err("run.at is not an ISO date-time");
  if (R.eta && !ISO.test(R.eta)) err("run.eta is not YYYY-MM-DD");
} else err("run.done / run.total missing");

const flowNode = (P.flow?.lanes || []).flatMap((l) => l.nodes || []).find((n) => n.t === "새 표본 계산");
const easyStep = (P.easy?.steps || []).find((s) => s.t === "본 계산");
if (flowNode && easyStep && flowNode.s !== easyStep.s) err(`flow "새 표본 계산" is ${flowNode.s} but easy "본 계산" is ${easyStep.s}`);
if (R.state === "running" && flowNode && flowNode.s !== "now") err("run is running but the flow node is not now");

const notice = llms.match(/## 최신 공지 \((\d{4}-\d{2}-\d{2})/);
if (!notice) warn("llms.txt has no 최신 공지 heading");
else if (notice[1] !== P.updated) warn(`llms.txt 최신 공지 ${notice[1]} != updated ${P.updated}`);

try {
  const st = execFileSync("git", ["status", "--porcelain", "--", "freeze"], { encoding: "utf8" });
  const changed = st.split("\n").filter((l) => l && !l.startsWith("??") && !l.startsWith("A "));
  if (changed.length) err("freeze/ files modified or deleted: " + changed.join("; "));
} catch { warn("git not available: freeze/ not checked"); }

for (const w of warns) console.log("warn  " + w);
for (const e of errors) console.log("ERROR " + e);
console.log(errors.length ? `check: ${errors.length} error(s)` : `check: ok (${warns.length} warning(s))`);
process.exit(errors.length ? 1 : 0);
