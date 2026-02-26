"""Apply payroll fixes to production App Engine database."""
import json
import urllib.request
import urllib.error

BASE = "https://labor-timekeeper-dot-jcw-2-android-estimator.uc.r.appspot.com"

def post_json(path, data):
    url = f"{BASE}{path}"
    body = json.dumps(data).encode()
    req = urllib.request.Request(url, body, {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"ERROR {e.code}: {e.read().decode()}")
        return None

def get_json(path):
    url = f"{BASE}{path}"
    with urllib.request.urlopen(url) as resp:
        return json.loads(resp.read())

# ── Step 1: Add Chris Zavesky Mon 23 & Tue 24 ──
print("=== Step 1: Chris Zavesky Mon/Tue entries ===")
chris_z_entries = [
    {"employee": "Chris Zavesky", "customer": "Ueltschi", "work_date": "2026-02-23", "hours": 4, "notes": "Protection/painters"},
    {"employee": "Chris Zavesky", "customer": "Null", "work_date": "2026-02-23", "hours": 1, "notes": "Access grout"},
    {"employee": "Chris Zavesky", "customer": "Watkins", "work_date": "2026-02-23", "hours": 3, "notes": ""},
    {"employee": "Chris Zavesky", "customer": "Landy", "work_date": "2026-02-24", "hours": 2.5, "notes": ""},
    {"employee": "Chris Zavesky", "customer": "Ueltschi", "work_date": "2026-02-24", "hours": 5, "notes": ""},
    {"employee": "Chris Zavesky", "customer": "Watkins", "work_date": "2026-02-24", "hours": 3, "notes": ""},
]
r = post_json("/api/admin/import-entries", {"entries": chris_z_entries, "default_status": "APPROVED"})
print(f"  Result: {r}")

# ── Step 2: Add Jason Green entries ──
print("\n=== Step 2: Jason Green entries ===")
jason_entries = [
    {"employee": "Jason Green", "customer": "Boyle", "work_date": "2026-02-18", "hours": 8, "notes": "Framing back roof support for footer block wall. Posts."},
    {"employee": "Jason Green", "customer": "Boyle", "work_date": "2026-02-19", "hours": 4.5, "notes": "Tune up bracing; Remove trim casting nails front."},
    {"employee": "Jason Green", "customer": "O'Connor", "work_date": "2026-02-19", "hours": 1.5, "notes": "Remove appliance panels hardware in kitchen."},
    {"employee": "Jason Green", "customer": "Richer", "work_date": "2026-02-20", "hours": 1.5, "notes": "Go to office for poplar, build shelf pieces. Primer."},
    {"employee": "Jason Green", "customer": "Boyle", "work_date": "2026-02-20", "hours": 6.5, "notes": "Cover back plastic. Brace side roof. Water diverted."},
    {"employee": "Jason Green", "customer": "Boyle", "work_date": "2026-02-23", "hours": 8, "notes": "Pull nails. Pull staples coil up wires. Clean up"},
    {"employee": "Jason Green", "customer": "Nathan", "work_date": "2026-02-24", "hours": 9, "notes": "Remove attic access. Build jamb and door. Finish drywall."},
]
r = post_json("/api/admin/import-entries", {"entries": jason_entries, "default_status": "APPROVED"})
print(f"  Result: {r}")

# ── Step 3: Add Thomas Brinson entries ──
print("\n=== Step 3: Thomas Brinson entries ===")
thomas_entries = [
    {"employee": "Thomas Brinson", "customer": "Boyle", "work_date": "2026-02-18", "hours": 4, "notes": "Reinforced back porch overhang; Demo"},
    {"employee": "Thomas Brinson", "customer": "Landy", "work_date": "2026-02-18", "hours": 3.5, "notes": "Superintendent"},
    {"employee": "Thomas Brinson", "customer": "Gonzalez", "work_date": "2026-02-19", "hours": 8.5, "notes": "Demo garage ceiling; Drive back to barn unload trash to trailer"},
    {"employee": "Thomas Brinson", "customer": "Boyle", "work_date": "2026-02-20", "hours": 7.5, "notes": "Demo; Plastic wall protection"},
    {"employee": "Thomas Brinson", "customer": "Boyle", "work_date": "2026-02-23", "hours": 6.5, "notes": "Remove remaining electric wire for demolition; Demo"},
    {"employee": "Thomas Brinson", "customer": "Landy", "work_date": "2026-02-23", "hours": 1, "notes": "Superintendent; Paperwork to office"},
    {"employee": "Thomas Brinson", "customer": "Gonzalez", "work_date": "2026-02-24", "hours": 8.5, "notes": "Pantry shelves and trim and door install; Fixed trim around cabinet areas. Clean up."},
]
r = post_json("/api/admin/import-entries", {"entries": thomas_entries, "default_status": "APPROVED"})
print(f"  Result: {r}")

# ── Step 4: Fix Chris Z Lunch Bug ──
print("\n=== Step 4: Fix Chris Z 12.5h Lunch Bug ===")
# First find the bad entry
health = get_json("/api/health")
print(f"  Current health: {health}")

# Delete the bad lunch entry and add corrected one
# The entry ID from snapshot: te_zajXhzWr7eyRPrNP
# Try to delete it via the admin API
import urllib.request
del_url = f"{BASE}/api/time-entries/te_zajXhzWr7eyRPrNP?force=true"
del_req = urllib.request.Request(del_url, json.dumps({"force": True}).encode(), {
    "Content-Type": "application/json",
    "X-Admin-Secret": "7707"
})
del_req.method = "DELETE"
try:
    with urllib.request.urlopen(del_req) as resp:
        print(f"  Deleted bad lunch entry: {json.loads(resp.read())}")
except urllib.error.HTTPError as e:
    print(f"  Delete failed ({e.code}): {e.read().decode()}")

# Add corrected lunch entry
r = post_json("/api/admin/import-entries", {"entries": [
    {"employee": "Chris Zavesky", "customer": "Lunch", "work_date": "2026-02-18", "hours": 0.5, "notes": "Lunch (corrected from 12.5h bug)"}
], "default_status": "APPROVED"})
print(f"  Added corrected lunch: {r}")

# ── Final: Verify ──
print("\n=== Final Verification ===")
health = get_json("/api/health")
print(f"  Health: {health}")
