// Deterministic PNG derivatives; never writes the source. Area resampling averages
// premultiplied pixels to avoid halos. No generative redraw or JPEG intermediates.
const fs=require('fs'), path=require('path'), crypto=require('crypto');
const {PNG}=require('pngjs');
const root=path.join(__dirname,'..'), assets=path.join(root,'assets');
const sourcePath=path.join(assets,'Vitrify Logosu.png');
const hash=()=>crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
const before=hash(), source=PNG.sync.read(fs.readFileSync(sourcePath));
function resize(src,w,h) {
  const out=new PNG({width:w,height:h});
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const x0=x*src.width/w,x1=(x+1)*src.width/w,y0=y*src.height/h,y1=(y+1)*src.height/h;
    let alpha=0,red=0,green=0,blue=0;
    for(let sy=Math.floor(y0);sy<Math.ceil(y1);sy++) for(let sx=Math.floor(x0);sx<Math.ceil(x1);sx++) {
      const weight=(Math.min(x1,sx+1)-Math.max(x0,sx))*(Math.min(y1,sy+1)-Math.max(y0,sy));
      const i=(sy*src.width+sx)*4, a=src.data[i+3]/255*weight;
      alpha+=a;red+=src.data[i]*a;green+=src.data[i+1]*a;blue+=src.data[i+2]*a;
    }
    const i=(y*w+x)*4;
    if(alpha) {out.data[i]=Math.round(red/alpha);out.data[i+1]=Math.round(green/alpha);out.data[i+2]=Math.round(blue/alpha);}
    out.data[i+3]=Math.round(alpha/((x1-x0)*(y1-y0))*255);
  }
  return out;
}
function save(name,png) {const p=path.join(assets,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,PNG.sync.write(png));}
function crop(src,x,y,w,h) {const out=new PNG({width:w,height:h});PNG.bitblt(src,out,x,y,w,h,0,0);return out;}
// The source is a flattened red/white image. Extract only its white lettering
// as an alpha silhouette for platform-mandated monochrome layers.
const mask=new PNG({width:source.width,height:source.height});
let left=source.width,top=source.height,right=0,bottom=0;
for(let i=0;i<source.data.length;i+=4){
 const a=Math.max(0,Math.min(255,Math.round((Math.min(source.data[i+1],source.data[i+2])-100)*255/155)));
 mask.data[i]=mask.data[i+1]=mask.data[i+2]=255;mask.data[i+3]=a;
 if(a>4){const px=(i/4)%source.width,py=Math.floor(i/4/source.width);left=Math.min(left,px);right=Math.max(right,px);top=Math.min(top,py);bottom=Math.max(bottom,py);}
}
const lettering=crop(mask,left,top,right-left+1,bottom-top+1);
// Entire lettering rectangle diagonal stays inside the 66/108 safe circle.
const scale=590/Math.hypot(lettering.width,lettering.height);
const small=resize(lettering,Math.round(lettering.width*scale),Math.round(lettering.height*scale));
const adaptive=new PNG({width:1024,height:1024});
PNG.bitblt(small,adaptive,0,0,small.width,small.height,Math.floor((1024-small.width)/2),Math.floor((1024-small.height)/2));
save('android-icon-foreground.png',adaptive);save('android-icon-monochrome.png',adaptive);
save('notification-icon.png',adaptive);save('splash-icon.png',adaptive);
const icon=resize(source,1024,1024);save('icon.png',icon);save('store/app-store-1024.png',icon);
save('store/google-play-512.png',resize(source,512,512));save('favicon.png',resize(source,64,64));
const margin=50;
const brand=crop(source,Math.max(0,left-margin),Math.max(0,top-margin),right-left+1+margin*2,bottom-top+1+margin*2);
save('brand-logo.png',resize(brand,800,Math.round(brand.height*800/brand.width)));
if(before!==hash()) throw new Error('Source changed');
console.log('Generated PNGs; source SHA256 unchanged:',before);
// Review sheet: columns 48, 64, 96, 128 px; top standard, bottom circle mask.
const sheet=new PNG({width:560,height:320});sheet.data.fill(247);
for(let i=3;i<sheet.data.length;i+=4)sheet.data[i]=255;
let column=20;
for(const size of [48,64,96,128]) {
 const normal=resize(source,size,size), fg=resize(adaptive,size,size);
 PNG.bitblt(normal,sheet,0,0,size,size,column,20);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
  if(Math.hypot(x-size/2,y-size/2)>size/2)continue;
  const i=(y*size+x)*4,j=((y+170)*sheet.width+column+x)*4,a=fg.data[i+3]/255;
  for(let c=0;c<3;c++)sheet.data[j+c]=Math.round([254,56,43][c]*(1-a)+fg.data[i+c]*a);
 }
 column+=size+30;
}
save('store/branding-preview.png',sheet);
