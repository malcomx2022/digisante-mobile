"""Contrôles OOXML et formulaires vierges L9 ; ni rendu ni avis humain attesté."""

import json
import posixpath
import re
import sys
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs/validation/L9/campaign-2026-10-14"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
CLINICAL_SCOPES = ("triage", "pev", "maternity", "phrasebook", "prescriptions", "vitals", "education")
LANGUAGES = {"fon": "Fɔ̀ngbè", "yor": "Yorùbá"}
DECISIONS = "☐ Favorable sur cette portée  ☐ À corriger  ☐ Défavorable  ☐ Hors compétence"


def check(condition, message):
    if not condition:
        raise ValueError(message)


def text_content(element):
    return "".join(node.text or "" for node in element.iter(W + "t"))


def clean_markdown(value):
    value = re.sub(r"!?\[([^\]]*)\]\(([^)]+)\)", r"\1 (\2)", value)
    return value.replace("**", "").replace("`", "")


def markdown_fragments(markdown):
    code = False
    for line in markdown.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if re.match(r"^\s*```", line):
            code = not code
            continue
        if not line.strip():
            continue
        if code:
            yield line
        elif re.match(r"^\s*\|", line):
            if re.fullmatch(r"\s*\|[\s:|\-]+\|?\s*", line):
                continue
            content = line.strip().removeprefix("|").removesuffix("|")
            for cell in re.split(r"(?<!\\)\|", content):
                yield clean_markdown(cell.strip().replace(r"\|", "|"))
        else:
            line = re.sub(r"^#{1,6}\s+", "", line)
            yield clean_markdown(re.sub(r"^\s*>\s?", "", line))


def inspect_document(file_name, campaign):
    with ZipFile(DIRECTORY / file_name) as archive:
        check(archive.testzip() is None, f"{file_name} : archive ZIP endommagée")
        names = set(archive.namelist())
        check(len(names) == len(archive.namelist()), f"{file_name} : parties ZIP dupliquées")
        for required in ("[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml"):
            check(required in names, f"{file_name} : partie OOXML absente : {required}")
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
                check(resolved in names, f"{file_name} : relation introuvable : {resolved}")
        document = parts["word/document.xml"]
        texts = [text_content(paragraph) for paragraph in document.iter(W + "p")]
        joined = "\n".join(texts)
        check(f"source_snapshot : {campaign['sourceSnapshotSha256']}" in texts, f"{file_name} : source_snapshot divergent")
        check(f"Commit de base : {campaign['baseCommitSha']}" in texts, f"{file_name} : commit de base divergent")
        check("FORMULAIRE VIERGE — NON SIGNÉ — À RENSEIGNER EN PRIVÉ" in texts, f"{file_name} : état vierge absent")
        check(not any(mark in joined for mark in ("☑", "☒", "✅")), f"{file_name} : case ou approbation présélectionnée")
        check("Conserver les avis complétés, signatures et coordonnées dans un espace privé contrôlé par le porteur. Ne pas les ajouter au dépôt public." in texts, f"{file_name} : consigne de confidentialité absente")
        sections = document.findall(".//" + W + "sectPr")
        check(len(sections) == 1, f"{file_name} : section inattendue")
        page = sections[0].find(W + "pgSz")
        check(page is not None and page.get(W + "w") == "11906" and page.get(W + "h") == "16838", f"{file_name} : format A4 invalide")
        margins = sections[0].find(W + "pgMar")
        check(margins is not None and all(margins.get(W + side) == "1440" for side in ("top", "bottom", "left", "right")), f"{file_name} : marges A4 invalides")
        blank_fields = []
        for table in document.iter(W + "tbl"):
            grid = table.find(W + "tblGrid")
            check(grid is not None, f"{file_name} : grille de tableau absente")
            widths = [int(column.get(W + "w")) for column in grid]
            check(sum(widths) == 9026, f"{file_name} : largeur de tableau invalide")
            for row in table.findall(W + "tr"):
                cells = row.findall(W + "tc")
                check(len(cells) == len(widths), f"{file_name} : nombre de cellules incohérent")
                for cell, width in zip(cells, widths):
                    properties = cell.find(W + "tcPr")
                    declared = None if properties is None else properties.find(W + "tcW")
                    check(declared is not None and declared.get(W + "type") == "dxa" and int(declared.get(W + "w")) == width, f"{file_name} : largeur de cellule invalide")
                if file_name.startswith("Avis_"):
                    check(len(cells) == 2, f"{file_name} : formulaire à deux colonnes requis")
                    label, value = (text_content(cell) for cell in cells)
                    check(value == "", f"{file_name} : champ d'avis prérempli : {label}")
                    blank_fields.append(label)
        check(any("NON SIGNÉ" in text_content(part) for name, part in parts.items() if name.startswith("word/footer")), f"{file_name} : pied de page NON SIGNÉ absent")
        check(not document.findall(".//" + W + "ins") and not document.findall(".//" + W + "del"), f"{file_name} : révision suivie inattendue")
        if file_name.startswith("Avis_Linguistique_"):
            paragraphs = list(document.iter(W + "p"))
            for index, element in enumerate(paragraphs):
                if text_content(element) != "Avis indépendant du relecteur 2":
                    continue
                properties = element.find(W + "pPr")
                page_break = None if properties is None else properties.find(W + "pageBreakBefore")
                check(page_break is not None and page_break.get(W + "val") not in ("false", "0", "off"), f"{file_name} : relecteur 2 doit commencer sur une nouvelle page")
                check(index + 2 < len(paragraphs) and text_content(paragraphs[index + 1]).startswith("Langue / portée : ") and text_content(paragraphs[index + 2]).startswith("Empreinte de portée : "), f"{file_name} : version à rappeler sur la page du relecteur 2")
        return texts, blank_fields


