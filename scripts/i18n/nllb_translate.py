#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────
# Service de traduction LOCAL NLLB-200 — appelé par translate-draft.mjs.
# ─────────────────────────────────────────────────────────────
import json
import sys
import io
import traceback

# 🛠️ CORRECTION WINDOWS : Forcer l'encodage UTF-8 de la sortie standard
# pour éviter les erreurs 'charmap' avec les caractères africains (ɔ, ɛ, etc.)
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def main():
    try:
        req = json.load(sys.stdin)
        model_id = req.get("model", "facebook/nllb-200-distilled-600M")
        tgt = req["tgt_lang"]
        src = req.get("src_lang", "fra_Latn")
        texts = req["texts"]
        
        print(f"  [nllb] chargement {model_id}…", file=sys.stderr, flush=True)
        
        import torch
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
        
        tok = AutoTokenizer.from_pretrained(model_id)
        # 🛠️ FORCER LE CPU pour éviter les conflits de mémoire GPU/CPU sous Windows
        model = AutoModelForSeq2SeqLM.from_pretrained(model_id).to("cpu")
        model.eval()
        
        tok.src_lang = src
        bos = tok.convert_tokens_to_ids(tgt)
        out = []
        batch = 16  # Taille de lot. Si plantage mémoire, réduire à 8.
        
        for i in range(0, len(texts), batch):
            chunk = texts[i:i + batch]
            enc = tok(chunk, return_tensors="pt", padding=True, truncation=True, max_length=200)
            with torch.no_grad():
                gen = model.generate(**enc, forced_bos_token_id=bos, max_length=200, num_beams=2)
            out.extend(tok.batch_decode(gen, skip_special_tokens=True))
            print(f"  [nllb] {min(i + batch, len(texts))}/{len(texts)}", file=sys.stderr, flush=True)
            
        json.dump(out, sys.stdout, ensure_ascii=False)
        
    except Exception as e:
        # 🛠️ AFFICHER L'ERREUR RÉELLE pour le débogage en cas de plantage
        print(f"\n[nllb] ERREUR FATALE: {e}", file=sys.stderr, flush=True)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()