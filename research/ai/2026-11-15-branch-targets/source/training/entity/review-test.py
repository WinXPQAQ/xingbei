"""Fixed regression test from the user's reviewed candidates (not used for training).

For every reviewed decision view, the stored observation is scored by each
checkpoint. Reports: probability on candidates marked good / bad, pairwise
accuracy (a good candidate scores above a bad one in the same view) and, for
views with a stated reason, per-view detail.

    python review-test.py EVENTS.jsonl.gz REVIEWS.json --models a=a.pt b=b.pt [--output out.json]
"""
import argparse
import collections
import gzip
import json
from pathlib import Path

import torch

from model import EntityPolicy, collate


def load(path):
    return EntityPolicy.restore(torch.load(path, map_location='cpu', weights_only=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('events', type=Path)
    parser.add_argument('reviews', type=Path)
    parser.add_argument('--models', nargs='+', required=True, help='label=path')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    with gzip.open(args.events, 'rt', encoding='utf-8') as stream:
        events = {item['sequence']: item['event'] for item in map(json.loads, stream)}
    reviews = json.loads(args.reviews.read_text())
    views = collections.defaultdict(list)
    for review in reviews:
        vote = review['feedback'].get('vote')
        score = review['feedback'].get('score')
        label = 'good' if vote == 'good' or (score is not None and score >= 5) else 'bad' if vote == 'bad' or score == 0 else None
        if label and review.get('candidateIndex') is not None:
            views[review['sequence']].append((review['candidateIndex'], label, review['feedback'].get('comment') or ''))
    report = {}
    for item in args.models:
        name, path = item.split('=', 1)
        model, vocabulary = load(path)
        model.eval()
        good, bad, pairs, correct, detail = [], [], 0, 0, []
        for sequence, marks in sorted(views.items()):
            observation = events[sequence]['observation']
            with torch.no_grad():
                logits = model.policy_logits(collate([observation], vocabulary))[0]
            probabilities = logits[torch.isfinite(logits)].softmax(-1).tolist()
            stored = events[sequence].get('probabilities')
            for index, label, _ in marks:
                (good if label == 'good' else bad).append(probabilities[index])
            for gi, gl, _ in marks:
                for bi, bl, _ in marks:
                    if gl == 'good' and bl == 'bad':
                        pairs += 1; correct += int(probabilities[gi] > probabilities[bi])
            if any(comment for _, _, comment in marks):
                detail.append(dict(sequence=sequence, request=events[sequence]['request'].get('type'),
                    stage=events[sequence]['request'].get('stage'), skill=events[sequence]['request'].get('skillId'),
                    marks=[dict(index=i, label=l, probability=round(probabilities[i], 3),
                                recorded=round(stored[i], 3) if stored else None, comment=c) for i, l, c in marks]))
        mean = lambda values: round(sum(values) / len(values), 3) if values else None
        report[name] = dict(path=path, views=len(views), good=len(good), bad=len(bad), mean_good=mean(good), mean_bad=mean(bad),
                            pairs=pairs, pairwise_accuracy=round(correct / pairs, 3) if pairs else None, detail=detail)
        print(name, json.dumps({k: v for k, v in report[name].items() if k not in ('detail', 'path')}, ensure_ascii=False))
    if args.output:
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
