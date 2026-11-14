"""Verify and load the archived policies on CPU, with optional inference examples."""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import sys
import importlib.util

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'source/current/training/entity'))
import torch
from model import EntityPolicy, collate
legacy_path=ROOT/"source/online-417/training/entity/model.py"
legacy_spec=importlib.util.spec_from_file_location("entity_model_v6",legacy_path)
legacy=importlib.util.module_from_spec(legacy_spec)
legacy_spec.loader.exec_module(legacy)

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--model',help='One model id from models/manifest.json; default verifies all')
parser.add_argument('--smoke',action='store_true',help='Run three archived legal decision examples')
args=parser.parse_args()
torch.set_num_threads(1)
models=json.loads((ROOT/'models/manifest.json').read_text())
if args.model:
    models=[entry for entry in models if entry['id']==args.model]
    if not models:parser.error('Unknown model id')
examples=[]
if args.smoke:
    with gzip.open(ROOT/'examples/decisions.json.gz','rt') as stream:examples=json.load(stream)
for entry in models:
    path=ROOT/entry['file']
    with path.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
    if digest!=entry['sha256']:raise ValueError('Checkpoint checksum mismatch: '+entry['id'])
    saved=torch.load(path,map_location='cpu',weights_only=False)
    policy_class=legacy.EntityPolicy if saved["schema"]=="entities-v6" else EntityPolicy
    prepare_batch=legacy.collate if saved["schema"]=="entities-v6" else collate
    selected_examples=[json.loads((ROOT/"examples/online-v6.json").read_text())] if saved["schema"]=="entities-v6" and args.smoke else examples
    model,vocabulary=policy_class.restore(saved)
    model.eval()
    results=[]
    with torch.inference_mode():
        for observation in selected_examples:
            logits,value=model(prepare_batch([observation],vocabulary,'cpu'))
            count=len(observation['candidates'])
            assert logits.shape[1]==count and torch.isfinite(logits).all() and torch.isfinite(value).all()
            results.append({'candidates':count,'choice':int(logits.argmax(-1)[0]),'value':float(value[0])})
    print(json.dumps({'id':entry['id'],'sha256':digest,'config':saved['config'],'vocabulary':len(vocabulary.symbols),'optimizer_saved':'optimizer' in saved,'inference':results},ensure_ascii=False),flush=True)
