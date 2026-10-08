"""Validation OOXML + concordance instantané L9 ; aucun rendu ou signature vérifié."""
import json
import posixpath
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree as ET
from zipfile import ZipFile
ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = ROOT / 'docs/validation/L9'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
snapshot = json.loads((DIRECTORY / 'snapshot.json').read_text())
def check(ok, message):
    if not ok:
        raise ValueError(message)
with ZipFile(DIRECTORY / 'Dossier_Clinique_L9.docx') as archive:
    check(archive.testzip() is None, 'ZIP endommagé')
    names = set(archive.namelist())
    for required in ('[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml'):
        check(required in names, 'Partie absente : '+required)
    parts = {n: ET.fromstring(archive.read(n)) for n in names if n.endswith(('.xml', '.rels'))}
    for name, relations in parts.items():
        if not name.endswith('.rels'):
            continue
        base = '' if name == '_rels/.rels' else posixpath.dirname(posixpath.dirname(name))
        for relation in relations:
            if relation.get('TargetMode') == 'External':
                continue
            target = posixpath.normpath(posixpath.join(base, unquote(relation.get('Target', '')))).lstrip('/')
            check(target in names, 'Relation absente : '+target)
    document = parts['word/document.xml']
    texts = [''.join(p.itertext()) for p in document.iter(W+'p')]
    expected = [snapshot['sourceSnapshotSha256']]
    expected += [x for s in snapshot['sources'] for x in (s['path'], s['sha256'])]
    expected += [x for f in snapshot['triage'] for q in f['questions'] for x in (q['key'],q['label']['fr'],q['label']['en'],q['severity'])]
    expected += [x for d in snapshot['pev'] for x in (d['code'], str(d['ageOffsetDays']), f"{d['label']['fr']} / {d['label']['en']}")]
    expected += [x for c in snapshot['maternity']['contacts'] for x in (str(c['contactNumber']),str(c['weeks']),c['objective']['fr'],c['objective']['en'])]
    expected += [x for p in snapshot['phrasebook'] for x in (p['key'],p['category'],p['text']['FR'],p['text']['EN'])]
    expected += [json.dumps(value, ensure_ascii=False, separators=(',', ':')) for entry in snapshot['posologyExamples'] for value in (entry['input'], entry['parsed'])]
    expected += [x for t in snapshot['clinicalTexts'] for x in (t['key'],t['fr'],t['en'])]
    for fragment in expected:
        check(str(fragment) in texts, 'Source absente du DOCX : '+str(fragment)[:90])
    for source in ('apps/api/src/modules/prescriptions/prescriptions.rules.ts', 'packages/shared/src/posology.ts'):
        for line in (ROOT/source).read_text().splitlines():
            check(line in texts, 'Règle prescription/posologie absente')
    page = document.find('.//'+W+'pgSz')
    check(page.get(W+'w') == '11906' and page.get(W+'h') == '16838', 'Format A4 invalide')
    for table in document.iter(W+'tbl'):
        widths = [int(col.get(W+'w')) for col in table.find(W+'tblGrid')]
        check(sum(widths) == 9026, 'Largeur tableau invalide')
        for row in table.findall(W+'tr'):
            cells = row.findall(W+'tc')
            check(len(cells)==len(widths), 'Cellules incohérentes')
            for cell, width in zip(cells,widths):
                declared = cell.find(W+'tcPr').find(W+'tcW')
                check(declared.get(W+'type')=='dxa' and int(declared.get(W+'w'))==width,'Largeur cellule invalide')
    check(any('Conforme audit' in ''.join(part.itertext()) for name,part in parts.items() if name.startswith('word/footer')), 'Footer absent')
print('DOCX L9 valide : ZIP/XML/relations/A4/tableaux et textes des sources concordants. Rendu et signature humaine non vérifiés.')
