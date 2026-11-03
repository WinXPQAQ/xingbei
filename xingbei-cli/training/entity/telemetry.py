import json
import os
from pathlib import Path
import subprocess
import threading
import time
class Telemetry:
    def __init__(self,directory):self.directory=directory;self.stop=threading.Event()
    def __enter__(self):
        self.thread=threading.Thread(target=self.sample,daemon=True);self.thread.start();return self
    def sample(self):
        while not self.stop.is_set():
            try:
                # Descendants of this controller only; exclude unrelated GPU services.
                rows=subprocess.check_output(['ps','-eo','pid=,ppid='],text=True).splitlines()
                descendants={os.getpid()}
                pairs=[tuple(map(int,r.split())) for r in rows]
                for _ in range(6):descendants.update(pid for pid,ppid in pairs if ppid in descendants)
                output=subprocess.check_output(['nvidia-smi','pmon','-s','um','-c','1'],text=True,timeout=10)
                processes=[]
                for line in output.splitlines():
                    parts=line.split()
                    if len(parts)>11 and parts[1].isdigit() and int(parts[1]) in descendants:
                        processes.append(dict(pid=int(parts[1]),sm=int(parts[3]) if parts[3].isdigit() else 0,memory=int(parts[9]) if parts[9].isdigit() else 0))
                with open(self.directory/'gpu.log','a') as f:f.write(json.dumps(dict(time=time.time(),processes=processes))+'\n')
            except Exception as error:
                with open(self.directory/'telemetry-errors.log','a') as f:f.write(str(error)+'\n')
            self.stop.wait(1)
    def __exit__(self,*args):self.stop.set();self.thread.join(timeout=12)
