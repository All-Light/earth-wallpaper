import { spawnSync } from 'node:child_process';
import { access, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const contents = join(root, 'plasma/org.kde.plasma.earth/contents');
const qsbCandidates = [process.env.QSB, join(root, 'work/native-tools/root/usr/lib/qt6/bin/qsb'), '/usr/lib/qt6/bin/qsb'].filter(Boolean);
let qsb;
for (const candidate of qsbCandidates) try { await access(candidate, constants.X_OK); qsb = candidate; break; } catch {}
if (!qsb) throw new Error('Qt Shader Baker (qsb) not found. Set QSB=/path/to/qsb or place it in work/native-tools/root/usr/lib/qt6/bin.');
const esbuild = join(root, 'node_modules/esbuild/bin/esbuild');
await access(esbuild, constants.X_OK);
for (const dir of ['shaders','images','code']) await mkdir(join(contents, dir), {recursive:true});
function run(command, args) {
  const result=spawnSync(command,args,{cwd:root,stdio:'inherit'});
  if(result.error) throw result.error;
  if(result.status!==0) throw new Error(`${command} failed with exit code ${result.status}`);
}
run(qsb,['-b','--glsl','300 es,150','-o',join(contents,'shaders/earth.vert.qsb'),'native/earth.vert']);
run(qsb,['-b','--glsl','300 es,150','-o',join(contents,'shaders/earth.frag.qsb'),'native/earth.frag']);
const bundledMath=join(contents,'code/EarthMath.js');
run(esbuild,['native/astronomy-entry.js','--bundle','--format=iife','--global-name=EarthNative','--platform=browser','--target=es2016',`--outfile=${bundledMath}`]);
await writeFile(bundledMath,'.pragma library\n'+await readFile(bundledMath,'utf8'));
const py = String.raw`from PIL import Image
from pathlib import Path
src=Path(r'''${join(root,'public/assets')}''')
out=Path(r'''${join(contents,'images')}''')
for name,limit in [('earth.jpg',(4096,2048)),('earth-night.jpg',(2048,1024)),('ocean-mask.jpg',(2048,1024)),('clouds-alpha.png',(4096,2048)),('moon.jpg',(1024,512))]:
 im=Image.open(src/name)
 im.thumbnail(limit,Image.Resampling.LANCZOS)
 target=out/name
 if target.suffix=='.png': im.save(target,optimize=True)
 else: im.save(target,quality=88,optimize=True,progressive=True)
 print(f'{name}: {im.width}x{im.height} -> {target.stat().st_size} bytes')`;
run('python3',['-c',py]);
const shaders=await Promise.all(['earth.vert.qsb','earth.frag.qsb'].map(async name=>({name,size:(await readFile(join(contents,'shaders',name))).length})));
console.log(JSON.stringify({qsb,shaders,js:join(contents,'code/EarthMath.js'),images:join(contents,'images')},null,2));
