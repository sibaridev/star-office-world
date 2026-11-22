#!/usr/bin/env python3
"""
Star Office - Agent Status Active Push Script

Usage:
1. Fill in JOIN_KEY below (the one-time join key provided to you)
2. Fill in AGENT_NAME (the name displayed in the office)
3. Run: python office-agent-push.py
4. The script will join the office on first run, then push updates every 15s
"""

import json
import os
import time
import sys
from datetime import datetime

# === Credentials ===
JOIN_KEY = ""   # Required: One-time join key
AGENT_NAME = "" # Required: Name in the office
OFFICE_URL = "http://localhost:19000"  # Star Office address

# === Push Configuration ===
PUSH_INTERVAL_SECONDS = 15
STATUS_ENDPOINT = "/status"
JOIN_ENDPOINT = "/join-agent"
PUSH_ENDPOINT = "/agent-push"

# Fallback to idle if local state file hasn't been updated
STALE_STATE_TTL_SECONDS = int(os.environ.get("OFFICE_STALE_STATE_TTL", "600"))

# State file caching agentId
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "office-agent-state.json")

# Candidate state paths
DEFAULT_STATE_CANDIDATES = [
    "/root/.openclaw/workspace/Star-Office-UI/state.json",
    "/root/.openclaw/workspace/star-office-ui/state.json",
    "/root/.openclaw/workspace/state.json",
    os.path.join(os.getcwd(), "state.json"),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "state.json"),
]

LOCAL_STATUS_TOKEN = os.environ.get("OFFICE_LOCAL_STATUS_TOKEN", "")
LOCAL_STATUS_URL = os.environ.get("OFFICE_LOCAL_STATUS_URL", "http://127.0.0.1:19000/status")
LOCAL_STATE_FILE = os.environ.get("OFFICE_LOCAL_STATE_FILE", "")
VERBOSE = os.environ.get("OFFICE_VERBOSE", "0") in {"1", "true", "TRUE", "yes", "YES"}


def load_local_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "agentId": None,
        "joined": False,
        "joinKey": JOIN_KEY,
        "agentName": AGENT_NAME
    }


def save_local_state(data):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def normalize_state(s):
    """Normalize local status string to office recognized state."""
    s = (s or "").strip().lower()
    if s in {"writing", "researching", "executing", "syncing", "error", "idle"}:
        return s
    if s in {"working", "busy", "write"}:
        return "writing"
    if s in {"run", "running", "execute", "exec"}:
        return "executing"
    if s in {"research", "search"}:
        return "researching"
    if s in {"sync"}:
        return "syncing"
    return "idle"


def map_detail_to_state(detail, fallback_state="idle"):
    """Infer state from detail string when only detail is available."""
    d = (detail or "").lower()
    if any(k in d for k in ["error", "bug", "exception", "alert"]):
        return "error"
    if any(k in d for k in ["sync", "backup"]):
        return "syncing"
    if any(k in d for k in ["research", "search", "investigate"]):
        return "researching"
    if any(k in d for k in ["execute", "run", "progress", "task", "writing"]):
        return "writing"
    if any(k in d for k in ["idle", "rest", "standby", "done", "finish"]):
        return "idle"
    return fallback_state


