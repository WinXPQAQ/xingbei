export function saveInabilityArchive(archive) {
  const filename=`xingbei-inability-${Date.now()}.json`, text=JSON.stringify(archive,null,2);
  try { localStorage.setItem(filename,text); } catch(error) { console.warn('判负档案本地缓存失败，改为下载',error); }
  const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=filename;
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
