"""Minimal contracts for source-disjoint critic training and rollback."""
import copy
import unittest
from unittest.mock import patch

import torch
from torch import nn

from critic import fit_critic, group_rows, source_fraction
from learning import make_optimizers, parameter_groups
from model import EntityPolicy, SCHEMA, Vocabulary, collate
from reinforce import update
from migrate_capabilities import migrate


class TinyPolicy(nn.Module):
    def __init__(self):
        super().__init__()
        self.actor = nn.Linear(1, 1)
        self.score = nn.Linear(1, 1)
        self.critic = nn.Linear(1, 1, bias=False)
        self.value = nn.Linear(1, 1)
        self.value_scale = 1.
        with torch.no_grad():
            self.critic.weight.fill_(1.)
            self.value.weight.zero_()
            self.value.bias.zero_()

    def value_logits(self, batch):
        return self.value(self.critic(batch)).squeeze(-1)


class TinyPrepared:
    def __init__(self, observations, vocabulary):
        pass

    def collate(self, observations, device):
        return torch.tensor(observations, dtype=torch.float32, device=device)


def rows(conflicting=False):
    result = []
    for source in range(40):
        reward = -1 if source % 2 else 1
        if conflicting:
            reward = -1 if source_fraction(source) < .2 else 1
        result.append(dict(source_seed=source, game_id=source, seat=0,
                           learning=dict(requestId=1), observation=[1. if conflicting else reward],
                           return_=reward, terminal_return=reward, potential=0))
        result[-1]['return'] = result[-1].pop('return_')
    return result


