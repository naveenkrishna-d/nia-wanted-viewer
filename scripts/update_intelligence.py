#!/usr/bin/env python3
"""Refresh public reporting leads. Never modify official records or infer identity/status."""
import json
import os
import re
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse
import requests

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / 'data/intelligence.json'
def now():
    return datetime.now(timezone.utc).isoformat()
def safe_url(value):
    return value if urlparse(value).scheme in ('http', 'https') else ''
def query_name(record):
    return re.sub(r'\([^)]*\)', '', record['name']).replace('"', '').strip()
def refresh():
    records = json.loads((ROOT / 'data/records.json').read_text())['records']
    old = json.loads(PATH.read_text()) if PATH.exists() else {'profiles': {}}
    profiles = old.get('profiles', {})
    session = requests.Session()
    session.headers['User-Agent'] = 'NIA-Public-Reporting-Viewer/2.0'
    token = os.environ.get('X_BEARER_TOKEN', '')
    budget = int(os.environ.get('INTELLIGENCE_BATCH_SIZE', '60'))
    selected = sorted(records, key=lambda r: profiles.get(r.get('id', r['name']), {}).get('attempted_at', ''))[:budget]
    for record in selected:
        name = record.get('id', record['name']); term = query_name(record)
        previous = profiles.get(name, {})
        sources = dict(previous.get('sources', {}))
        # Context narrows same-name matches; every result still requires human verification.
        query = f'"{term}" (NIA OR "National Investigation Agency")'
        providers = ['news', 'gdelt', 'x']
        for provider in providers:
            prior = sources.get(provider, {})
            if provider == 'x' and not token:
                sources[provider] = {**prior, 'state': 'not_configured', 'error': 'Set X_BEARER_TOKEN to enable automatic X searches'}
                continue
            try:
                items = []
                if provider == 'news':
                    response = session.get('https://news.google.com/rss/search', params={'q': query, 'hl': 'en-IN', 'gl': 'IN', 'ceid': 'IN:en'}, timeout=25)
                    response.raise_for_status()
                    for node in ET.fromstring(response.content).findall('.//item')[:10]:
                        items.append({'title': node.findtext('title', ''), 'url': safe_url(node.findtext('link', '')), 'published_at': node.findtext('pubDate', ''), 'publisher': node.findtext('source', '')})
                elif provider == 'gdelt':
                    response = session.get('https://api.gdeltproject.org/api/v2/doc/doc', params={'query': query, 'mode': 'artlist', 'format': 'json', 'timespan': '3months', 'maxrecords': 10, 'sort': 'datedesc'}, timeout=25)
                    response.raise_for_status()
                    for item in response.json().get('articles', []):
                        items.append({'title': item.get('title', ''), 'url': safe_url(item.get('url', '')), 'published_at': item.get('seendate', ''), 'publisher': item.get('domain', '')})
                else:
                    response = session.get('https://api.x.com/2/tweets/search/recent', headers={'Authorization': 'Bearer ' + token}, params={'query': query + ' -is:retweet', 'max_results': 10, 'tweet.fields': 'created_at,author_id'}, timeout=25)
                    response.raise_for_status()
                    for item in response.json().get('data', []):
                        items.append({'title': 'Public X post — open source to review', 'url': 'https://x.com/i/status/' + item['id'], 'published_at': item.get('created_at', ''), 'publisher': 'X', 'author_id': item.get('author_id', '')})
                sources[provider] = {'state': 'ok', 'checked_at': now(), 'items': [i for i in items if i['url']]}
            except Exception as exc:
                # Only report HTTP code/type; exceptions can contain authentication URLs.
                code = getattr(getattr(exc, 'response', None), 'status_code', None)
                sources[provider] = {**prior, 'state': 'failed', 'attempted_at': now(), 'error': f'{type(exc).__name__}' + (f' HTTP {code}' if code else '')}
            if provider == 'gdelt':
                time.sleep(6)
        profiles[name] = {'attempted_at': now(), 'sources': sources}
        temporary = PATH.with_suffix('.json.tmp')
        temporary.write_text(json.dumps({'generated_at': now(), 'profiles': profiles, 'batch_size': budget, 'x_configured': bool(token)}, ensure_ascii=False, indent=2) + '\n')
        temporary.replace(PATH)
    print(f'Refreshed reporting for {len(selected)} profiles; X configured: {bool(token)}')
if __name__ == '__main__':
    refresh()
