"""Offline tests: python3 tests/business-fetch-mnli.test.py."""
import hashlib
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location(
    "fetch_mnli", Path(__file__).resolve().parents[1] / "eval/business/fetch-mnli.py"
)
fetcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetcher)
digest = lambda data: hashlib.sha256(data).hexdigest()


class FetchMnliTests(unittest.TestCase):
    def test_bounded_verified_publication_is_exclusive_and_cleans_failures(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "member"
            for data, size, sha in [(b"long", 3, digest(b"lon")), (b"short", 6, digest(b"short")), (b"bad", 3, digest(b"yes"))]:
                with self.assertRaises(ValueError):
                    fetcher.copy_verified(io.BytesIO(data), target, size, sha)
                self.assertEqual(list(Path(directory).iterdir()), [])
            fetcher.copy_verified(io.BytesIO(b"yes"), target, 3, digest(b"yes"))
            with self.assertRaises(FileExistsError):
                fetcher.copy_verified(io.BytesIO(b"new"), target, 3, digest(b"new"))
            self.assertEqual(target.read_bytes(), b"yes")
            self.assertEqual(list(Path(directory).iterdir()), [target])

    def run_fixture(self, directory, duplicate=False):
        cache = Path(directory)
        name = "multinli_1.0_dev_matched.jsonl"
        data = b'{"gold_label":"neutral"}\n'
        archive = cache / "multinli_1.0.zip"
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr("multinli_1.0/" + name, data)
            zipped.writestr("multinli_1.0/multinli_1.0_train.jsonl", b"not selected")
            zipped.writestr("../escape", b"never extracted")
            if duplicate:
                with self.assertWarns(UserWarning):
                    zipped.writestr("multinli_1.0/" + name, data)
        with patch.object(fetcher, "ARCHIVE_BYTES", archive.stat().st_size), patch.object(fetcher, "ARCHIVE_SHA", digest(archive.read_bytes())), patch.object(fetcher, "MEMBERS", {"dev_matched": (len(data), digest(data))}), patch.object(sys, "argv", ["fetch-mnli.py", "--cache", directory]), patch.object(fetcher.urllib.request, "urlopen", side_effect=AssertionError("Unexpected network")):
            if duplicate:
                with self.assertRaisesRegex(ValueError, "path/size"):
                    fetcher.main()
                self.assertFalse((cache / name).exists())
                return
            fetcher.main()
            fetcher.main()  # Idempotent, offline, does not rewrite verified members.
            self.assertEqual((cache / name).read_bytes(), data)
            self.assertEqual({p.name for p in cache.iterdir()}, {name, archive.name})
            (cache / name).write_bytes(b"x" * len(data))
            with self.assertRaisesRegex(ValueError, "SHA256"):
                fetcher.main()

    def test_extracts_only_fixed_selected_member_and_verifies_existing_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            self.run_fixture(directory)

    def test_rejects_duplicate_selected_member(self):
        with tempfile.TemporaryDirectory() as directory:
            self.run_fixture(directory, duplicate=True)

    def test_missing_archive_never_downloads_implicitly(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(sys, "argv", ["fetch-mnli.py", "--cache", directory]), patch.object(fetcher.urllib.request, "urlopen", side_effect=AssertionError("Unexpected network")):
            with self.assertRaises(SystemExit) as error:
                fetcher.main()
            self.assertEqual(error.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
