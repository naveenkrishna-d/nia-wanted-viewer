import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import update_intelligence as u
class BrokenSession:
    def __init__(self): self.headers={}
    def get(self,*args,**kwargs): raise u.requests.Timeout('blocked')
class TestReporting(unittest.TestCase):
    def test_failed_refresh_retains_leads_and_x_is_explicit(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'data').mkdir();dest=root/'data/intelligence.json'
            (root/'data/records.json').write_text(json.dumps({'records':[{'id':'one','name':'Person'}]}))
            lead={'title':'Earlier report','url':'https://example.org/report'}
            dest.write_text(json.dumps({'profiles':{'one':{'sources':{'news':{'checked_at':'previous','items':[lead]}}}}}))
            with patch.object(u,'ROOT',root),patch.object(u,'PATH',dest),patch.object(u.requests,'Session',BrokenSession),patch.object(u.time,'sleep'),patch.dict(u.os.environ,{'X_BEARER_TOKEN':'','INTELLIGENCE_BATCH_SIZE':'1'}): u.refresh()
            result=json.loads(dest.read_text())['profiles']['one']['sources']
            self.assertEqual(result['news']['items'],[lead]);self.assertEqual(result['news']['state'],'failed');self.assertEqual(result['x']['state'],'not_configured')
if __name__=='__main__':unittest.main()
