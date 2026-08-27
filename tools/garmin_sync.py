#!/usr/bin/env python3
"""
Pull strength-training sets (weight/reps Garmin auto-detected on the watch),
recent cardio activities, and daily wellness (sleep, HRV, body battery,
training readiness), and stage them in Leeenochka's own Postgres — sets/
cardio for the bot to propose into training_logs, wellness for the morning
brief (garmin_wellness table).

Built on the open-source python-garminconnect library by cyberjunky:
https://github.com/cyberjunky/python-garminconnect
Read-only — never writes anything back to your Garmin account.

Every run is a rolling pull of the last N days (default 7) — it does NOT need
to know in advance which days you went to the gym. Garmin already timestamps
each activity; we just filter by activityType and let the date fall where it
falls. Safe to re-run: activities are upserted by their Garmin activity id,
so a repeat run just refreshes the same rows.

Auth
----
If you already have a saved token from the fitflow project (GARMIN_TOKEN_B64
env var or a ~/.garminconnect token store), IT WORKS HERE TOO — Garmin tokens
aren't tied to a specific downstream app, so you do not need to log in again.

One-time login (only if you don't have a saved token):
    GARMIN_EMAIL=you@example.com GARMIN_PASSWORD=... python garmin_sync.py --login

Dry run (prints what would be written, writes nothing):
    python garmin_sync.py --days 7 --dry-run

Write to Postgres (same DB the bot reads — see note below):
    DATABASE_URL=postgres://... python garmin_sync.py --days 7

IMPORTANT — DATABASE_URL
-------------------------
This script writes directly into the same Postgres the bot's `initDb()`
creates its tables in (see src/db/index.ts). If the bot runs on Railway/Render
with an attached Postgres add-on, DATABASE_URL usually lives ONLY in that
platform's env vars — not in your local .env. Copy the exact same connection
string here (e.g. from the Railway dashboard), otherwise this script will
write into a different (empty) database and the bot will never see it.

Usage
-----
    python garmin_sync.py --days 7                 # pull + write
    python garmin_sync.py --days 7 --dry-run        # pull + print only
    python garmin_sync.py --login                   # first-time auth
"""

import argparse
import base64
import json
import os
import sys
from datetime import date, timedelta

try:
    from garminconnect import Garmin
except ImportError:
    sys.exit("Missing dependency. Run:  pip install -r requirements.txt")


TOKENSTORE = os.getenv("GARMINTOKENS", os.path.expanduser("~/.garminconnect"))


def _prompt_mfa() -> str:
    return input("Garmin 2FA code: ").strip()


def authenticate(force_login: bool) -> "Garmin":
    token_b64 = os.getenv("GARMIN_TOKEN_B64")

    if token_b64 and not force_login:
        garmin = Garmin()
        garmin.client.loads(base64.b64decode(token_b64).decode("utf-8"))
        return garmin

    if not force_login:
        try:
            garmin = Garmin()
            garmin.login(TOKENSTORE)
            return garmin
        except Exception:  # noqa: BLE001 — fall through to password login
            pass

    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")
    if not email or not password:
        sys.exit("Set GARMIN_EMAIL and GARMIN_PASSWORD for the first login (or reuse GARMIN_TOKEN_B64 from fitflow).")

    garmin = Garmin(email=email, password=password, prompt_mfa=_prompt_mfa)
    garmin.login(TOKENSTORE)  # tokenstore path → library persists tokens there automatically
    garmin.client.dump(TOKENSTORE)
    return garmin


def _safe(fn, label: str = ""):
    try:
        result = fn()
        if label and not result:
            print(f"[wellness] {label}: no data returned (Garmin has nothing for this day)")
        return result
    except Exception as e:  # noqa: BLE001
        if label:
            print(f"[wellness] {label} failed: {e}")
        return None


