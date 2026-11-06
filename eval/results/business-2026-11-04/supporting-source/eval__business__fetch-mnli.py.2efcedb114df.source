"""Cache pinned MultiNLI 1.0; extract only --split (default dev_matched).

Run: python3 eval/business/fetch-mnli.py [--download] [--split train]
Without --download an existing verified archive is required; no network is used.
"""
import argparse
import hashlib
import os
from pathlib import Path
import tempfile
import urllib.request
import zipfile

URL = "https://cims.nyu.edu/~sbowman/multinli/multinli_1.0.zip"
ARCHIVE_BYTES = 226850426
ARCHIVE_SHA = "049f507b9e36b1fcb756cfd5aeb3b7a0cfcb84bf023793652987f7e7e0957822"
MEMBERS = {
    "dev_matched": (12925073, "9db14e02591c51b7c0401802382f01602ce97c21697a68a263f8c4b5958229a6"),
    "dev_mismatched": (13460535, "65f3a993919f6a26f1468145a7ea2a7d8f5da175f1fee93a14315ba4fda0fd0e"),
    "train": (492421641, "e440e582329a812feca8fedfed2dc6932aaddd99aad32bf894b4c3a2d4206032"),
}


def copy_verified(source, target, size, digest):
    """Verify bounded bytes before atomically installing, never overwrite a cache."""
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as output:
            temporary = Path(output.name)
            actual, hashed = 0, hashlib.sha256()
            while chunk := source.read(min(1024 * 1024, size - actual + 1)):
                actual += len(chunk)
                if actual > size:
                    raise ValueError("Source exceeds pinned byte count")
                hashed.update(chunk)
                output.write(chunk)
            if actual != size or hashed.hexdigest() != digest:
                raise ValueError("Pinned content size/SHA256 mismatch")
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary, target)  # Atomic, exclusive publication on the same filesystem.
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def verify(path, size, digest):
    hashed = hashlib.sha256()
    if path.stat().st_size != size:
        raise ValueError("Existing cache has wrong size")
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            hashed.update(chunk)
    if hashed.hexdigest() != digest:
        raise ValueError("Existing cache has wrong SHA256")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--split", choices=MEMBERS, default="dev_matched")
    parser.add_argument("--cache", type=Path, default=Path("eval/data/business"))
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    archive = args.cache / "multinli_1.0.zip"
    if not archive.exists():
        if not args.download:
            parser.error("Missing cached archive; use --download to fetch the official release")
        request = urllib.request.Request(URL, headers={"Accept-Encoding": "identity"})
        with urllib.request.urlopen(request, timeout=120) as source:
            if source.status != 200:
                raise ValueError("Official archive download failed")
            length = source.headers.get("Content-Length")
            if length is not None and int(length) != ARCHIVE_BYTES:
                raise ValueError("Archive Content-Length differs from pinned bytes")
            copy_verified(source, archive, ARCHIVE_BYTES, ARCHIVE_SHA)
    verify(archive, ARCHIVE_BYTES, ARCHIVE_SHA)
    size, digest = MEMBERS[args.split]
    name = f"multinli_1.0_{args.split}.jsonl"
    target = args.cache / name
    with zipfile.ZipFile(archive) as zipped:
        member = f"multinli_1.0/{name}"
        matches = [item for item in zipped.infolist() if item.filename == member]
        if len(matches) != 1 or matches[0].file_size != size:
            raise ValueError("Pinned ZIP member path/size mismatch")
        if target.exists():
            verify(target, size, digest)
        else:
            with zipped.open(matches[0]) as source:
                copy_verified(source, target, size, digest)
    print(f"Verified {target}: {size} bytes, SHA256 {digest}")


if __name__ == "__main__":
    main()
