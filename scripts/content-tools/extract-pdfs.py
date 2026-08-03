#!/usr/bin/env python3
"""
extract-pdfs.py — generalized PDF extractor for the content kit.

Classifies PDFs inside a module/level source folder into:
  - course PDFs  -> pdftotext dumps under <out>/U0N/course/*.txt   (become LESSON sources)
  - exercise PDFs -> pdftotext dumps under <out>/U0N/exercise/*.txt (become EXERCISE/quiz sources)
Writes an inventory.json per unit + an exercises-manifest.json per unit
(the agent edits the manifest and feeds it to insert-exercises-from-manifest.js).

Usage:
  python3 extract-pdfs.py \
      --pdf-base /home/o/websites/E-learning/math/3eme \
      --out /tmp/opencode/math3 \
      --unit-map config/math-3eme-unitmap.json \
      --prefix 3AS-M

  unit-map.json = {"unit 1 <title>": {"id": 9, "category_id": 3}, ...}
  (unit ids come from seed-units.js; see config/<module>-<level>-resolved.json)
"""
import argparse
import json
import os
import re
import subprocess
from pathlib import Path

CONTROL_CHARS = re.compile(r'[\u2000-\u200f\u2028-\u202f\u2060-\u2069\u200b]')
MULTI_NL = re.compile(r'\n{3,}')

def extract_text(pdf_path, timeout=60):
    try:
        res = subprocess.run(['pdftotext', str(pdf_path), '-'],
                             capture_output=True, text=True, timeout=timeout)
        if res.returncode != 0 or not res.stdout.strip():
            return None
        text = CONTROL_CHARS.sub('', res.stdout)
        text = MULTI_NL.sub('\n\n', text)
        return text.strip()
    except Exception:
        return None

def is_exercise(filename):
    if filename.endswith('تمرين.pdf') or filename.endswith('تمرين.PDF'):
        return True
    if filename.endswith('.pdf') and re.search(r'[Ee]xercice', filename):
        return True
    if filename.endswith('.pdf') and 'تمارين' in filename:
        return True
    return False

def has_solution(filename):
    return '-R' in filename or 'حل' in filename or 'تصحيح' in filename

def parse_exercise_num(filename):
    m = re.search(r'[Ee]xercice\s*(\d+[A-Za-z]?)', filename)
    if m:
        return m.group(1)
    m = re.search(r'(\d+)\s*[-–]\s*تمرين', filename)
    if m:
        return m.group(1)
    return None

def parse_order(filename):
    n = parse_exercise_num(filename)
    if n:
        m = re.search(r'(\d+)', n)
        return int(m.group(1)) if m else 0
    m = re.search(r'-\s*(\d{1,2})\s*-', filename)
    return int(m.group(1)) if m else 0

def safe_stem(name):
    return re.sub(r'[^\w\u0600-\u06FF-]+', '_', name)

def build_content_blocks(text):
    blocks = []
    lines = text.split('\n')
    current = []
    for line in lines:
        s = line.strip()
        if not s:
            if current:
                combined = '\n'.join(current)
                blocks.append({"type": "text", "content": combined})
                current = []
            continue
        current.append(s)
    if current:
        blocks.append({"type": "text", "content": '\n'.join(current)})
    return {"sections": blocks or [{"type": "text", "content": text[:1000]}]}

def main():
    ap = argparse.ArgumentParser(description='Classify + extract PDFs for the content kit')
    ap.add_argument('--pdf-base', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--unit-map', required=True, help='JSON: {"<unit dir>": {"id": N, "category_id": N}}')
    ap.add_argument('--prefix', default='3AS', help='source prefix, e.g. 3AS or 3AS-M')
    args = ap.parse_args()

    with open(args.unit_map, encoding='utf-8') as f:
        unit_map = json.load(f)

    pdf_base = Path(args.pdf_base)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    total_ex, total_course = 0, 0
    for unit_dir in sorted(os.listdir(pdf_base)):
        unit_path = pdf_base / unit_dir
        if not unit_path.is_dir():
            continue
        if not (unit_dir.startswith('unit') or re.match(r'^U\d+', unit_dir)):
            continue
        info = unit_map.get(unit_dir)
        if not info:
            print(f'!! Unknown unit dir (not in unit-map): {unit_dir}')
            continue
        uid = info['id']
        uout = out / f'U{uid:02d}'
        (uout / 'course').mkdir(parents=True, exist_ok=True)
        (uout / 'exercise').mkdir(parents=True, exist_ok=True)

        exercises, courses = [], []
        for root, _, files in os.walk(unit_path):
            for f in files:
                if not f.lower().endswith('.pdf'):
                    continue
                p = Path(root) / f
                if is_exercise(f):
                    exercises.append(p)
                else:
                    courses.append(p)

        exercise_manifest = []
        for p in sorted(exercises):
            num = parse_exercise_num(p.name)
            txt = extract_text(p)
            rel = f'U{uid:02d}/exercise/{safe_stem(p.stem)}.txt'
            if txt:
                (uout / 'exercise' / f'{safe_stem(p.stem)}.txt').write_text(txt, encoding='utf-8')
            else:
                print(f'  !! no text: {p.name} (scanned/password?)')
            entry = {
                "file": f'../../exercises/U{uid:02d}/{num or "NA"}-exercice.json',
                "unit_id": uid,
                "source_pdf": str(p.relative_to(pdf_base)),
                "exercise_num": num,
                "has_solution": has_solution(p.name),
                "order_index": parse_order(p.name),
                "suggested_title": f'تمرين {num} - {safe_stem(p.stem)[:60]}',
                "text_dump": rel,
            }
            exercise_manifest.append(entry)
            total_ex += 1

        course_manifest = []
        for p in sorted(courses):
            txt = extract_text(p)
            rel = f'U{uid:02d}/course/{safe_stem(p.stem)}.txt'
            if txt:
                (uout / 'course' / f'{safe_stem(p.stem)}.txt').write_text(txt, encoding='utf-8')
            else:
                print(f'  !! no text: {p.name}')
            course_manifest.append({
                "source_pdf": str(p.relative_to(pdf_base)),
                "text_dump": rel,
                "order_hint": parse_order(p.name),
            })
            total_course += 1

        (uout / 'inventory.json').write_text(
            json.dumps({"unit_id": uid, "unit_dir": unit_dir, "category_id": info["category_id"],
                        "courses": course_manifest, "exercises": exercise_manifest},
                       ensure_ascii=False, indent=2), encoding='utf-8')

        print(f'\n{unit_dir} (unit id {uid})')
        print(f'  course: {len(courses)}  exercises: {len(exercises)}')
        print(f'  -> {uout}')

    print(f'\n{"=" * 50}')
    print(f'Total course PDFs: {total_course}')
    print(f'Total exercise PDFs: {total_ex}')
    print(f'Output: {out}')
    print('Next: author lessons/exercises from the dumps, then lint-content.js, then sync scripts.')

if __name__ == '__main__':
    main()
