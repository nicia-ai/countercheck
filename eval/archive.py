"""Extract only requested public dataset members; never unpack an archive tree."""
import argparse
import pathlib
import tarfile
import zipfile

p = argparse.ArgumentParser()
p.add_argument('archive')
p.add_argument('directory')
p.add_argument('dataset', choices=['scifact', 'vitaminc'])
p.add_argument('split', choices=['train', 'dev', 'test'])
a = p.parse_args()
out = pathlib.Path(a.directory)
out.mkdir(parents=True, exist_ok=True)
names = [f'claims_{a.split}.jsonl', 'corpus.jsonl'] if a.dataset == 'scifact' else [f'{a.split}.jsonl']
limit = 512 * 1024 * 1024
if a.dataset == 'scifact':
    with tarfile.open(a.archive, 'r:gz') as archive:
        for name in names:
            matches = [m for m in archive.getmembers() if pathlib.PurePosixPath(m.name).name == name and m.isfile()]
            if len(matches) != 1 or matches[0].size > limit:
                raise SystemExit('Ambiguous or oversized archive member')
            member = archive.extractfile(matches[0])
            if member is None:
                raise SystemExit('Missing archive member')
            (out / name).write_bytes(member.read(limit + 1))
else:
    with zipfile.ZipFile(a.archive) as archive:
        for name in names:
            matches = [m for m in archive.infolist() if pathlib.PurePosixPath(m.filename).name == name and not m.is_dir()]
            if len(matches) != 1 or matches[0].file_size > limit:
                raise SystemExit('Ambiguous or oversized archive member')
            (out / name).write_bytes(archive.read(matches[0]))
