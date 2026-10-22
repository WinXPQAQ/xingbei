import asyncio
import unittest
import torch
from model import Policy
from rollout import collect
from league import configs


class LeagueTests(unittest.TestCase):
    def test_schedule_is_paired_and_unique(self):
        rows=configs(232200000,18,'left','right')
        self.assertEqual(len(rows),504)
        self.assertEqual(len({(r['seed'],r['lineup'],r['team'],r['start']) for r in rows}),504)
        self.assertTrue(all(r['seatPolicies'].count('left')==3 and r['seatPolicies'].count('right')==3 for r in rows))

    def test_distinct_networks_are_actually_used_for_their_seats(self):
        class Extreme(Policy):
            def __init__(self, direction):
                super().__init__(feature_encoding='decision-context-v6',separate_critic=True,baseline_version='v1.5')
                self.direction=direction
            def forward(self,*args):
                logits,values=super().forward(*args)
                scores=torch.arange(logits.shape[1],device=logits.device,dtype=logits.dtype).expand_as(logits)*self.direction
                return scores.masked_fill(~torch.isfinite(logits),float('-inf')),values
        async def run():
            torch.set_num_threads(1)
            a,b=Extreme(-1),Extreme(1)
            seen=set()
            def check(observation,row):
                expected=0 if row['actorPolicy']=='a' else len(row['actions'])-1
                self.assertEqual(row['choice'],expected)
                seen.add(row['actorPolicy'])
            await collect(a,[{'seed':252690002,'turnLimit':12,'seatPolicies':['a','b','b','a','a','b']}],1,'cpu',
                          greedy=True,retain=False,actor_models={'a':a,'b':b},on_choice=check)
            self.assertEqual(seen,{'a','b'})
        asyncio.run(run())

    def test_per_seat_routing_matches_single_network_rollout(self):
        async def run():
            torch.set_num_threads(1);torch.manual_seed(211)
            model=Policy(feature_encoding='decision-context-v6',separate_critic=True,baseline_version='v1.5')
            other=Policy(feature_encoding='decision-context-v6',separate_critic=True,baseline_version='v1.5')
            other.load_state_dict(model.state_dict())
            base=[{'seed':252690001,'seatPolicies':['model']*6}]
            _, a, _=await collect(model,base,1,'cpu',greedy=True,retain=False)
            _, b, _=await collect(model,[{**base[0],'seatPolicies':['a','b','b','a','a','b']}],1,'cpu',greedy=True,retain=False,actor_models={'a':model,'b':other})
            for field in ['winner','decisions','turns','kinds','terminated','truncated']:
                self.assertEqual(a[0][field],b[0][field])
        asyncio.run(run())


if __name__=='__main__': unittest.main()
