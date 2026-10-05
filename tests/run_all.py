"""Run every check in this folder: .venv/Scripts/python.exe tests/run_all.py

They need no network, no database and place no calls - fakes stand in for the model,
the voice and the telephony. Written while building the features they cover.
"""
import pathlib
import subprocess
import sys

here = pathlib.Path(__file__).parent
failed = []
for path in sorted(here.glob("*_test.py")):
    print("=" * 70)
    print(path.name)
    result = subprocess.run([sys.executable, str(path)], cwd=here.parent)
    if result.returncode != 0:
        failed.append(path.name)
print("=" * 70)
print("FAILED:", ", ".join(failed) if failed else "nothing")
sys.exit(1 if failed else 0)
