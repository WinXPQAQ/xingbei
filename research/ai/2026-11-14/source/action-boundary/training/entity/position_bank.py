"""Indexed replay storage with atomic, idempotent updates per completed round."""
from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3


class PositionBank:
    def __init__(self, legacy_path):
        self.legacy_path = Path(legacy_path)
        self.path = self.legacy_path.with_suffix('.sqlite3')
        with self.connection() as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            connection.execute('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT)')
            connection.execute('''CREATE TABLE IF NOT EXISTS positions (
                sequence INTEGER PRIMARY KEY, source_seed INTEGER NOT NULL,
                category TEXT NOT NULL, revision TEXT NOT NULL, heroes TEXT NOT NULL,
                payload TEXT NOT NULL, UNIQUE(source_seed, category))''')
            connection.execute('CREATE INDEX IF NOT EXISTS category_order ON positions(category, sequence)')
            if not connection.execute("SELECT 1 FROM metadata WHERE key='imported'").fetchone():
                with self.legacy_path.open() as source:
                    self.write(connection, (json.loads(line) for line in source if line.strip()))
                connection.execute("INSERT INTO metadata VALUES ('imported', '1')")

    @contextmanager
    def connection(self):
        connection = sqlite3.connect(self.path, timeout=60)
        try:
            yield connection
        finally:
            connection.close()

    @staticmethod
    def write(connection, positions):
        connection.executemany('''INSERT INTO positions(source_seed, category, revision, heroes, payload)
            VALUES (?, ?, ?, ?, ?) ON CONFLICT(source_seed, category) DO UPDATE SET
            revision=excluded.revision, heroes=excluded.heroes, payload=excluded.payload''',
            ((p['sourceSeed'], p['category'], p['revision'], json.dumps(p['config'].get('heroIds', [])),
              json.dumps(p, separators=(',', ':'))) for p in positions))

    def __iter__(self):
        with self.connection() as connection:
            rows = connection.execute('''SELECT sequence, source_seed, category, revision, heroes
                FROM positions ORDER BY sequence''').fetchall()
        return iter(dict(position_id=row[0], sourceSeed=row[1], category=row[2], revision=row[3],
                         config=dict(heroIds=json.loads(row[4]))) for row in rows)

    def resolve(self, entry):
        with self.connection() as connection:
            row = connection.execute('SELECT payload FROM positions WHERE sequence=?',
                                     (entry['position_id'],)).fetchone()
        if row is None:
            raise ValueError('Selected replay position disappeared')
        return json.loads(row[0])

    def merge(self, games):
        positions = ({**boundary, 'sourceSeed': game['seed']}
                     for game in games for boundary in game.get('boundaries', []))
        with self.connection() as connection, connection:
            self.write(connection, positions)
            for category in ('ending', 'middle'):
                connection.execute('''DELETE FROM positions WHERE category=? AND sequence NOT IN
                    (SELECT sequence FROM positions WHERE category=? ORDER BY sequence DESC LIMIT 10000)''',
                    (category, category))
