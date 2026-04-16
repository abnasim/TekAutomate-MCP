import sys, os, time, threading, json
sys.path.insert(0, r'c:\Users\u650455\Desktop\Tek_Automator\Tek_Automator\scope-executor')
os.chdir(r'c:\Users\u650455\Desktop\Tek_Automator\Tek_Automator\scope-executor')

from app.http_server import HTTPServerThread
import urllib.request

s = HTTPServerThread('localhost', 8765)
s.start()
time.sleep(2)
print("Server up")

def timed_run(label):
    body = json.dumps({'protocol_version':1,'action':'run_python','code':'print(42)','timeout_sec':10}).encode()
    req = urllib.request.Request('http://localhost:8765/run', data=body, headers={'Content-Type':'application/json'})
    t = time.time()
    r = urllib.request.urlopen(req, timeout=12)
    elapsed = time.time() - t
    data = json.loads(r.read())
    print(f"  {label}: {elapsed:.3f}s  ok={data['ok']}  out={data['stdout'].strip()}")

# Cold (worker spawns)
timed_run("cold")
# Warm runs
timed_run("warm1")
timed_run("warm2")
timed_run("warm3")

s.stop()
print("Done.")
