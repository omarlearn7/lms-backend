#!/usr/bin/env node
/**
 * lint-content.js — structural + format validation for authored content JSON.
 *
 * Checks lessons (top-level `sections`) and exercises/quizzes (`content_json.sections`)
 * against the schemas in CONTENT_PLAYBOOK.md, including the format bugs:
 *   - HTML leaks in note/heading/table cells
 *   - odd KaTeX `$` counts
 *   - decimal commas in questions/numeric answers
 *   - mcq answer not in options
 *   - sim conventions (no setInterval/setTimeout, playBtn, rAF, fit guard)
 *
 * Usage:
 *   node scripts/content-tools/lint-content.js <file.json|dir> ...
 * Exit code 1 if any errors.
 */
const fs = require('fs');
const path = require('path');

const KNOWN_TYPES = new Set(['heading', 'text', 'formula', 'note', 'divider', 'table', 'image', 'code', 'diagram', 'question', 'quiz', 'simulation', 'artifact']);
const KNOWN_INPUT = new Set(['mcq', 'numeric', 'number', 'equation', 'formula', 'text', 'progress_table']);
const KNOWN_LABELS = new Set(['سنة أولى ثانوي', 'سنة ثانية ثانوي', 'سنة ثالثة ثانوي', 'سنة رابعة متوسط']);
const LEAK_TAGS = /<(table|tr|td|th|div|span|html|body|head|script|style)\b/i;
const COMMA_NUM = /[\u066B\u066C]\s*\d|\d\s*[,،]\s*\d/;
const ALLOWED_SIM_KEYS = new Set(['type', 'title', 'html', 'css', 'js', 'config', 'kind', 'width']);

const errors = [];
const warnings = [];
let checked = 0;

function err(f, m) { errors.push(`${f}: ${m}`); }
function warn(f, m) { warnings.push(`${f}: ${m}`); }

function countDollar(s) {
  return s ? (s.split('$').length - 1) : 0;
}

function checkDollars(file, s, where) {
  if (s && countDollar(s) % 2 === 1) err(file, `odd number of '$' in ${where} (KaTeX split breaks)`);
}

function checkLeak(file, s, where) {
  if (s && LEAK_TAGS.test(s)) err(file, `suspicious HTML in ${where}: "${s.match(LEAK_TAGS)[0]}" (plain text expected)`);
}

function checkComma(file, s, where) {
  if (s && COMMA_NUM.test(s)) warn(file, `possible decimal comma in ${where}: "${s.match(COMMA_NUM)[0]}" — use dot`);
}

function checkTextLike(file, s, where) {
  checkDollars(file, s, where);
  checkLeak(file, s, where);
  checkComma(file, s, where);
}

