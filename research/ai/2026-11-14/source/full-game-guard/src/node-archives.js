// Node-only persistence. Shared rules never import filesystem APIs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
export function installInabilityArchiveWriter(game, directory = process.env.XINGBEI_DIAGNOSTIC_DIR || path.join(os.homedir(),'.local/share/xingbei-logs/inability')) {
  game.onInabilityArchive=archive=>{
    fs.mkdirSync(directory,{recursive:true});
    const file=path.join(directory,`inability-${Date.now()}-${process.pid}-${game.inabilityArchives.length}.json`);
    fs.writeFileSync(file,JSON.stringify(archive,null,2),{flag:'wx'});
  };
}
