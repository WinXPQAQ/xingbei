const core = require('/opt/codex/cua_node/lib/node_modules/playwright-core');
const launch = core.chromium.launch.bind(core.chromium);
core.chromium.launch = options => launch({ ...options, executablePath: '/usr/bin/chromium' });
module.exports = core;
