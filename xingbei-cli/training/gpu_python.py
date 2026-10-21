"""Run the isolated GPU venv, without changing global drivers or library paths.

Prefer the system driver after a reboot. While the old kernel module is still
loaded, use only the matching library extracted from the signed Ubuntu package.
"""
import os
import pathlib
import re
import subprocess
import sys

root = pathlib.Path(os.environ.get('XINGBEI_ML_ROOT', pathlib.Path.home() / '.local/share/xingbei-ml'))
python = root / 'venv-gpu/bin/python'
if not python.exists():
    raise SystemExit(f'GPU environment missing: {python}')
environment = os.environ.copy()
query = ['nvidia-smi', '--query-gpu=name', '--format=csv,noheader']
if subprocess.run(query, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
    version = re.search(r'Kernel Module[^\n]*?\b(\d{3}\.\d+(?:\.\d+)?)\b', pathlib.Path('/proc/driver/nvidia/version').read_text())
    library = root / 'gpu-diagnostic/root/usr/lib/x86_64-linux-gnu'
    if not version or not (library / f'libcuda.so.{version[1]}').exists():
        raise SystemExit('No locally verified library matching the currently loaded GPU kernel driver')
    environment['LD_LIBRARY_PATH'] = str(library) + (':' + environment['LD_LIBRARY_PATH'] if environment.get('LD_LIBRARY_PATH') else '')
    if subprocess.run(query, env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        raise SystemExit('Matching isolated GPU library did not pass NVML initialization')
os.execve(python, [str(python), *sys.argv[1:]], environment)
