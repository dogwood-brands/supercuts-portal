#!/usr/bin/env python3
"""Batch-download every DSR/DHR .xlsx attachment from reports@scsalons.com."""
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

CREDENTIALS_FILE = "/Users/dogwoodbrandscompany/.gmail-mcp/credentials.json"
OAUTH_KEYS_FILE = "/Users/dogwoodbrandscompany/.gmail-mcp/gcp-oauth.keys.json"
OUTPUT_DIR = "/Users/dogwoodbrandscompany/dogwood-agents/data/dsr-dhr/raw"
# Since 2026-09-30 the reports are sent by hand from Emory's mailbox instead of reports@scsalons.com,
# with subjects like "November DSR With Targets Update 11-11-26". Both senders are read.
SEARCH_QUERY = "(from:reports@scsalons.com OR from:es@dogwoodbrands.com) has:attachment (DSR OR DHR)"

def load_json(path):
    with open(path) as f:
        return json.load(f)

def save_json(path, data):
    with open(path, "w") as f:
        json.dump(data, f)

def refresh_token(creds):
    keys = load_json(OAUTH_KEYS_FILE)["installed"]
    data = urllib.parse.urlencode({
        "client_id": keys["client_id"],
        "client_secret": keys["client_secret"],
        "refresh_token": creds["refresh_token"],
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=data, method="POST")
    with urllib.request.urlopen(req, timeout=15) as resp:
        result = json.loads(resp.read())
    creds["access_token"] = result["access_token"]
    creds["expiry_date"] = int(time.time() * 1000) + (result.get("expires_in", 3600) * 1000)
    save_json(CREDENTIALS_FILE, creds)
    return creds

def api_get(url, token):
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())

def list_messages(token, query, max_results=200):
    msgs = []
    page_token = None
    while True:
        q = urllib.parse.quote(query)
        url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages?q={q}&maxResults={max_results}"
        if page_token:
            url += f"&pageToken={page_token}"
        result = api_get(url, token)
        msgs.extend(result.get("messages", []))
        page_token = result.get("nextPageToken")
        if not page_token:
            break
    return msgs

def get_message(token, msg_id):
    return api_get(f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}", token)

def get_attachment(token, msg_id, att_id):
    return api_get(
        f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}/attachments/{att_id}",
        token,
    )

def header(msg, name):
    for h in msg["payload"].get("headers", []):
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""

def walk_parts(payload):
    parts = payload.get("parts", [])
    if not parts:
        yield payload
        return
    for p in parts:
        yield from walk_parts(p)

def extract_date_tag(subject):
    """Pull the MM/DD/YYYY date from 'May DSR with Target Updates 05/15/2026'."""
    import re
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", subject)
    if m:
        mm, dd, yyyy = m.groups()
        return f"{yyyy}-{mm}-{dd}"
    # "... Update 11-11-26" / "... Update 10-5-26" (the date after "Update", never the "Week" date)
    m = re.search(r"Update\s+(\d{1,2})-(\d{1,2})-(\d{2,4})", subject, re.I)
    if m:
        mm, dd, yy = m.groups()
        yyyy = yy if len(yy) == 4 else "20" + yy
        return f"{yyyy}-{int(mm):02d}-{int(dd):02d}"
    return None


def sent_date_tag(msg):
    """Calendar date the email was sent, in US Central time."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    ms = int(msg.get("internalDate", 0))
    if not ms:
        return None
    return datetime.fromtimestamp(ms / 1000, ZoneInfo("America/Chicago")).strftime("%Y-%m-%d")

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    creds = load_json(CREDENTIALS_FILE)
    if time.time() * 1000 > creds.get("expiry_date", 0) - 60000:
        creds = refresh_token(creds)
    token = creds["access_token"]

    msgs = list_messages(token, SEARCH_QUERY)
    print(f"Found {len(msgs)} DSR/DHR report messages", file=sys.stderr)

    downloaded = []
    skipped = []
    for m in msgs:
        msg = get_message(token, m["id"])
        subject = header(msg, "Subject")
        date_tag = extract_date_tag(subject)
        # Hand-sent reports occasionally carry yesterday's date in the subject (two different
        # mornings labelled the same day). The day it was sent is the reliable one.
        if date_tag and "es@dogwoodbrands.com" in header(msg, "From").lower():
            sent = sent_date_tag(msg)
            if sent and sent != date_tag:
                print(f"  subject says {date_tag}, sent {sent}: filing as {sent} ({subject})", file=sys.stderr)
                date_tag = sent
        if not date_tag:
            skipped.append((m["id"], subject, "no-date"))
            continue
        kind = None
        if "DSR" in subject:
            kind = "DSR"
        elif "DHR" in subject:
            kind = "DHR"
        else:
            skipped.append((m["id"], subject, "not-dsr-dhr"))
            continue

        outname = f"{kind}_{date_tag}.xlsx"
        outpath = os.path.join(OUTPUT_DIR, outname)
        if os.path.exists(outpath):
            downloaded.append((outname, "cached"))
            continue

        # Find xlsx attachment
        xlsx_part = None
        for part in walk_parts(msg["payload"]):
            filename = part.get("filename", "") or ""
            if filename.lower().endswith(".xlsx"):
                xlsx_part = part
                break
        if not xlsx_part:
            skipped.append((m["id"], subject, "no-xlsx"))
            continue

        att_id = xlsx_part["body"].get("attachmentId")
        if not att_id:
            skipped.append((m["id"], subject, "no-att-id"))
            continue

        att = get_attachment(token, m["id"], att_id)
        raw = base64.urlsafe_b64decode(att["data"])
        with open(outpath, "wb") as f:
            f.write(raw)
        downloaded.append((outname, f"{len(raw)} bytes"))

    print(f"Downloaded: {len(downloaded)}", file=sys.stderr)
    for n, s in downloaded:
        print(f"  {n}: {s}", file=sys.stderr)
    if skipped:
        print(f"Skipped: {len(skipped)}", file=sys.stderr)
        for mid, sub, reason in skipped:
            print(f"  {mid} ({reason}): {sub}", file=sys.stderr)

if __name__ == "__main__":
    main()
