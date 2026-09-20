"""Reproduce the pinned Bitext sample. Python standard library only."""
import csv, hashlib, io, json, random, urllib.request
from pathlib import Path
root = Path(__file__).resolve().parents[1]
source = json.loads((root / 'data/source.json').read_text())
url = 'https://huggingface.co/datasets/' + source['dataset'] + '/resolve/' + source['revision'] + '/Bitext_Sample_Customer_Support_Training_Dataset_27K_responses-v11.csv'
raw = urllib.request.urlopen(url, timeout=60).read()
assert hashlib.sha256(raw).hexdigest() == source['sha256'], 'Source changed'
rows = list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))))
rng = random.Random(42)
selected = []
for intent in sorted({r['intent'] for r in rows}):
    pool = [(i, r) for i, r in enumerate(rows) if r['intent'] == intent]
    rng.shuffle(pool)
    for n, (i, row) in enumerate(pool[:20]):
        selected.append(dict(id=f'bitext-{i+1}', text=row['instruction'], intent=intent, category=row['category'], split='dev' if n < 10 else 'test'))
(root / 'data/samples.json').write_text(json.dumps(selected, ensure_ascii=False, indent=2))
print('Saved', len(selected), 'examples')
