#!/usr/bin/env python3
# Tests fonctionnels de fumée — DigiSanté Mobile (API locale + pages web).
# Login OTP par rôle (devCode en dev), lecture des données par espace,
# RBAC négatif, et une délivrance pharmacie réelle. Aucune écriture destructive.
import json, sys, urllib.request, urllib.error
try:
    sys.stdout.reconfigure(encoding="utf-8")  # console Windows (cp1252) → UTF-8
except Exception:
    pass

API = "http://localhost:3001/api/v1"
WEB = "http://localhost:3000"

PHONES = {
    "ADMIN": "+2290197000000",
    "MEDECIN": "+2290197000001",
    "PATIENT": "+2290197000002",
    "PHARMACIE": "+2290197000003",
    "LABORATOIRE": "+2290197000004",
    "DIASPORA": "+2290197000005",
}

results = []  # (espace, nom, ok, detail)

def call(method, url, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read().decode()
            try: return r.status, json.loads(raw)
            except Exception: return r.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, raw
    except Exception as e:
        return 0, str(e)

def login(role):
    phone = PHONES[role]
    st, rep = call("POST", f"{API}/auth/otp/request", body={"phone": phone, "channel": "SMS"})
    if st != 200 or not isinstance(rep, dict) or "devCode" not in rep:
        return None, None, f"otp/request -> {st} {str(rep)[:120]}"
    code = rep["devCode"]
    st, rep = call("POST", f"{API}/auth/otp/verify", body={"phone": phone, "code": code})
    if st != 200 or not isinstance(rep, dict) or "accessToken" not in rep:
        return None, None, f"otp/verify -> {st} {str(rep)[:120]}"
    return rep["accessToken"], rep.get("user"), None

def check(space, name, cond, detail=""):
    results.append((space, name, bool(cond), detail))

def n(x):
    # taille d'une liste / data
    if isinstance(x, list): return len(x)
    if isinstance(x, dict):
        for k in ("data", "items", "results"):
            if isinstance(x.get(k), list): return len(x[k])
    return None

tokens = {}

# ── AUTH : login des 6 rôles ──
for role in PHONES:
    tok, user, err = login(role)
    tokens[role] = tok
    ok = tok is not None and (user or {}).get("role") == role
    check("AUTH", f"Login OTP {role}", ok, err or f"role={user and user.get('role')}")

# ── AUTH : négatifs ──
st, _ = call("GET", f"{API}/users/me")  # sans token
check("AUTH", "GET /users/me sans token -> 401", st == 401, f"status={st}")

st, _ = call("GET", f"{API}/users/me", token="invalid.token.here")
check("AUTH", "GET /users/me token invalide -> 401", st == 401, f"status={st}")

# /users/me pour chaque rôle
for role in PHONES:
    if tokens[role]:
        st, me = call("GET", f"{API}/users/me", token=tokens[role])
        check("AUTH", f"GET /users/me {role} -> 200", st == 200, f"status={st}")

P = tokens["PATIENT"]; M = tokens["MEDECIN"]; PH = tokens["PHARMACIE"]
L = tokens["LABORATOIRE"]; D = tokens["DIASPORA"]; A = tokens["ADMIN"]

# ── PATIENT ──
if P:
    for name, path, want_nonempty in [
        ("DMP records", "/dmp/records", True),
        ("Ordonnances", "/prescriptions", False),
        ("Rendez-vous", "/appointments", False),
        ("Assureurs (catalogue)", "/insurance/providers", True),
        ("Mes assurances", "/insurance/me", False),
        ("Notifications", "/notifications", False),
        ("Contenus santé", "/education", False),
        ("Annuaire pro", "/professionals", False),
        ("Observance du jour", "/adherence/today", False),
        ("SOS (liste)", "/sos", False),
        ("Wallet", "/wallet", False),
    ]:
        st, rep = call("GET", f"{API}{path}", token=P)
        cnt = n(rep)
        ok = st == 200 and (not want_nonempty or (cnt is None or cnt > 0))
        check("PATIENT", f"GET {path}", ok, f"status={st} count={cnt}")

# ── MEDECIN ──
if M:
    for name, path in [
        ("Agenda", "/appointments/agenda?from=2026-06-01T00:00:00Z&to=2026-07-01T00:00:00Z"),
        ("Résultats labo à interpréter", "/lab/results"),
        ("Annuaire", "/professionals"),
        ("Threads chat", "/chat/threads"),
        ("Mon dossier KYC", "/kyc/me"),
    ]:
        st, rep = call("GET", f"{API}{path}", token=M)
        check("MEDECIN", f"GET {path}", st == 200, f"status={st} count={n(rep)}")

# ── PHARMACIE ──
if PH:
    st, rep = call("GET", f"{API}/pharmacy/dispensations", token=PH)
    check("PHARMACIE", "GET /pharmacy/dispensations (journal isolé)", st == 200, f"status={st} count={n(rep)}")
    # Délivrance réelle via scan du QR de l'ordonnance seedée
    st, rep = call("POST", f"{API}/pharmacy/scan", token=PH, body={"qrCode": "seed-qr-prescription-0001"})
    check("PHARMACIE", "POST /pharmacy/scan (QR ordonnance)", st == 200, f"status={st} {str(rep)[:90]}")

# ── LABORATOIRE ──
if L:
    st, rep = call("GET", f"{API}/lab/orders/available", token=L)
    pool_ok = st == 200
    # cloisonnement §4 : le pool ne doit PAS exposer l'identité patient
    leak = False
    arr = rep.get("data") if isinstance(rep, dict) else rep if isinstance(rep, list) else []
    for o in (arr or []):
        if isinstance(o, dict) and ("patient" in o or "firstName" in o or "lastName" in o):
            leak = True
    check("LABORATOIRE", "GET /lab/orders/available (pool)", pool_ok, f"status={st} count={n(rep)}")
    check("LABORATOIRE", "Pool anonymisé (pas d'identité patient) §4", pool_ok and not leak, f"leak={leak}")
    st, rep = call("GET", f"{API}/lab/orders/incoming", token=L)
    check("LABORATOIRE", "GET /lab/orders/incoming (pris en charge)", st == 200, f"status={st} count={n(rep)}")

# ── DIASPORA ──
if D:
    st, rep = call("GET", f"{API}/wallet", token=D)
    bal = rep.get("balance") if isinstance(rep, dict) else None
    check("DIASPORA", "GET /wallet (solde)", st == 200, f"status={st} balance={bal}")
    st, rep = call("GET", f"{API}/beneficiaries", token=D)
    check("DIASPORA", "GET /beneficiaries", st == 200 and (n(rep) or 0) > 0, f"status={st} count={n(rep)}")

# ── ADMIN ──
if A:
    for name, path, nonempty in [
        ("Métriques", "/admin/metrics", False),
        ("Utilisateurs", "/admin/users", True),
        ("Audit trail", "/admin/audit", False),
        ("File KYC", "/kyc/submissions", True),
    ]:
        st, rep = call("GET", f"{API}{path}", token=A)
        cnt = n(rep)
        ok = st == 200 and (not nonempty or (cnt is None or cnt > 0))
        check("ADMIN", f"GET {path}", ok, f"status={st} count={cnt}")

# ── RBAC négatif (cloisonnement des rôles) ──
if P:
    st, _ = call("GET", f"{API}/admin/metrics", token=P)
    check("RBAC", "Patient -> /admin/metrics -> 403", st == 403, f"status={st}")
if PH:
    st, _ = call("GET", f"{API}/admin/metrics", token=PH)
    check("RBAC", "Pharmacie -> /admin/metrics -> 403", st == 403, f"status={st}")
if L:
    st, _ = call("GET", f"{API}/pharmacy/dispensations", token=L)
    check("RBAC", "Labo -> /pharmacy/dispensations -> 403", st == 403, f"status={st}")
if D:
    st, _ = call("GET", f"{API}/admin/users", token=D)
    check("RBAC", "Diaspora -> /admin/users -> 403", st == 403, f"status={st}")

# ── WEB : pages servies (SSR shell -> 200) ──
for path in ["/login", "/onboarding", "/patient", "/pro", "/pharmacie", "/labo", "/diaspora", "/admin"]:
    st, _ = call("GET", f"{WEB}{path}")
    check("WEB", f"GET {path} -> 200", st == 200, f"status={st}")

# ── Rapport ──
spaces = []
for sp, *_ in results:
    if sp not in spaces: spaces.append(sp)
total_ok = sum(1 for r in results if r[2])
total = len(results)
print("\n" + "=" * 70)
print(f"  TESTS FONCTIONNELS — {total_ok}/{total} OK")
print("=" * 70)
for sp in spaces:
    rows = [r for r in results if r[0] == sp]
    ok = sum(1 for r in rows if r[2])
    print(f"\n[{sp}]  {ok}/{len(rows)}")
    for _, name, passed, detail in rows:
        mark = "  PASS" if passed else "  FAIL"
        print(f"  {mark}  {name}   ({detail})")
print("\n" + "=" * 70)
fails = [r for r in results if not r[2]]
if fails:
    print(f"  ÉCHECS ({len(fails)}) :")
    for sp, name, _, detail in fails:
        print(f"   - [{sp}] {name} :: {detail}")
    print("=" * 70)
    sys.exit(1)
print("  TOUS LES TESTS FONCTIONNELS SONT PASSÉS ✅")
print("=" * 70)
