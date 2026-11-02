# Progression en direct du relevé des vues (affichée sur le dashboard pendant le relevé).
# Usage (depuis la racine du dépôt cloné) :
#   python3 -I tools/prog.py start <nombre total de comptes>
#   python3 -I tools/prog.py add "<handle1,handle2,...>" ["<handles illisibles>"] [--cur <handle en cours>] [--push]
#   python3 -I tools/prog.py fin
# Les @ ne sont jamais publiés en clair : seulement une empreinte (sha256, 10 caractères).
import sys, json, hashlib, subprocess, datetime, os
from zoneinfo import ZoneInfo
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(R, "progress.json")
def now(): return datetime.datetime.now(ZoneInfo("Europe/Paris")).isoformat(timespec="seconds")
def h(x): return hashlib.sha256(x.strip().lstrip("@").lower().encode()).hexdigest()[:10]
def load():
    try: return json.load(open(P))
    except Exception: return {}
def push():
    g = ["git", "-C", R]
    subprocess.run(g + ["add", "progress.json"], capture_output=True)
    subprocess.run(g + ["-c", "user.name=Claude", "-c", "user.email=noreply@anthropic.com", "commit", "-qm", "Progression du relevé"], capture_output=True)
    for _ in range(3):
        subprocess.run(g + ["pull", "-q", "--rebase", "origin", "main"], capture_output=True)
        if subprocess.run(g + ["push", "-q", "origin", "HEAD:main"], capture_output=True).returncode == 0:
            print("push ok"); return
    print("push KO")
a = sys.argv[1:]; cmd = a[0]; d = load()
if cmd == "start":
    d = {"s": now(), "u": now(), "f": 0, "n": int(a[1]), "d": [], "k": [], "c": None}
elif cmd == "add":
    pos = [x for x in a[1:] if not x.startswith("--")]
    if "--cur" in a: pos = [x for x in pos if x != a[a.index("--cur") + 1]]
    for x in filter(None, (pos[0] if pos else "").split(",")):
        if h(x) not in d.setdefault("d", []): d["d"].append(h(x))
    for x in filter(None, (pos[1] if len(pos) > 1 else "").split(",")):
        if h(x) not in d.setdefault("k", []): d["k"].append(h(x))
    d["c"] = h(a[a.index("--cur") + 1]) if "--cur" in a and a[a.index("--cur") + 1] else None
    d["u"] = now()
elif cmd == "fin":
    d["f"] = 1; d["c"] = None; d["e"] = now(); d["u"] = now()
json.dump(d, open(P, "w"), separators=(",", ":"))
print(cmd, "ok :", len(d.get("d", [])), "relevés,", len(d.get("k", [])), "illisibles /", d.get("n"))
if cmd in ("start", "fin") or "--push" in a: push()
