import json
from pathlib import Path
import subprocess
import unittest
from preservation import preservation_bias, hero_unique_skills


class PreservationTests(unittest.TestCase):
    def test_only_current_hero_unique_labels_count(self):
        card={'type':'attack','name':'waterStrike','elements':['water'],'uniqueSkills':['angelWall']}
        self.assertEqual(hero_unique_skills(card,{'hero':'priest','skills':['waterPower']}),set())
        self.assertEqual(hero_unique_skills(card,{'hero':'guardianAngel','skills':['angelWall','angelBlessing']}),{'angelWall'})
        self.assertEqual(hero_unique_skills({**card,'uniqueSkills':[]},{'hero':'guardianAngel','skills':['angelBlessing']}),set())
        self.assertEqual(hero_unique_skills({**card,'name':'darkStrike','elements':['dark'],'uniqueSkills':[]},{'hero':'berserker'}),set())

    def test_real_six_hero_candidates_and_active_skill_exceptions(self):
        cases=json.loads(subprocess.check_output(['node',str(Path(__file__).with_name('preservation_cases.mjs'))]))
        self.assertEqual(len({c['spec']['hero'] for c in cases}),6)
        for case in cases:
            bias=preservation_bias(case['observation'])
            with self.subTest(case=case['name'],reverse=case['reverse']):
                self.assertEqual(any(bias[i]<0 for i in case['uniqueIndices']),case['spec']['expected'])
                for i,candidate in enumerate(case['observation']['candidates']):
                    if candidate['type'] not in ('play','response'):self.assertEqual(bias[i],0)
        refine={'players':[{'hero':'priest','energy':{'gem':0,'crystal':0}}],
                'request':{'type':'action'},'candidates':[{'type':'refine','stones':{'gem':2,'crystal':0}}]}
        self.assertEqual(preservation_bias(refine),[0])


if __name__=='__main__':unittest.main()
