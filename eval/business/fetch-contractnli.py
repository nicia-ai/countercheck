"""Cache pinned official train/dev ZIP members without fetching any test-gold bytes.

Run: python3 eval/business/fetch-contractnli.py [--output eval/data/business/contractnli]
The archive and its member offsets are immutable at the pinned Git commit. Only
train/dev, license, terms, and README ranges are requested, never the full ZIP.
"""

import argparse
import hashlib
import json
from pathlib import Path
import struct
import urllib.request
import zlib

REVISION = "eced6528dd3c1d14d73f9a87df8f7bdbc03126f9"
URL = f"https://raw.githubusercontent.com/stanfordnlp/contract-nli/{REVISION}/resources/contract-nli.zip"
ARCHIVE_BYTES = 65362913
# name, local-header offset, compressed bytes, expanded bytes, expanded SHA256
MEMBERS = [
    ("train.json", 776011, 1667134, 7608211, "dbceb356cd6203b35b27be94a5fa85e499a81c34c42c89ad53060b39f0257ba5"),
    ("dev.json", 509146, 264329, 1183107, "310af7d661d2ab50ee3700169cef524c75f39fb296bbf5a515c229eb0f42e68e"),
    ("LICENSE", 71, 5914, 18656, "9e5f1b3c610b9c2da5c313bf81d577a7d1acec686bdb0384edefa6df0f90cd94"),
    ("TERMS", 6063, 1544, 3664, "b86e5b9bd7d2c49fd0d60e1d0842b7f64746abc8b206451acbe9080027cc49c8"),
    ("README.md", 773554, 2377, 5561, "cd2b3e8afafbfa95b1d3613e438b173ab3c3c089162d15b9e329cf9c6bf86206"),
]


def byte_range(start, count):
    end = start + count - 1
    request = urllib.request.Request(URL, headers={
        "Range": f"bytes={start}-{end}", "Accept-Encoding": "identity",
        "User-Agent": "Countercheck-public-dataset-cache",
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status != 206 or response.headers.get("Content-Range") != f"bytes {start}-{end}/{ARCHIVE_BYTES}":
            raise ValueError("Server did not honor the exact bounded range; refusing full archive download")
        data = response.read(count + 1)
    if len(data) != count:
        raise ValueError("Range length mismatch")
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("eval/data/business/contractnli"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    provenance = {
        "revision": REVISION, "url": URL, "archive_bytes": ARCHIVE_BYTES,
        "download_method": "HTTP Range: only named train/dev, README, LICENSE, TERMS members; no test gold fetched",
        "members": {},
    }
    for name, offset, compressed, size, digest in MEMBERS:
        target = args.output / name
        if target.exists():
            if target.stat().st_size != size or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
                raise ValueError(f"Existing cache differs from pinned member: {name}")
        else:
            header = struct.unpack("<4s5H3L2H", byte_range(offset, 30))
            if header[0] != b"PK\x03\x04" or header[3] != 8 or header[7:9] != (compressed, size):
                raise ValueError("Pinned ZIP local header mismatch")
            encoded = byte_range(offset + 30 + header[-2] + header[-1], compressed)
            inflater = zlib.decompressobj(-15)
            data = inflater.decompress(encoded, size + 1)
            if len(data) != size or not inflater.eof or inflater.unused_data or hashlib.sha256(data).hexdigest() != digest:
                raise ValueError("Pinned ZIP member content mismatch")
            with target.open("xb") as output:
                output.write(data)
        provenance["members"][name] = {
            "sha256": digest, "bytes": size, "compressed_bytes": compressed,
            "archive_offset": offset,
        }
    metadata = args.output / "source.json"
    if metadata.exists():
        if json.loads(metadata.read_text()) != provenance:
            raise ValueError("Existing source provenance differs")
    else:
        with metadata.open("x") as output:
            output.write(json.dumps(provenance, indent=2) + "\n")
    print(json.dumps(provenance, indent=2))


if __name__ == "__main__":
    main()
