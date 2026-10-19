import os,pty,select,subprocess,time,json
master,slave=pty.openpty()
p=subprocess.Popen(['node','src/cli.js','0'],stdin=slave,stdout=slave,stderr=slave)
os.close(slave)
raw=b''
def until(text):
 global raw
 deadline=time.time()+15; block=b''
 while time.time()<deadline:
  ready,_,_=select.select([master],[],[],.2)
  if ready:
   b=os.read(master,65536);raw+=b;block+=b
   if text.encode() in block:return block.decode(errors='replace')
 raise RuntimeError('missing prompt '+text)
until('开局选择角色>');os.write(master,b'0\r');until('行动>');os.write(master,b'end\r');after=until('行动>');assert '红一回合结束' not in after
os.write(master,b'quit\r')
deadline=time.time()+10
while p.poll() is None and time.time()<deadline:
 ready,_,_=select.select([master],[],[],.2)
 if ready:
  try:raw+=os.read(master,65536)
  except OSError:break
p.wait(timeout=2)
try:
 while True:raw+=os.read(master,65536)
except OSError:pass
assert p.returncode==0
assert b'RuleError' not in raw
with open('artifacts/ai/mandatory-refresh/cli-smoke.json','w') as f:json.dump({'exitCode':p.returncode,'ordinaryEndKeepsActionPrompt':True,'quitDoesNotEndTurn':True,'scope':'PTY actual CLI initial human turn; no complete game or visual acceptance'},f,indent=2)
