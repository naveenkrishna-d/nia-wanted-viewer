import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import update_nia as u
from unittest.mock import patch

def page(name, last=0):
    return f'<img alt="{name}" src="/photo.jpg"><p>Name :</p><p>{name}</p><p>Aliases :</p><p>@ Test</p><p>Wanted in :</p><p>RC-01/2024/NIA/DLI</p><p>Organization :</p><p>For any information, please Contact</p><p>E-mail :</p><p>mail</p><p>Identity of the informant shall be kept secret.</p>' + (f'<a href="?page={last}">Last</a>' if last else '')
class Response:
    status_code=200
    def __init__(self, text): self.text=text
    def raise_for_status(self): pass
class Session:
    def __init__(self): self.headers={}
    def mount(self,*args): pass
    def get(self,url,**kwargs):
        index=int(url.split('page=')[-1]) if 'page=' in url else 0
        return Response(page('Person '+str(index),2 if index==0 else 0))
class Tests(unittest.TestCase):
    def test_fields(self):
        record=u.parse_records(page('Person'), 'https://nia.gov.in/most-wanted?page=2','Most Wanted')[0]
        self.assertEqual(record['organization'],'')
        self.assertEqual(record['cases'],['RC-01/2024/NIA/DLI'])
        self.assertIn('?page=2',record['source_url'])
    def test_all_pages_and_sources(self):
        with patch.object(u.requests,'Session',Session):
            records,checks=u.fetch_all()
        self.assertEqual(len(checks),6)
        self.assertEqual(len(records),3)
        self.assertEqual(len(records[0]['source_pages']),2)
    def test_repeated_page_rejected(self):
        with patch.object(Session,'get',return_value=Response(page('Same',2))), patch.object(u.requests,'Session',Session):
            with self.assertRaises(RuntimeError): u.fetch_all()
if __name__=='__main__': unittest.main()
