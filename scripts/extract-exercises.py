#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
from pathlib import Path

EXERCISE_JSON_DIR = "/tmp/opencode/exercises-json"
PDF_BASE = "/home/o/websites/E-learning/physics/3eme"

UNIT_MAP = {
    "unit 1 المتابعة الزمنية لتحول كيميائي": {"id": 1, "category_id": 1},
    "unit 2 تطور جملة ميكانيكية": {"id": 2, "category_id": 2},
    "unit 3 دراسة ظواهر كهربائية": {"id": 3, "category_id": 2},
    "unit 4  تطور جملة كيميائية نحو حالة التوازن": {"id": 4, "category_id": 1},
    "unit 5  دراسة تحولات نووية": {"id": 5, "category_id": 2},
    "unit 6 مراقبة تطور جملة كيميائية": {"id": 6, "category_id": 1},
    "unit 7 تطور جملة مهتزة": {"id": 7, "category_id": 2},
    "unit 8 ظواهر الانتشار": {"id": 8, "category_id": 2},
}

def is_exercise_pdf(filename):
    if filename.endswith('تمرين.pdf'):
        return True
    if 'Exercice' in filename and filename.endswith('.pdf'):
        return True
    return False

def has_solution(filename):
    return '-R' in filename

def extract_text(pdf_path):
    try:
        result = subprocess.run(
            ['pdftotext', pdf_path, '-'],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            return None
        text = result.stdout.strip()
        text = re.sub(r'[\u2000-\u200f\u2028-\u202f\u2060-\u2069]', '', text)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text
    except Exception:
        return None

def parse_exercise_num(filename):
    m = re.search(r'[Ee]xercice\s+(\d+[A-Za-z]?)', filename)
    if m:
        return m.group(1)
    m = re.search(r'(\d+)\s*-\s*تمرين', filename)
    if m:
        return m.group(1)
    return None

def parse_title(filename):
    name = Path(filename).stem
    parts = name.split(' - ')
    if len(parts) >= 2 and 'تمرين' in parts[-1]:
        arabic = parts[-1].replace('تمرين', '').strip()
        if arabic:
            return arabic
    for p in reversed(parts):
        if p.strip() and 'Exercice' not in p and 'U0' not in p:
            return p.strip()
    return name

def build_content_blocks(text):
    blocks = []
    lines = text.split('\n')
    current = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            if current:
                combined = '\n'.join(current)
                if len(combined) < 120 and not combined.startswith(('-', '(', '•', '●')):
                    blocks.append({"type": "text", "content": combined})
                else:
                    blocks.append({"type": "text", "content": combined})
                current = []
            continue
        current.append(stripped)
    if current:
        combined = '\n'.join(current)
        blocks.append({"type": "text", "content": combined})
    if not blocks:
        blocks.append({"type": "text", "content": text[:1000]})
    return {"sections": blocks}

def main():
    os.makedirs(EXERCISE_JSON_DIR, exist_ok=True)

    total_exercises = 0
    total_skipped = 0
    errors = 0

    for unit_dir in sorted(os.listdir(PDF_BASE)):
        unit_path = os.path.join(PDF_BASE, unit_dir)
        if not os.path.isdir(unit_path) or not unit_dir.startswith("unit"):
            continue

        unit_info = UNIT_MAP.get(unit_dir)
        if not unit_info:
            print(f"Unknown unit: {unit_dir}, skipping")
            continue

        unit_id = unit_info["id"]
        unit_exercises = []
        unit_skipped = []

        for root, dirs, files in os.walk(unit_path):
            for f in files:
                if not f.endswith('.pdf'):
                    continue
                if is_exercise_pdf(f):
                    unit_exercises.append((root, f))
                else:
                    unit_skipped.append((root, f))

        print(f"\n{unit_dir}")
        print(f"  Exercises: {len(unit_exercises)}, Skipped: {len(unit_skipped)}")

        unit_data = []
        for pdf_dir, filename in unit_exercises:
            pdf_path = os.path.join(pdf_dir, filename)
            ex_num = parse_exercise_num(filename)
            title = parse_title(filename)
            sol = has_solution(filename)
            order = int(re.search(r'(\d+)', ex_num).group(1)) if ex_num else 0

            text = extract_text(pdf_path)
            content = build_content_blocks(text) if text else {"sections": [{"type": "text", "content": ""}]}

            ex_data = {
                "filename": filename,
                "unit_id": unit_id,
                "unit_dir": unit_dir,
                "exercise_num": ex_num,
                "title": title,
                "has_solution": sol,
                "source": filename,
                "order_index": order,
                "content_json": content,
                "pdf_relpath": os.path.relpath(pdf_path, PDF_BASE),
            }
            unit_data.append(ex_data)

            out_filename = f"U{unit_id:02d}_{ex_num or 'NA'}_{order}.json"
            out_path = os.path.join(EXERCISE_JSON_DIR, out_filename)
            with open(out_path, 'w', encoding='utf-8') as f:
                json.dump(ex_data, f, ensure_ascii=False)

        total_exercises += len(unit_exercises)
        total_skipped += len(unit_skipped)

        rel = os.path.join(EXERCISE_JSON_DIR, f"U{unit_id:02d}_manifest.json")
        with open(rel, 'w', encoding='utf-8') as f:
            json.dump(unit_data, f, ensure_ascii=False, indent=2)

    print(f"\n{'='*50}")
    print(f"Total exercises: {total_exercises}")
    print(f"Total skipped (theory/other PDFs): {total_skipped}")
    print(f"Output: {EXERCISE_JSON_DIR}")
    print(f"\nNext: node scripts/insert-exercises.js")

if __name__ == '__main__':
    main()
