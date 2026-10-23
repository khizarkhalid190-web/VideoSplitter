const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const https = require('https');
const { pipeline } = require('stream/promises');

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 850, minWidth: 900, minHeight: 650,
    backgroundColor: '#0b1120',
    title: 'VideoSplit Pro',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile('index.html');
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

ipcMain.handle('choose-video', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose a video',
    properties: ['openFile'],
    filters: [{ name: 'Video files', extensions: ['mp4','mov','webm','m4v','mkv','avi','wmv','mpeg','mpg'] }, { name: 'All files', extensions: ['*'] }]
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0], st = fs.statSync(file);
  return { path: file, name: path.basename(file), size: st.size };
});
ipcMain.handle('get-video-info', async (_e, filePath) => {
  const ff = await ensureFfmpeg();
  const result = await run(ff, ['-hide_banner','-i',filePath], true);
  const txt = result.stderr || '';
  const dm = txt.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const vm = txt.match(/(\d{2,5})x(\d{2,5})/);
  const duration = dm ? Number(dm[1])*3600 + Number(dm[2])*60 + Number(dm[3]) : 0;
  return { duration, width: vm ? Number(vm[1]) : null, height: vm ? Number(vm[2]) : null };
});
ipcMain.handle('split-video', async (event, payload) => {
  const { filePath, mode, seconds, parts, format, quality } = payload;
  const ff = await ensureFfmpeg();
  const info = await getInfo(ff, filePath);
  const duration = info.duration;
  if (!duration) throw new Error('Could not read video duration. Try an MP4/H.264 video.');
  let segments = [];
  if (mode === 'duration') {
    const sec = Number(seconds);
    if (!Number.isFinite(sec) || sec < 1) throw new Error('Clip duration must be at least 1 second.');
    for (let s = 0; s < duration; s += sec) segments.push([s, Math.min(duration, s + sec)]);
  } else {
    const n = Number(parts);
    if (!Number.isInteger(n) || n < 2 || n > 500) throw new Error('Choose between 2 and 500 parts.');
    for (let i = 0; i < n; i++) segments.push([duration*i/n, duration*(i+1)/n]);
  }
  const pick = await dialog.showOpenDialog(win, { title: 'Choose output folder', properties: ['openDirectory','createDirectory'] });
  if (pick.canceled || !pick.filePaths[0]) return { canceled: true };
  const outDir = pick.filePaths[0];
  const base = path.basename(filePath, path.extname(filePath)).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  const total = segments.length;
  for (let i=0;i<segments.length;i++) {
    const [start,end] = segments[i];
    const out = path.join(outDir, `${base}_part_${String(i+1).padStart(3,'0')}.${format}`);
    const args = ['-y','-hide_banner','-loglevel','error','-ss',String(start),'-i',filePath,'-t',String(end-start),'-map','0:v:0?','-map','0:a:0?','-sn','-dn'];
    if (format === 'mp4') {
      args.push('-c:v','libx264','-preset',quality==='fast'?'ultrafast':quality==='high'?'slow':'veryfast','-crf',quality==='high'?'18':quality==='fast'?'28':'23','-c:a','aac','-b:a','128k','-movflags','+faststart','-avoid_negative_ts','make_zero');
    } else {
      args.push('-c:v','libvpx-vp9','-deadline',quality==='fast'?'realtime':'good','-cpu-used',quality==='fast'?'8':quality==='high'?'2':'5','-crf',quality==='high'?'25':quality==='fast'?'38':'32','-b:v','0','-c:a','libopus');
    }
    args.push(out);
    await new Promise((resolve,reject) => {
      const child = spawn(ff, args, { windowsHide: true });
      let err = '';
      child.stderr.on('data', d => err += d.toString());
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`Failed on part ${i+1}: ${err.slice(-500)}`)));
    });
    event.sender.send('split-progress', { current: i+1, total, output: out });
  }
  return { count: total, outDir };
});
ipcMain.handle('open-folder', async (_e, p) => shell.openPath(p));
ipcMain.handle('download-engine', async () => {
  try { const p = await ensureFfmpeg(); return { ready: true, path: p }; }
  catch (e) { return { ready: false, error: e.message }; }
});
function run(ff, args, allowError=false) {
  return new Promise((resolve,reject) => {
    const child = spawn(ff, args, { windowsHide: true });
    let stdout='', stderr='';
    child.stdout.on('data', d=>stdout+=d.toString());
    child.stderr.on('data', d=>stderr+=d.toString());
    child.on('error', reject);
    child.on('close', code => {
      if (allowError || code===0) resolve({stdout,stderr,code});
      else reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}
async function getInfo(ff, filePath) {
  const r = await run(ff, ['-hide_banner','-i',filePath], true);
  const dm=(r.stderr||'').match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const vm=(r.stderr||'').match(/(\d{2,5})x(\d{2,5})/);
  return {duration:dm?Number(dm[1])*3600+Number(dm[2])*60+Number(dm[3]):0,width:vm?Number(vm[1]):null,height:vm?Number(vm[2]):null};
}
async function ensureFfmpeg() {
  const binDir = path.join(app.getPath('userData'), 'ffmpeg-bin');
  const exe = path.join(binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (fs.existsSync(exe)) return exe;
  fs.mkdirSync(binDir, { recursive: true });
  // Download a portable FFmpeg build for Windows. The source video is never uploaded.
  const url = process.platform === 'win32'
    ? 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
    : null;
  if (!url) throw new Error('Automatic FFmpeg setup is currently configured for Windows only.');
  const zipPath = path.join(binDir, 'ffmpeg.zip');
  await new Promise((resolve,reject) => {
    const get = u => https.get(u, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); get(res.headers.location); return; }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('FFmpeg download failed (HTTP '+res.statusCode+').')); return; }
      const out = fs.createWriteStream(zipPath);
      pipeline(res,out).then(resolve,reject);
    }).on('error',reject);
    get(url);
  });
  // Extract with PowerShell's built-in Expand-Archive on Windows.
  const extractDir = path.join(binDir, 'extract');
  fs.mkdirSync(extractDir, { recursive: true });
  await new Promise((resolve,reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-Command',`Expand-Archive -LiteralPath '${zipPath.replace(/'/g,"''")}' -DestinationPath '${extractDir.replace(/'/g,"''")}' -Force`], { windowsHide:true });
    let err=''; ps.stderr.on('data',d=>err+=d.toString()); ps.on('error',reject); ps.on('close',c=>c===0?resolve():reject(new Error('Could not extract FFmpeg: '+err)));
  });
  const findExe = dir => {
    for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      const full=path.join(dir,entry.name);
      if(entry.isDirectory()){const f=findExe(full);if(f)return f;}
      else if(entry.name.toLowerCase()==='ffmpeg.exe')return full;
    } return null;
  };
  const found=findExe(extractDir);
  if(!found)throw new Error('FFmpeg executable was not found in the downloaded archive.');
  fs.copyFileSync(found,exe);
  try { fs.rmSync(zipPath,{force:true}); fs.rmSync(extractDir,{recursive:true,force:true}); } catch {}
  return exe;
}
