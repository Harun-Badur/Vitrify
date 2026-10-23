const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const root = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'))).expo;
function read(p) { return PNG.sync.read(fs.readFileSync(path.join(root, p))); }
function assert(value, message) { if (!value) throw new Error(message); }
for (const [file, size, opaque] of [
  ['assets/icon.png',1024,true], ['assets/store/google-play-512.png',512,true],
  ['assets/store/app-store-1024.png',1024,true],
  ['assets/android-icon-foreground.png',1024,false],
  ['assets/android-icon-monochrome.png',1024,false],
]) {
  const p = read(file);
  assert(p.width === size && p.height === size, file + ' dimensions');
  for (let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const a=p.data[(y*size+x)*4+3];
    if(opaque) assert(a===255,file+' must be opaque');
    else if(a>4) assert(Math.hypot(x-size/2,y-size/2)<size*33/108,file+' safe circle');
  }
}
assert(config.scheme==='kabin','deep link scheme');
assert(config.ios.bundleIdentifier==='app.kabin.mobile','bundle ID');
assert(config.android.package==='com.kabin.app','Android package');
assert(config.extra.eas.projectId==='8ba7778a-ee4d-43b0-9594-74b6624a7af6','EAS ID');
assert(fs.readFileSync(path.join(root,'app/auth.tsx'),'utf8').includes('../assets/brand-logo.png'),'auth logo');
console.log('Branding asset dimensions, opacity, adaptive safe circle and app identity: PASS');

assert(require('crypto').createHash('sha256').update(fs.readFileSync(path.join(root,'assets/Vitrify Logosu.png'))).digest('hex')==='6ea66b242a03f7ea803ef737789a66ca7bf1404ac8c07b8afca4ced28b8cea85','original source SHA256');