# ── strength sets ────────────────────────────────────────────────────────────
# Garmin groups a strength activity's sets as a flat array; REST sets are
# interleaved between ACTIVE ones and carry no exercise info — we drop them.
# Consecutive ACTIVE sets of the SAME exercise category are folded into one
# log-friendly group (exercise, weight_kg, reps:[...]) — this is what the bot
# proposes as a single training_logs row.
def parse_exercise_sets(raw: dict) -> list:
    sets = raw.get("exerciseSets") or raw.get("ExerciseSets") or []
    groups = []
    cur = None
    for s in sets:
        if str(s.get("setType", "")).upper() != "ACTIVE":
            continue
        exs = s.get("exercises") or []
        category = exs[0].get("category") if exs else None
        name = exs[0].get("name") if exs else None
        reps = s.get("repetitionCount")
        weight_g = s.get("weight")
        weight_kg = round(weight_g / 1000, 2) if isinstance(weight_g, (int, float)) else None
        key = category or "UNKNOWN"
        if cur and cur["category"] == key and cur["weight_kg"] == weight_kg:
            if isinstance(reps, (int, float)):
                cur["reps"].append(int(reps))
        else:
            cur = {"category": key, "name": name, "weight_kg": weight_kg, "reps": ([int(reps)] if isinstance(reps, (int, float)) else [])}
            groups.append(cur)
    return groups


def _get(d, *path):
    for key in path:
        if not isinstance(d, dict):
            return None
        d = d.get(key)
    return d


# ── wellness (sleep, HRV, body battery, ...) ──────────────────────────────────
def fetch_wellness(garmin: "Garmin", cday: str) -> dict:
    summary = _safe(lambda: garmin.get_user_summary(cday), f"get_user_summary({cday})") or {}
    hrv = _safe(lambda: garmin.get_hrv_data(cday), f"get_hrv_data({cday})") or {}
    sleep = _safe(lambda: garmin.get_sleep_data(cday), f"get_sleep_data({cday})") or {}
    readiness = _safe(lambda: garmin.get_training_readiness(cday), f"get_training_readiness({cday})")

    sleep_seconds = _get(sleep, "dailySleepDTO", "sleepTimeSeconds")
    sleep_hours = round(sleep_seconds / 3600, 1) if sleep_seconds else None

    readiness_score = None
    if isinstance(readiness, list) and readiness:
        readiness_score = readiness[0].get("score")
    elif isinstance(readiness, dict):
        readiness_score = readiness.get("score")

    return {
        "date": cday,
        "resting_hr": summary.get("restingHeartRate"),
        "hrv_ms": _get(hrv, "hrvSummary", "lastNightAvg"),
        "sleep_hours": sleep_hours,
        "sleep_score": _get(sleep, "dailySleepDTO", "sleepScores", "overall", "value"),
        "body_battery_high": summary.get("bodyBatteryHighestValue"),
        "body_battery_low": summary.get("bodyBatteryLowestValue"),
        "stress_avg": summary.get("averageStressLevel"),
        "steps": summary.get("totalSteps"),
        "training_readiness": readiness_score,
    }


def fetch_strength_activities(garmin: "Garmin", start: str, end: str) -> list:
    acts = _safe(lambda: garmin.get_activities_by_date(start, end)) or []
    out = []
    for a in acts:
        type_key = (a.get("activityType") or {}).get("typeKey")
        if type_key != "strength_training":
            continue
        activity_id = a.get("activityId")
        if not activity_id:
            continue
        raw_sets = _safe(lambda: garmin.get_activity_exercise_sets(activity_id)) or {}
        out.append({
            "garmin_id": str(activity_id),
            "date": (a.get("startTimeLocal") or "")[:10],
            "type": type_key,
            "name": a.get("activityName"),
            "raw": raw_sets,
            "parsed": parse_exercise_sets(raw_sets),
        })
    return out


