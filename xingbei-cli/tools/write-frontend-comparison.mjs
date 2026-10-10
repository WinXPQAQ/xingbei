// Build an evidence viewer from existing captures; does not change either game.
import { readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(process.argv[2] || "xingbei-cli/artifacts/frontend/restoration/2026-10-10");
const originalFolder = process.argv[3] || "original-expanded";
const currentFolder = process.argv[4] || "validated";
const views = ["1440x900", "1280x720", "844x390", "390x844"];
const regions = [["#arena", "#arena"], ["#arena > .player", ".player"], [".avatar", ".avatar"], ["#handcards1 .card", "#hand .card"], [".zhanJi", ".zhanJi"]];
const measurements = [];
for (const viewport of views) {
  const original = JSON.parse(await readFile(resolve(root, originalFolder, `opening-${viewport}.json`), "utf8"));
  const current = JSON.parse(await readFile(resolve(root, currentFolder, `opening-${viewport}.json`), "utf8"));
  measurements.push({ viewport, regions: regions.map(([oldKey, newKey]) => ({ name: newKey, count: current.geometry[newKey].length,
    maxBoundaryDelta: Math.max(...original.geometry[oldKey].flatMap((node, index) => Object.keys(node.rect).map(key => Math.abs(node.rect[key] - current.geometry[newKey][index].rect[key])))),
  })) });
}
await writeFile(resolve(root, "geometry-comparison.json"), JSON.stringify(measurements, null, 2));
const mappings = [
  ["opening", "opening", "四人开局"], ["opening", "hand-4", "四张手牌"], ["hand-0", "hand-0", "零张手牌"], ["hand-1", "hand-1", "一张手牌"], ["hand-6", "hand-6", "六张手牌"],
  ["target", "target", "选牌与目标"], ["synthesize", "synthesize", "合成星石"], ["refine", "refine", "提炼星石"], ["statuses", "statuses", "状态标记"], ["end", "end", "结束"],
];
const scenes = [];
for (const [oldId, newId, label] of mappings) {
  for (const viewport of views) {
    const oldImage = `${originalFolder}/${oldId}-${viewport}.png`, newImage = `${currentFolder}/${newId}-${viewport}.png`;
    try {
      await access(resolve(root, oldImage)); await access(resolve(root, newImage));
      const original = JSON.parse(await readFile(resolve(root, originalFolder, `${oldId}-${viewport}.json`), "utf8"));
      const current = JSON.parse(await readFile(resolve(root, currentFolder, `${newId}-${viewport}.json`), "utf8"));
      scenes.push({ label: `${label} · ${viewport}`, oldImage, newImage, viewport, fixture: original.fixture || "原版自然进入", oldState: `${originalFolder}/${oldId}-${viewport}.json`, newState: `${currentFolder}/${newId}-${viewport}.json`, geometry: measurements.find(item => item.viewport === viewport), current: { phase: current.state.phase, handCount: current.state.game.players[0].hand.length } });
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
const result = JSON.parse(await readFile(resolve(root, currentFolder, "results.json"), "utf8"));
await writeFile(resolve(root, "compare.html"), `<!doctype html>
<html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>星杯传说 · 样式对照</title>
<style>body{margin:0;background:#202124;color:#eee;font:15px/1.6 system-ui}header{padding:16px 20px}h1{font-size:22px;margin:0}p{margin:8px 0;color:#ccc}a{color:#9bd1ff}select,button{font:inherit;padding:5px;background:#333;color:white;border:1px solid #777;border-radius:4px}label{margin-right:12px}input{vertical-align:middle}.controls{display:flex;flex-wrap:wrap;gap:12px;align-items:center}#stage{position:relative;width:100%;overflow:hidden}#stage img,#stage canvas{position:absolute;inset:0;width:100%;height:100%}#old{z-index:2}#line{position:absolute;top:0;bottom:0;left:50%;width:2px;background:#ffcb69;z-index:3;pointer-events:none}#diff{z-index:4;display:none}.badge{position:absolute;top:4px;background:#000b;padding:3px 8px;z-index:5;pointer-events:none}.badge.right{right:4px}.badge.left{left:4px}#details{padding:10px 20px}pre{white-space:pre-wrap;color:#bfe4bf}</style>
<header><h1>现有 2v2 对局样式对照</h1><p>左侧原版，右侧新版。两套引擎的阵营座次、角色技能和部分牌序不同；部分原版状态使用明确标注的运行时准备。这些差异不计为已还原，不使用全屏相似度作为通过率。</p><div class="controls"><label>场景 <select id="scene"></select></label><label>分界线 <input id="split" type="range" min="0" max="100" value="50"></label><button id="show-diff">显示像素差异</button><button id="download">下载差异图</button></div></header>
<div id="stage"><img id="new" alt="新版"><img id="old" alt="原版"><canvas id="diff"></canvas><div id="line"></div><span class="badge left">原版</span><span class="badge right">新版</span></div>
<div id="details"><p id="fixture"></p><p><a id="old-json">原版配置与测量</a> · <a id="new-json">新版状态与测量</a> · <a href="geometry-comparison.json">开局几何对照</a> · <a href="${currentFolder}/results.json">浏览器检查记录</a></p><p>浏览器检查 ${result.checks.length} 项；新增常规截图 ${result.captures.length} 张，重置复现截图另存。原始重置哈希和颜色波动保留在记录中。</p><pre id="metrics"></pre></div>
<script>
const scenes=${JSON.stringify(scenes)};
const select=document.querySelector('#scene'),old=document.querySelector('#old'),current=document.querySelector('#new'),canvas=document.querySelector('#diff'),stage=document.querySelector('#stage'),split=document.querySelector('#split');
for(const [index,scene] of scenes.entries())select.add(new Option(scene.label,index));
let diff=false,revision=0;
function divide(){old.style.clipPath='inset(0 '+(100-split.value)+'% 0 0)';document.querySelector('#line').style.left=split.value+'%'}
function load(img,src){return new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=src})}
async function update(){const token=++revision,scene=scenes[Number(select.value)];const [width,height]=scene.viewport.split('x').map(Number);stage.style.aspectRatio=width+'/'+height;document.querySelector('#fixture').textContent='原版准备：'+scene.fixture+'；新版阶段：'+scene.current.phase+'；本人手牌：'+scene.current.handCount+'张。';document.querySelector('#old-json').href=scene.oldState;document.querySelector('#new-json').href=scene.newState;document.querySelector('#metrics').textContent='该视口开局区域几何（不是本场景的完整视觉验收）：\\n'+scene.geometry.regions.map(row=>row.name+'：'+row.count+'个；最大边界差 '+row.maxBoundaryDelta.toFixed(2)+' px').join('\\n');await Promise.all([load(old,scene.oldImage),load(current,scene.newImage)]);if(token!==revision)return;canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.drawImage(old,0,0);const a=ctx.getImageData(0,0,width,height);ctx.clearRect(0,0,width,height);ctx.drawImage(current,0,0);const b=ctx.getImageData(0,0,width,height);for(let index=0;index<a.data.length;index+=4){for(let c=0;c<3;c++)a.data[index+c]=Math.min(255,Math.abs(a.data[index+c]-b.data[index+c])*4);a.data[index+3]=255}ctx.putImageData(a,0,0);divide()}
select.onchange=update;split.oninput=divide;document.querySelector('#show-diff').onclick=e=>{diff=!diff;canvas.style.display=diff?'block':'none';e.target.textContent=diff?'返回拖动对照':'显示像素差异'};document.querySelector('#download').onclick=()=>{const a=document.createElement('a');a.download='xingbei-difference.png';a.href=canvas.toDataURL();a.click()};update();
</script></html>`);
console.log(`Wrote comparison viewer with ${scenes.length} pairs and ${measurements.length} viewport measurements`);
