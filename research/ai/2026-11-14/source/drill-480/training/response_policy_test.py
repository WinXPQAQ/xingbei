import unittest
from response_policy import prefer_ordinary_response


class ResponsePolicyTest(unittest.TestCase):
    def fixture(self):
        def card(skills, element='water', name='waterStrike'):
            return {'type':'attack','name':name,'elements':[element],'uniqueSkills':skills}
        return {'request':{'type':'response'},'players':[{'skills':['waterSeal']}], 'candidates':[
            {'type':'decline'},
            {'type':'response','target':2,'card':card(['waterSeal'])},
            {'type':'response','target':3,'card':card([])},
            {'type':'response','target':2,'card':card(['galeArt'])},
            {'type':'response','target':2,'card':card([], 'fire','fireStrike')}]}

    def test_same_element_target_and_current_hero_only(self):
        obs=self.fixture()
        self.assertEqual(prefer_ordinary_response(obs,1),3)
        self.assertEqual(prefer_ordinary_response(obs,0),0)
        self.assertEqual(prefer_ordinary_response(obs,3),3)
        obs['players'][0]['skills']=['waterPower'] # Priest has no such unique skill.
        self.assertEqual(prefer_ordinary_response(obs,1),1)

    def test_no_alternative_or_holy_light_dark_or_action_unchanged(self):
        obs=self.fixture();obs['candidates'].pop(3)
        self.assertEqual(prefer_ordinary_response(obs,1),1)
        for name,element,type_ in [('darkStrike','dark','attack'),('holyLight','light','spell')]:
            obs=self.fixture();obs['candidates'][1]['card'].update(name=name,elements=[element],type=type_)
            self.assertEqual(prefer_ordinary_response(obs,1),1)
        obs=self.fixture();obs['request']['type']='action'
        self.assertEqual(prefer_ordinary_response(obs,1),1)

    def test_all_implemented_hero_labels_even_active_precision(self):
        for skill in ['bloodyRoar','galeArt','precisionShot','fireSeal','angelWall']:
            obs=self.fixture();obs['players'][0]['skills']=[skill]
            obs['candidates'][1]['card']['uniqueSkills']=[skill]
            obs['candidates'][3]['card']['uniqueSkills']=[]
            self.assertEqual(prefer_ordinary_response(obs,1),3)


if __name__=='__main__':unittest.main()