class CriticTests(unittest.TestCase):
    def test_capability_migration_keeps_predictions_and_optimizer_history(self):
        torch.manual_seed(13)
        original = dict(schema=SCHEMA, question=0, entities=[
            dict(kind='player', categorical=dict(hero='berserker'), numbers=dict(handCount=3), refs={}),
        ], candidates=[dict(kind='candidate', categorical=dict(type='attack'), numbers={}, refs={'owner': [0]})])
        vocabulary = Vocabulary.fit([original])
        model = EntityPolicy(len(vocabulary.symbols), width=8, layers=1).eval()
        optimizers = make_optimizers(model)
        sum(parameter.square().sum() for parameter in model.parameters()).backward()
        for optimizer in optimizers.values():
            optimizer.step()
            optimizer.zero_grad()
        saved = model.checkpoint(vocabulary)
        saved.update(schema='entities-v6', revision='before',
                     optimizer={key: opt.state_dict() for key, opt in optimizers.items()})
        migrated = migrate(saved, ['number:ownActionCapacity'], 'after')
        restored, extended_vocab = EntityPolicy.restore(migrated)
        restored.eval()
        extended = copy.deepcopy(original)
        extended['entities'][0]['numbers']['ownActionCapacity'] = 42
        with torch.no_grad():
            before = model(collate([original], vocabulary))
            after = restored(collate([extended], extended_vocab))
        for expected, actual in zip(before, after):
            self.assertTrue(torch.equal(expected, actual))
        restored_optimizers = make_optimizers(restored)
        for key, optimizer in restored_optimizers.items():
            optimizer.load_state_dict(migrated['optimizer'][key])
            for parameter, state in optimizer.state.items():
                self.assertEqual(state['exp_avg'].shape, parameter.shape)
                self.assertEqual(state['step'].item(), 1)
        self.assertEqual(saved['schema'], 'entities-v6')
        self.assertEqual(extended_vocab.symbols[:-1], vocabulary.symbols)
        self.assertEqual(migrated['revision'], 'after')

    def test_grouped_critic_runs_after_actor_kl_stop_and_restores_legacy_value(self):
        torch.set_num_threads(2)
        torch.manual_seed(41)
        data = rows()
        for row in data:
            own_morale = 12 if row['return'] == 1 else 3
            row['observation'] = dict(schema=SCHEMA, question=2, entities=[
                dict(kind='team', categorical=dict(team='own'),
                     numbers=dict(morale=own_morale), refs={}),
                dict(kind='team', categorical=dict(team='opponent'),
                     numbers=dict(morale=15-own_morale), refs={}),
                dict(kind='question', categorical=dict(type='action', stage='complete'),
                     numbers={}, refs={}),
            ], candidates=[
                dict(kind='candidate', categorical=dict(type='purchase'), numbers={}, refs={}),
                dict(kind='candidate', categorical=dict(type='synthesize'), numbers={}, refs={}),
            ])
            # A formerly unlikely legal choice now exceeds the KL limit.
            row.update(choice=0, old_log_prob=-20., old_value=0., advantage=row['return'])
        vocabulary = Vocabulary.fit(row['observation'] for row in data)
        model = EntityPolicy(len(vocabulary.symbols), width=8, layers=1).eval()
        batch = collate([row['observation'] for row in data[:2]], vocabulary)
        with torch.no_grad():
            legacy_values = model.value(model.critic(batch, with_actions=False)).squeeze(-1)
            legacy_logits = model.policy_logits(batch)
            restored, restored_vocabulary = EntityPolicy.restore(copy.deepcopy(model.checkpoint(vocabulary)))
            restored.eval()
            restored_logits, restored_values = restored(batch)
            self.assertTrue(torch.equal(restored_logits, legacy_logits))
            self.assertTrue(torch.equal(restored_values, legacy_values))
            self.assertTrue(torch.equal(restored.value_logits(batch).tanh(), legacy_values))
            self.assertEqual(restored_vocabulary.symbols, vocabulary.symbols)
        optimizer = make_optimizers(restored, actor_lr=.001, critic_lr=.001)
        actor_before = [parameter.detach().clone() for parameter in parameter_groups(restored)['actor']]
        result = update(restored, vocabulary, optimizer, data, batch_size=8, epochs=2,
                        device='cpu', target_kl=.001, critic_mode='grouped',
                        critic_updates=8, critic_loss='bce')
        self.assertTrue(result['stopped_early'])
        self.assertEqual(result['actor_updates'], 0)
        self.assertEqual(optimizer['actor'].state_dict()['state'], {})
        self.assertEqual(result['critic_updates'], 8)
        self.assertFalse(result['critic']['skipped'])
        self.assertEqual(result['critic']['train_sources']+result['critic']['validation_sources'], 40)
        for parameter, original in zip(parameter_groups(restored)['actor'], actor_before):
            self.assertTrue(torch.equal(parameter, original))

    def test_source_grouping_and_small_sample_skip(self):
        data = rows()[:1]
        repeated = {**data[0], 'game_id': 100, 'seat': 3}
        grouped = group_rows(data + [repeated])
        self.assertEqual(len(grouped), 1)
        self.assertEqual(len(grouped[data[0]['source_seed']]), 2)
        model = TinyPolicy()
        optimizer = torch.optim.AdamW(list(model.critic.parameters())+list(model.value.parameters()))
        result = fit_critic(model, None, optimizer, data, 8, 'cpu')
        self.assertTrue(result['skipped'])
        self.assertEqual(result['updates'], 0)

    @patch('critic.PreparedObservations', TinyPrepared)
    def test_best_validation_restores_weights_and_optimizer(self):
        model = TinyPolicy()
        optimizer = torch.optim.AdamW(list(model.critic.parameters())+list(model.value.parameters()), lr=.05)
        before = copy.deepcopy(model.state_dict())
        result = fit_critic(model, None, optimizer, rows(conflicting=True), 8, 'cpu')
        self.assertEqual(result['updates'], 32)
        self.assertEqual(result['best_update'], 0)
        self.assertEqual(optimizer.state_dict()['state'], {})
        for name, value in model.state_dict().items():
            self.assertTrue(torch.equal(value, before[name]), name)

    @patch('critic.PreparedObservations', TinyPrepared)
    def test_bce_and_mse_improve_without_actor_update(self):
        for loss in ('bce', 'mse'):
            model = TinyPolicy()
            actor = copy.deepcopy(model.actor.state_dict())
            optimizer = torch.optim.AdamW(list(model.critic.parameters())+list(model.value.parameters()), lr=.03)
            result = fit_critic(model, None, optimizer, rows(), 8, 'cpu', loss=loss)
            self.assertGreater(result['best_update'], 0)
            self.assertLess(result['validation_after']['mse'], result['validation_before']['mse'])
            self.assertEqual(result['source_overlap'], 0)
            self.assertEqual(result['train_sources']+result['validation_sources'], 40)
            for name, value in model.actor.state_dict().items():
                self.assertTrue(torch.equal(value, actor[name]))
            steps = [int(state['step']) for state in optimizer.state.values()]
            self.assertEqual(set(steps), {result['best_update']})


if __name__ == '__main__':
    unittest.main()