def main():
    campaign = json.loads((DIRECTORY / "campaign.json").read_text(encoding="utf-8"))
    check(campaign.get("schemaVersion") == 1 and campaign.get("status") == "PREPARED_FOR_REVIEW", "État de campagne invalide")
    check(re.fullmatch(r"[a-f0-9]{64}", campaign.get("sourceSnapshotSha256", "")), "Empreinte source invalide")
    check(re.fullmatch(r"[a-f0-9]{40}", campaign.get("baseCommitSha", "")), "Commit de base invalide")
    scopes = campaign.get("scopes", [])
    check(len(scopes) == 7 and {entry["scope"] for entry in scopes} == set(CLINICAL_SCOPES), "Sept portées cliniques distinctes requises")
    native_scopes = campaign.get("nativeScopes", [])
    check(len(native_scopes) == 4 and {(entry["locale"], entry["scope"]) for entry in native_scopes} == {(locale, scope) for locale in LANGUAGES for scope in ("ui", "phrasebook-native")}, "Quatre portées natives distinctes requises")
    for entry in [*scopes, *native_scopes]:
        check(re.fullmatch(r"[a-f0-9]{64}", entry.get("contentSha256", "")), "Empreinte de portée invalide")

    guide, _ = inspect_document("Guide_Relecteurs_L9.docx", campaign)
    guide_joined = "\n".join(guide)
    for fragment in markdown_fragments((DIRECTORY / "README.md").read_text(encoding="utf-8")):
        check(fragment in guide, "Guide : contenu du README absent : " + fragment[:100])
    for fragment in ("Parcours de relecture en huit étapes", "Exercices de compréhension, oral et affichage", "fr-FR", "Double relecture", "source-questions.csv", "clinical-cases.csv"):
        check(fragment in guide_joined, "Guide : consigne essentielle absente : " + fragment)
    for number in range(1, 9):
        check(any(text.startswith(f"{number}. ") for text in guide), f"Guide : étape {number} absente")

    clinical, clinical_fields = inspect_document("Avis_Clinique_L9.docx", campaign)
    for entry in scopes:
        check(any(text.endswith("portée " + entry["scope"]) for text in clinical), "Avis clinique : portée absente : " + entry["scope"])
        check("Empreinte de portée : " + entry["contentSha256"] in clinical, "Avis clinique : empreinte absente : " + entry["scope"])
        check("Profil de relecture proposé : " + entry["professionalProfile"] in clinical, "Avis clinique : profil absent : " + entry["scope"])
    for reserve in campaign.get("reserves", []):
        if reserve["scope"] in CLINICAL_SCOPES:
            check(f"Réserve {reserve['id']} : {reserve['summary']}" in clinical, "Avis clinique : réserve absente : " + reserve["id"])
    check(clinical.count(DECISIONS) == 7, "Avis clinique : sept décisions vierges requises")
    for label in ("Nom et prénom du professionnel", "Qualité / capacité professionnelle", "Date de l’avis (AAAA-MM-JJ)", "Signature manuscrite ou signature vérifiable", "Corrections exactes demandées"):
        check(clinical_fields.count(label) == 7, "Avis clinique : champ manquant : " + label)
    check(clinical_fields.count("runtimeInventoryRef / version de l’inventaire publié") == 1, "Avis clinique : inventaire éducatif publié absent")

    for locale, language in LANGUAGES.items():
        file_name = f"Avis_Linguistique_{locale.upper()}_L9.docx"
        native, native_fields = inspect_document(file_name, campaign)
        check(any(f"{language} ({locale})" in text for text in native), "Avis natif : langue exacte absente : " + locale)
        for entry in native_scopes:
            if entry["locale"] != locale:
                continue
            check(native.count(f"Langue / portée : {locale} / {entry['scope']}") == 2, "Avis natif : portée à rappeler pour chaque relecteur")
            check(native.count("Empreinte de portée : " + entry["contentSha256"]) == 2, "Avis natif : empreinte à rappeler pour chaque relecteur")
        check(native.count(DECISIONS) == 4, "Avis natif : quatre décisions indépendantes vierges requises")
        for number in (1, 2):
            check(native.count(f"Avis indépendant du relecteur {number}") == 2, f"Avis natif : deux avis du relecteur {number} requis")
            check(native_fields.count(f"Nom et prénom du relecteur {number}") == 2, f"Avis natif : identité du relecteur {number} manquante")
        for label in ("Date de l’avis (AAAA-MM-JJ)", "Signature manuscrite ou signature vérifiable", "Compréhension : exercices, observations, réserves", "Oral : appareils, voix, observations, réserves", "Affichage : caractères, variables, observations, réserves"):
            check(native_fields.count(label) == 4, "Avis natif : champ manquant : " + label)
        check(native_fields.count("Arbitrage motivé et personnes consultées") == 2, "Avis natif : arbitrage absent")

    print("Kit DOCX L9 valide : quatre documents, ZIP/XML/relations/A4/tableaux, concordance des empreintes et formulaires vierges.")
    print("Rendu Word/LibreOffice, compréhension, signatures et habilitations humaines non contrôlés.")


if __name__ == "__main__":
    main()
