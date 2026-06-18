#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────
# Service de traduction LOCAL NLLB-200 — appelé par translate-draft.mjs.
# Lit une requête JSON sur stdin, écrit un tableau JSON de traductions sur stdout.
# (NLLB n'est plus servi par l'API serverless HuggingFace → exécution locale.)
#
#   echo '{"tgt_lang":"fon_Latn","texts":["Bonjour"]}' | python3 nllb_translate.py
#
# Dépendances (dev) : pip install transformers torch sentencepiece
# La progression est émise sur stderr ; seul le résultat JSON va sur stdout.
# ─────────────────────────────────────────────────────────────
import json
import sys

import torch
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer


def main():
    req = json.load(sys.stdin)
    model_id = req.get("model", "facebook/nllb-200-distilled-600M")
    tgt = req["tgt_lang"]
    src = req.get("src_lang", "fra_Latn")
    texts = req["texts"]

    print(f"  [nllb] chargement {model_id}…", file=sys.stderr, flush=True)
    tok = AutoTokenizer.from_pretrained(model_id)
    model = AutoModelForSeq2SeqLM.from_pretrained(model_id)
    model.eval()
    tok.src_lang = src
    bos = tok.convert_tokens_to_ids(tgt)

    out = []
    batch = 16
    for i in range(0, len(texts), batch):
        chunk = texts[i:i + batch]
        enc = tok(chunk, return_tensors="pt", padding=True, truncation=True, max_length=200)
        with torch.no_grad():
            gen = model.generate(**enc, forced_bos_token_id=bos, max_length=200, num_beams=2)
        out.extend(tok.batch_decode(gen, skip_special_tokens=True))
        print(f"  [nllb] {min(i + batch, len(texts))}/{len(texts)}", file=sys.stderr, flush=True)

    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
