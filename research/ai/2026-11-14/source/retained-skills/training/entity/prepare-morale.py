"""Fork the deployed v6 policy into an isolated win-only morale curriculum."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import torch
from checkpoint_io import save_checkpoint
from migrate_capabilities import migrate

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('checkpoint', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--revision', required=True)
    args = parser.parse_args()
    source = torch.load(args.checkpoint, map_location='cpu', weights_only=False)
    script = "import {ACTION_CAPABILITY_SYMBOLS} from './src/ai/action-capability.js'; console.log(JSON.stringify(ACTION_CAPABILITY_SYMBOLS));"
    symbols = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', script], cwd=ROOT, text=True))
    result = migrate(source, symbols, args.revision)
    # A new curriculum owns its game count and seed stream, while keeping the
    # learned weights and Adam moments. No teacher refit and no shaped rewards.
    lineage = dict(checkpoint=str(args.checkpoint.resolve()),
                   sha256=hashlib.sha256(args.checkpoint.read_bytes()).hexdigest(),
                   source_round=source['rl']['rounds'], source_games=source.get('completed_games'),
                   migration=result['migration'], optimizer='preserved', reward='terminal-team-win-only')
    config = {**source['rl']['config'], 'games':192, 'batch':64, 'epochs':2,
              'seed':1111110000, 'curriculum':'scheduled', 'style':'win', 'style_weight':0.,
              'morale_weight':0., 'entropy_weight':.03}
    result.update(rule_variant='morale-only-v1', lineage=lineage, completed_games=0,
                  hero_coverage={}, validation_seeds=[], historical_checkpoint=None,
                  curriculum=None, rl=dict(rounds=0, config=config),
                  experiment='morale-only-v1-from-live-417', parent_checkpoint=str(args.checkpoint.resolve()))
    torch.manual_seed(config['seed'])
    import random
    random.seed(config['seed'])
    result.update(random_state=random.getstate(), torch_rng=torch.get_rng_state(), cuda_rng=[])
    save_checkpoint(args.output, result, dict(lineage=lineage, rule_variant=result['rule_variant'], learning=config))
    print(json.dumps(dict(output=str(args.output), lineage=lineage, learning=config)))


if __name__ == '__main__':
    main()
