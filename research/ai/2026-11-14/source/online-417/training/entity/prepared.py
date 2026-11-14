"""Round-local CPU tensor cache reused across shuffled PPO epochs."""
from model import prepare_observation, collate_prepared


class PreparedObservations:
    def __init__(self, observations, vocabulary):
        self.items = {}
        for observation in observations:
            key = id(observation)
            if key not in self.items:
                self.items[key] = prepare_observation(observation, vocabulary)

    def collate(self, observations, device):
        entries = [self.items[id(observation)] for observation in observations]
        return collate_prepared(entries, device)
