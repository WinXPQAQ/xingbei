"""Known six-hero opportunity-cost diagnostics; never a held-out win estimate."""
import json
from pathlib import Path
import subprocess
import torch
from model import batch
from encoding_candidate import seat_memory
from preservation import preservation_bias


def diagnose(model, device):
    fixtures=json.loads(subprocess.check_output(['node',str(Path(__file__).with_name('preservation_cases.mjs')), '--policy='+model.baseline_version]))
    results=[]
    model.eval()
    for fixture in fixtures:
        observation=fixture['observation']
        state,actions=seat_memory(model.feature_encoding).encode(0,observation)
        with torch.inference_mode():
            logits,_=model(*batch([{'state':state,'actions':actions,'baselineChoice':fixture['baselineChoice']}],device))
            probabilities=logits.softmax(-1)[0]
        choice=int(probabilities.argmax())
        penalized=[i for i,x in enumerate(preservation_bias(observation)) if x<0]
        results.append({'name':fixture['name'],'reverse':fixture['reverse'],'hero':fixture['spec']['hero'],
                        'preservationExpected':fixture['spec']['expected'],'choice':choice,
                        'unusedResourceChosen':choice in penalized,
                        'unusedResourceProbability':float(probabilities[penalized].sum()),
                        'uniqueAttackChosen':choice in fixture['uniqueIndices'],
                        'chosenCandidate':observation['candidates'][choice]})
    return results