# ── Postgres sink ────────────────────────────────────────────────────────────
def sink_postgres(rows: list) -> None:
    try:
        import psycopg2
        from psycopg2.extras import Json
    except ImportError:
        sys.exit("Missing dependency. Run:  pip install -r requirements.txt")

    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        sys.exit("Set DATABASE_URL to the SAME Postgres the bot uses (see script docstring).")

    conn = psycopg2.connect(dsn)
    try:
        with conn, conn.cursor() as cur:
            for r in rows:
                cur.execute(
                    """
                    INSERT INTO garmin_activities (garmin_id, activity_date, type, name, raw, parsed, processed)
                    VALUES (%s, %s, %s, %s, %s, %s, false)
                    ON CONFLICT (garmin_id) DO UPDATE SET
                        activity_date = EXCLUDED.activity_date,
                        type = EXCLUDED.type,
                        name = EXCLUDED.name,
                        raw = EXCLUDED.raw,
                        parsed = EXCLUDED.parsed
                    """,
                    (r["garmin_id"], r["date"] or None, r["type"], r["name"], Json(r["raw"]), Json(r["parsed"])),
                )
        print(f"Upserted {len(rows)} activities into garmin_activities.")
    finally:
        conn.close()


def sink_wellness_postgres(rows: list) -> None:
    try:
        import psycopg2
        from psycopg2.extras import Json
    except ImportError:
        sys.exit("Missing dependency. Run:  pip install -r requirements.txt")

    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        sys.exit("Set DATABASE_URL to the SAME Postgres the bot uses (see script docstring).")

    conn = psycopg2.connect(dsn)
    try:
        with conn, conn.cursor() as cur:
            for w in rows:
                cur.execute(
                    """
                    INSERT INTO garmin_wellness
                        (date, resting_hr, hrv_ms, sleep_hours, sleep_score,
                         body_battery_high, body_battery_low, stress_avg, steps, training_readiness, raw, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                    ON CONFLICT (date) DO UPDATE SET
                        resting_hr         = EXCLUDED.resting_hr,
                        hrv_ms             = EXCLUDED.hrv_ms,
                        sleep_hours        = EXCLUDED.sleep_hours,
                        sleep_score        = EXCLUDED.sleep_score,
                        body_battery_high  = EXCLUDED.body_battery_high,
                        body_battery_low   = EXCLUDED.body_battery_low,
                        stress_avg         = EXCLUDED.stress_avg,
                        steps              = EXCLUDED.steps,
                        training_readiness = EXCLUDED.training_readiness,
                        raw                = EXCLUDED.raw,
                        updated_at         = now()
                    """,
                    (w["date"], w["resting_hr"], w["hrv_ms"], w["sleep_hours"], w["sleep_score"],
                     w["body_battery_high"], w["body_battery_low"], w["stress_avg"], w["steps"],
                     w["training_readiness"], Json(w)),
                )
        print(f"Upserted {len(rows)} days into garmin_wellness.")
    finally:
        conn.close()


# ── main ─────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(description="Sync Garmin strength sets + cardio into Leeenochka's Postgres.")
    parser.add_argument("--login", action="store_true", help="Force interactive login and save a token.")
    parser.add_argument("--days", type=int, default=7, help="Rolling window of recent days to pull (default 7).")
    parser.add_argument("--dry-run", action="store_true", help="Print results, write nothing.")
    args = parser.parse_args()

    garmin = authenticate(force_login=args.login)

    if args.login:
        garmin.client.dump(TOKENSTORE)
        bundle = base64.b64encode(garmin.client.dumps().encode("utf-8")).decode("utf-8")
        print("\nLogin OK. Token saved to", TOKENSTORE)
        print("\nFor a scheduled/headless run, save this as GARMIN_TOKEN_B64:\n")
        print(bundle)
        return

    today = date.today()
    start = (today - timedelta(days=args.days)).isoformat()
    end = today.isoformat()

    rows = fetch_strength_activities(garmin, start, end)

    # Wellness — окремі API-виклики на кожен день, тож не тягнемо на всю ширину --days,
    # трьох останніх днів вистачає для ранкового брифу (сон рахується за минулу ніч).
    wellness_days = [(today - timedelta(days=i)).isoformat() for i in range(min(args.days, 3))]
    wellness = [fetch_wellness(garmin, d) for d in wellness_days]

    if args.dry_run:
        print(json.dumps({"activities": rows, "wellness": wellness}, ensure_ascii=False, indent=2))
        return

    if rows:
        sink_postgres(rows)
    else:
        print("(No strength_training activities in this window.)")

    sink_wellness_postgres(wellness)


if __name__ == "__main__":
    main()