function checkSim(file, block) {
  for (const k of ['html', 'css', 'js']) {
    if (typeof block[k] !== 'string' || !block[k].trim()) err(file, `simulation missing "${k}"`);
  }
  const cfg = block.config || {};
  if (!cfg.title) warn(file, 'simulation missing config.title');
  if (typeof block.html === 'string' && /setInterval|setTimeout\s*\(/.test(block.html)) err(file, 'simulation html uses setInterval/setTimeout (use rAF)');
  if (typeof block.css === 'string' && /setInterval|setTimeout\s*\(/.test(block.css)) err(file, 'simulation css uses setInterval/setTimeout');
  if (typeof block.js === 'string') {
    if (/setInterval|setTimeout\s*\(/.test(block.js)) err(file, 'simulation js uses setInterval/setTimeout (use rAF)');
    const playIds = ['playBtn', 'playSM', 'playLC', 'playTimeBtn'];
    if (!playIds.some((id) => block.js.includes(id))) warn(file, 'simulation js has no play-control id reference (use playBtn/playSM/playLC/playTimeBtn)');
    if (!block.js.includes('requestAnimationFrame') && !block.html.includes('requestAnimationFrame')) warn(file, 'simulation: no requestAnimationFrame found');
    if (!block.js.includes('__fitInstalled__')) warn(file, 'simulation: missing __fitInstalled__ HiDPI fit() guard');
  }
  for (const k of Object.keys(block)) if (!ALLOWED_SIM_KEYS.has(k)) warn(file, `simulation has unusual key "${k}"`);
}

function checkQuestion(file, q, kind) {
  if (q.number !== undefined && typeof q.number !== 'number' && typeof q.number !== 'string') err(file, `${kind} question number invalid`);
  checkTextLike(file, q.text, `${kind} question ${q.number || ''} text`);
  const it = q.input_type;
  if (it && !KNOWN_INPUT.has(it)) err(file, `${kind} question ${q.number || ''}: unknown input_type "${it}"`);
  const ans = q.answer;
  if (ans === undefined || ans === null || ans === '') err(file, `${kind} question ${q.number || ''}: missing answer`);

  if (it === 'mcq') {
    const opts = Array.isArray(q.options) ? q.options : [];
    if (opts.length < 2) err(file, `${kind} question ${q.number || ''}: mcq needs >=2 options`);
    const value = ans && typeof ans === 'object' ? ans.value : ans;
    if (value !== undefined && value !== '' && !opts.includes(value)) err(file, `${kind} question ${q.number || ''}: answer.value not among options`);
  } else if (it === 'numeric' || it === 'number') {
    const value = ans && typeof ans === 'object' ? ans.value : ans;
    if (typeof value === 'string') {
      if (/[,\u066B]/.test(value)) err(file, `${kind} question ${q.number || ''}: numeric answer uses a comma`);
      if (isNaN(parseFloat(value))) err(file, `${kind} question ${q.number || ''}: numeric answer not parseable`);
    } else if (typeof value !== 'number') {
      err(file, `${kind} question ${q.number || ''}: numeric answer.value must be a number`);
    }
    if (ans && typeof ans === 'object' && ans.tolerance !== undefined && typeof ans.tolerance !== 'number') err(file, `${kind} question ${q.number || ''}: tolerance must be a number`);
  } else if (it === 'equation' || it === 'formula') {
    if (typeof ans !== 'string' && !Array.isArray(ans)) err(file, `${kind} question ${q.number || ''}: equation answer must be a string or array of accepted forms`);
  }
  if (q.solution) checkTextLike(file, q.solution, `${kind} question ${q.number || ''} solution`);
}

function checkBlock(file, b) {
  if (!b || typeof b !== 'object') { err(file, 'block is not an object'); return; }
  if (!KNOWN_TYPES.has(b.type)) { err(file, `unknown block type "${b.type}" (renderer drops unknown types)`); return; }
  switch (b.type) {
    case 'heading':
      if (!b.text) err(file, 'heading missing text');
      checkTextLike(file, b.text, 'heading');
      break;
    case 'text':
      if (!b.content) warn(file, 'text block empty');
      checkTextLike(file, b.content, 'text');
      break;
    case 'formula':
      if (!b.latex) err(file, 'formula missing latex');
      break;
    case 'note':
      if (!b.text) err(file, 'note missing text');
      checkLeak(file, b.text, 'note');
      checkDollars(file, b.text, 'note');
      checkComma(file, b.text, 'note');
      if (b.variant && !['info', 'warning', 'tip'].includes(b.variant)) warn(file, `note unknown variant "${b.variant}"`);
      break;
    case 'table':
      if (!Array.isArray(b.headers)) err(file, 'table missing headers array');
      if (!Array.isArray(b.rows)) err(file, 'table missing rows array');
      (b.headers || []).forEach((h, i) => checkTextLike(file, h, `table header ${i}`));
      (b.rows || []).forEach((r, ri) => (Array.isArray(r) ? r : []).forEach((c, ci) => checkTextLike(file, c, `table cell ${ri},${ci}`)));
      break;
    case 'image':
      if (!b.src) err(file, 'image missing src');
      break;
    case 'diagram':
      if (!b.diagram_type && !b.html && !b.src) err(file, 'diagram needs diagram_type, html, or src');
      break;
    case 'code':
      if (!b.code) warn(file, 'code block empty');
      break;
    case 'question':
      checkQuestion(file, b, 'exercise');
      break;
    case 'quiz':
      if (!Array.isArray(b.questions) || b.questions.length === 0) { err(file, 'quiz block has no questions'); break; }
      b.questions.forEach((q, i) => {
        checkTextLike(file, q.q, `quiz q ${i + 1}`);
        if (!Array.isArray(q.options) || q.options.length < 2) err(file, `quiz q ${i + 1}: needs options`);
        if (typeof q.correctIndex !== 'number' || !(q.correctIndex >= 0) || !(q.correctIndex < (q.options || []).length)) err(file, `quiz q ${i + 1}: invalid correctIndex`);
        if (q.explanation) checkTextLike(file, q.explanation, `quiz q ${i + 1} explanation`);
      });
      break;
    case 'simulation':
    case 'artifact':
      checkSim(file, b);
      break;
  }
}

function checkSections(file, sections, kinds) {
  if (!Array.isArray(sections) || sections.length === 0) { err(file, `${kinds.join('/')}: no sections`); return; }
  sections.forEach((b, i) => checkBlock(file, b));
}

function collect(files, out) {
  for (const f of files) {
    const abs = path.resolve(f);
    if (!fs.existsSync(abs)) { err(f, 'not found'); continue; }
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(abs)) {
        if (name === 'node_modules' || name === 'config' || name === 'templates' || name === 'simulations') continue;
        collect([path.join(abs, name)], out);
      }
    } else if (abs.endsWith('.json') && !abs.includes('content-tools/config/') && !abs.includes('node_modules')) {
      out.push(abs);
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) { console.error('Usage: node lint-content.js <file.json|dir> ...'); process.exit(2); }
  const files = [];
  collect(args, files);

  for (const file of files) {
    let obj;
    try {
      obj = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
      err(path.relative(process.cwd(), file), `invalid JSON: ${e.message}`);
      continue;
    }
    checked++;
    const rel = path.relative(process.cwd(), file);

    if (Array.isArray(obj.sections)) {
      // lesson
      const required = ['title', 'description', 'category_id', 'unit_id', 'grade_level', 'order_index', 'is_free'];
      for (const k of required) if (obj[k] === undefined) err(rel, `lesson missing "${k}"`);
      if (obj.slug && obj.slug !== String(obj.title).replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')) warn(rel, `slug may not match title: "${obj.slug}"`);
      if (obj.grade_level && !KNOWN_LABELS.has(obj.grade_level)) warn(rel, `unexpected grade_level label "${obj.grade_level}" (labels: ${[...KNOWN_LABELS].join(' | ')})`);
      checkSections(rel, obj.sections, ['lesson']);
    } else if (obj.content_json && Array.isArray(obj.content_json.sections)) {
      // exercise or quiz
      for (const k of ['unit_id', 'title', 'order_index', 'source']) if (obj[k] === undefined) err(rel, `${k} missing`);
      const isQuiz = /quiz/i.test(obj.title || '') || /quiz/i.test(obj.source || '');
      checkSections(rel, obj.content_json.sections, [isQuiz ? 'quiz' : 'exercise']);
      if (isQuiz) {
        for (const b of obj.content_json.sections) {
          if (!['heading', 'text', 'divider', 'question'].includes(b.type)) err(rel, `quiz section "${b.type}" not allowed (heading/text/divider/question only)`);
        }
      }
    } else {
      err(rel, 'neither lesson (top-level sections) nor exercise/quiz (content_json.sections)');
    }
  }

  console.log(`\nLinted ${checked} file(s)`);
  console.log(`Errors: ${errors.length}`);
  if (errors.length) {
    console.log('\n' + errors.join('\n'));
    process.exit(1);
  }
  if (warnings.length) {
    console.log(`Warnings: ${warnings.length}`);
    console.log('\n' + warnings.join('\n'));
  } else {
    console.log('Warnings: 0 — clean.');
  }
}

main();