def _state_age_seconds(data):
    try:
        ts = (data or {}).get("updated_at")
        if not ts:
            return None
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            from datetime import timezone
            return (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds()
        return (datetime.now() - dt).total_seconds()
    except Exception:
        return None


def fetch_local_status():
    """Fetch local status:
    1) Priority: state.json
    2) Second: Local HTTP /status
    3) Fallback: idle
    """
    candidate_files = []
    if LOCAL_STATE_FILE:
        candidate_files.append(LOCAL_STATE_FILE)
    for fp in DEFAULT_STATE_CANDIDATES:
        if fp not in candidate_files:
            candidate_files.append(fp)

    for fp in candidate_files:
        try:
            if fp and os.path.exists(fp):
                with open(fp, "r", encoding="utf-8") as f:
                    data = json.load(f)

                    if not isinstance(data, dict):
                        continue
                    has_state = "state" in data
                    has_detail = "detail" in data
                    if (not has_state) and (not has_detail):
                        continue

                    state = normalize_state(data.get("state", "idle"))
                    detail = data.get("detail", "") or ""
                    state = map_detail_to_state(detail, fallback_state=state)

                    age = _state_age_seconds(data)
                    if age is not None and age > STALE_STATE_TTL_SECONDS:
                        state = "idle"
                        detail = f"Local state not updated for {STALE_STATE_TTL_SECONDS}s, returning to idle"

                    if VERBOSE:
                        print(f"[status-source:file] path={fp} state={state} detail={detail[:60]}")
                    return {"state": state, "detail": detail}
        except Exception:
            pass

    # 2) Try local HTTP /status
    try:
        import requests
        headers = {}
        if LOCAL_STATUS_TOKEN:
            headers["Authorization"] = f"Bearer {LOCAL_STATUS_TOKEN}"
        r = requests.get(LOCAL_STATUS_URL, headers=headers, timeout=5)
        if r.status_code == 200:
            data = r.json()
            state = normalize_state(data.get("state", "idle"))
            detail = data.get("detail", "") or ""
            state = map_detail_to_state(detail, fallback_state=state)

            age = _state_age_seconds(data)
            if age is not None and age > STALE_STATE_TTL_SECONDS:
                state = "idle"
                detail = f"Local /status not updated for {STALE_STATE_TTL_SECONDS}s, returning to idle"

            if VERBOSE:
                print(f"[status-source:http] url={LOCAL_STATUS_URL} state={state} detail={detail[:60]}")
            return {"state": state, "detail": detail}
        if r.status_code == 401:
            return {"state": "idle", "detail": "Local /status requires authentication (401), set OFFICE_LOCAL_STATUS_TOKEN"}
    except Exception:
        pass

    # 3) Default fallback
    if VERBOSE:
        print("[status-source:fallback] state=idle detail=Standing by")
    return {"state": "idle", "detail": "Standing by"}


def do_join(local):
    import requests
    payload = {
        "name": local.get("agentName", AGENT_NAME),
        "joinKey": local.get("joinKey", JOIN_KEY),
        "state": "idle",
        "detail": "Just joined"
    }
    r = requests.post(f"{OFFICE_URL}{JOIN_ENDPOINT}", json=payload, timeout=10)
    if r.status_code in (200, 201):
        data = r.json()
        if data.get("ok"):
            local["joined"] = True
            local["agentId"] = data.get("agentId")
            save_local_state(local)
            print(f"✅ Joined Star Office, agentId={local['agentId']}")
            return True
    print(f"❌ Join failed: {r.text}")
    return False


def do_push(local, status_data):
    import requests
    payload = {
        "agentId": local.get("agentId"),
        "joinKey": local.get("joinKey", JOIN_KEY),
        "state": status_data.get("state", "idle"),
        "detail": status_data.get("detail", ""),
        "name": local.get("agentName", AGENT_NAME)
    }
    r = requests.post(f"{OFFICE_URL}{PUSH_ENDPOINT}", json=payload, timeout=10)
    if r.status_code in (200, 201):
        data = r.json()
        if data.get("ok"):
            area = data.get("area", "breakroom")
            print(f"✅ State synchronized, current area={area}")
            return True

    # 403/404: Rejected or removed -> Stop pushing
    if r.status_code in (403, 404):
        msg = ""
        try:
            msg = (r.json() or {}).get("msg", "")
        except Exception:
            msg = r.text
        print(f"⚠️ Access denied or removed ({r.status_code}), stopping push: {msg}")
        local["joined"] = False
        local["agentId"] = None
        save_local_state(local)
        sys.exit(1)

    print(f"⚠️ Push failed: {r.text}")
    return False


def main():
    local = load_local_state()

    if not JOIN_KEY or not AGENT_NAME:
        print("❌ Please configure JOIN_KEY and AGENT_NAME at top of script")
        sys.exit(1)

    if not local.get("joined") or not local.get("agentId"):
        ok = do_join(local)
        if not ok:
            sys.exit(1)

    print(f"🚀 Started status push loop, interval={PUSH_INTERVAL_SECONDS}s")
    try:
        while True:
            try:
                status_data = fetch_local_status()
                do_push(local, status_data)
            except Exception as e:
                print(f"⚠️ Push error: {e}")
            time.sleep(PUSH_INTERVAL_SECONDS)
    except KeyboardInterrupt:
        print("\n👋 Stopped push")
        sys.exit(0)


if __name__ == "__main__":
    main()
