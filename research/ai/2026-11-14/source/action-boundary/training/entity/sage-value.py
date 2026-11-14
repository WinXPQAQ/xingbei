"""Read the empirical f(light,dark,sorted five counts) for a fixed drill policy."""
import argparse
import json
from pathlib import Path


def estimate_sage_hand(table, x, y, a, b, c, d, e):
    counts=[x,y,a,b,c,d,e]
    if any(type(n) is not int or n<0 for n in counts) or sum(counts)!=6:
        raise ValueError('Expected seven nonnegative integer counts totaling six')
    signature=[x,y,*sorted([a,b,c,d,e],reverse=True)]
    direct=max(0,sum(n>0 for n in signature)-1)
    row=table['values'].get(','.join(map(str,signature)))
    return dict(signature=signature,policy_round=table['policy_round'],direct_damage=direct,
                estimate=row,needs_more_samples=row is None or row['samples']<30,
                interpretation='Fixed 2 healing, 1 gem, full unprotected target. Empirical policy outcome, not optimal or guaranteed damage.')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('table',type=Path);parser.add_argument('counts',type=int,nargs=7)
    args=parser.parse_args()
    print(json.dumps(estimate_sage_hand(json.loads(args.table.read_text()),*args.counts),ensure_ascii=False,indent=2))
