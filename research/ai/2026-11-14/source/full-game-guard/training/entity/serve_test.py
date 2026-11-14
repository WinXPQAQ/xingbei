import copy
import json
import threading
import unittest
from http.server import HTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import torch

from model import EntityPolicy, SCHEMA, Vocabulary
from serve import create_handler


class ServingTests(unittest.TestCase):
    def test_boolean_features_retry_and_invalid_request_recovery(self):
        observation = dict(schema=SCHEMA, question=0,
                           entities=[dict(kind='question', categorical={'type': 'action'},
                                          numbers={'completed': False}, refs={})],
                           candidates=[dict(kind='candidate', categorical={'type': 'finish'},
                                            numbers={}, refs={'question': [0]})])
        vocabulary = Vocabulary.fit([observation])
        torch.set_num_threads(1)
        model = EntityPolicy(len(vocabulary.symbols), width=16, layers=1).eval()
        identity = dict(schema=SCHEMA, architecture='entity', checkpointSha256='a' * 64)
        with HTTPServer(('127.0.0.1', 0), create_handler(model, vocabulary, identity)) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()

            def request(data):
                body = json.dumps(data).encode()
                try:
                    with urlopen(Request(f'http://127.0.0.1:{server.server_port}/choose', data=body)) as response:
                        return response.status, json.load(response)
                except HTTPError as error:
                    with error:
                        return error.code, json.load(error)

            try:
                data = dict(session='serving-regression-session', sequence=0, seat=0, observation=observation)
                first = request(data)
                self.assertEqual(first[0], 200)
                self.assertEqual(first[1]['choice'], 0)
                self.assertEqual(request(data), first)
                changed = {**data, 'seat': 1}
                self.assertEqual(request(changed)[0], 400)
                data['sequence'] = 1
                for invalid in ({'schema': 2}, {**observation, 'wire': 'sparse-v1'}):
                    self.assertEqual(request({**data, 'observation': invalid})[0], 400)
                invalid = copy.deepcopy(observation)
                invalid['candidates'][0]['refs']['question'] = [1]
                self.assertEqual(request({**data, 'observation': invalid})[0], 400)
                self.assertEqual(request(data)[0], 200)
            finally:
                server.shutdown()
                thread.join()


if __name__ == '__main__':
    unittest.main()
