"""Contrôle structurel du DOCX généré ; aucun contrôle de rendu ni signature."""

import posixpath
import re
import sys
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/PLAN_Implementations_Restantes_2026-10.md"
DOCX = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs/Plan_Implementations_Restantes_2026-10.docx"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def check(condition, message):
    if not condition:
        raise ValueError(message)


def clean(text):
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    return text.replace("**", "").replace("`", "")


with ZipFile(DOCX) as archive:
    check(archive.testzip() is None, "Archive ZIP endommagée")
    names = set(archive.namelist())
    for required in ("[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml"):
        check(required in names, f"Partie OOXML absente : {required}")
    parts = {name: ET.fromstring(archive.read(name)) for name in names if name.endswith((".xml", ".rels"))}
    for name, relationships in parts.items():
        if not name.endswith(".rels"):
            continue
        base = "" if name == "_rels/.rels" else posixpath.dirname(posixpath.dirname(name))
        for relation in relationships:
            if relation.get("TargetMode") == "External":
                continue
            target = unquote(relation.get("Target", ""))
            resolved = posixpath.normpath(posixpath.join(base, target)).lstrip("/")
            check(resolved in names, f"Relation introuvable : {name} → {resolved}")

    document = parts["word/document.xml"]
    texts = ["".join(p.itertext()) for p in document.iter(W + "p")]
    for line in SOURCE.read_text().splitlines():
        if not line.strip() or line.startswith(("# ", "```")):
            continue
        if line.startswith("|"):
            if re.fullmatch(r"\|[\s:|\-]+\|", line):
                continue
            expected = [clean(cell.strip()) for cell in line[1:-1].split("|")]
        else:
            expected = [clean(re.sub(r"^(?:###? |>|- )", "", line).lstrip())]
        for fragment in expected:
            check(fragment in texts, f"Contenu source absent : {fragment[:100]}")

    sections = document.findall(".//" + W + "sectPr")
    check(len(sections) == 1, "Section DOCX inattendue")
    page = sections[0].find(W + "pgSz")
    check(page.get(W + "w") == "11906" and page.get(W + "h") == "16838", "Format A4 invalide")
    for table in document.iter(W + "tbl"):
        grid = table.find(W + "tblGrid")
        widths = [int(column.get(W + "w")) for column in grid]
        check(sum(widths) == 9026, "Largeur de tableau incohérente")
        for row in table.findall(W + "tr"):
            cells = row.findall(W + "tc")
            check(len(cells) == len(widths), "Nombre de cellules incohérent")
            for cell, width in zip(cells, widths):
                declared = cell.find(W + "tcPr").find(W + "tcW")
                check(declared.get(W + "type") == "dxa" and int(declared.get(W + "w")) == width, "Largeur cellule incohérente")
    check(any("Conforme audit" in "".join(part.itertext()) for name, part in parts.items() if name.startswith("word/footer")), "Pied de page absent")

print(f"DOCX validé : ZIP, XML, relations, A4, tableaux et concordance source ({DOCX.name}).")
print("Limite : rendu Word/LibreOffice et validation humaine non contrôlés.")
