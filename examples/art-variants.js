// Original ribbon, three material studies. No external runtime or media.
const style = document.querySelector('script[data-style]').dataset.style;
const mode = ['indexed', 'phosphor', 'ember'].indexOf(style);
const canvas = document.querySelector('canvas');
const low = mode === 0;
canvas.width = low ? Math.round(innerWidth / 4) : innerWidth;
canvas.height = low ? Math.round(innerHeight / 4) : innerHeight;
const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true });
if (!gl) throw Error('WebGL unavailable');
const vs = `attribute vec2 uv;uniform float time,aspect;varying vec3 normal,world;varying vec2 coord;
vec3 shape(vec2 p){float u=p.x*6.2831853,v=p.y;float radius=1.45+.18*cos(3.*u);vec3 center=vec3(radius*cos(u),radius*sin(u),.40*sin(3.*u));vec3 across=normalize(vec3(cos(u)*cos(1.5*u),sin(u)*cos(1.5*u),sin(1.5*u)));return center+across*v*.63;}
vec3 turn(vec3 p){float a=time*6.2831853/6.;mat3 y=mat3(cos(a),0.,sin(a),0.,1.,0.,-sin(a),0.,cos(a));float b=.68;return mat3(1.,0.,0.,0.,cos(b),-sin(b),0.,sin(b),cos(b))*y*p;}
void main(){vec3 p=shape(uv);normal=normalize(turn(cross(shape(uv+vec2(.0001,0.))-p,shape(uv+vec2(0.,.0001))-p)));world=turn(p);coord=uv;float depth=5.-world.z;gl_Position=vec4(world.x*1.8/aspect,world.y*1.8,depth-2.,depth);}`;
const fs = `precision highp float;uniform float mode,time;varying vec3 normal,world;varying vec2 coord;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float bayer(vec2 p){vec2 a=mod(floor(p),4.);float v=0.;vec2 b=mod(a,2.);v=2.*b.x+3.*b.y-4.*b.x*b.y;a=floor(a/2.);v=4.*v+2.*a.x+3.*a.y-4.*a.x*a.y;return (v+.5)/16.;}
float line(float x,float w){return 1.-smoothstep(w,w+.10,abs(fract(x)-.5));}
void main(){vec3 n=normalize(normal);if(!gl_FrontFacing)n=-n;vec3 eye=normalize(vec3(0.,0.,5.)-world);float facing=abs(dot(n,eye));float light=dot(n,normalize(vec3(-1.2,2.,3.)))*.5+.5;
if(mode<.5){
 float tone=clamp(.1+light*.54+pow(1.-facing,2.)*.28+pow(max(dot(reflect(-normalize(vec3(-1.,2.,3.)),n),eye),0.),18.)*.28,0.,.99);
 float level=floor(tone*3.+bayer(gl_FragCoord.xy)*.85);
 vec3 c=vec3(.16,.10,.28);if(level>.5)c=vec3(.46,.24,.60);if(level>1.5)c=vec3(.95,.43,.28);if(level>2.5)c=vec3(1.,.88,.57);
 gl_FragColor=vec4(c,1.);
}else if(mode<1.5){
 float contours=line(coord.y*14.,.035);
 float longitudinal=line(coord.x*40.,.015);
 float weave=max(contours,longitudinal*.28);
 float edge=pow(1.-facing,3.)*.25;
 float pulse=pow(.5+.5*cos(coord.x*6.2831853-time*6.2831853/6.),18.);
 vec3 c=vec3(.48,1.,.14)*(weave*(.25+light*.5)+weave*pulse*.5+edge*.22);
 c+=vec3(.025,.04,.008)*light;
 gl_FragColor=vec4(c,1.);
}else{
 // Closely packed etched contours, broken into a fixed stipple screen.
 float bands=line(coord.y*14.+sin(coord.x*6.2831853*3.)*.8,.025);
 vec2 grid=vec2(coord.x*240.,coord.y*48.);vec2 cell=floor(grid);
 float grain=hash(cell);vec2 delta=fract(grid)-.5;float dots=exp(-dot(delta,delta)*(22.+grain*55.))*step(.28,grain);
 float ridge=pow(1.-facing,2.5);
 float brightness=bands*.045+dots*(.25+light*.65)+ridge*.025;
 float hot=pow(.5+.5*sin(coord.x*6.2831853*2.-time*6.2831853/6.),8.);
 vec3 c=mix(vec3(.65,.035,.09),vec3(1.,.49,.12),hot)*brightness;
 c+=vec3(1.,.8,.45)*pow(brightness,3.)*.7;c*=3.2;
 gl_FragColor=vec4(c,1.);
}}
`;
const postVS = `attribute vec2 p;varying vec2 q;void main(){q=p*.5+.5;gl_Position=vec4(p,0.,1.);}`;
const postFS = `precision highp float;uniform sampler2D image;uniform vec2 resolution;uniform float mode;varying vec2 q;
vec3 sampleAt(vec2 p){return texture2D(image,clamp(p,0.,1.)).rgb;}
void main(){vec3 c=sampleAt(q);vec2 uv=q-.5;
if(mode<.5){gl_FragColor=vec4(c,1.);return;}
vec3 blur=vec3(0.);float total=0.;
for(int i=-4;i<=4;i++)for(int j=-4;j<=4;j++){vec2 off=vec2(float(i),float(j));float w=exp(-dot(off,off)/8.);blur+=sampleAt(q+off*3./resolution)*w;total+=w;}
blur/=total;
vec3 bg=mode<1.5?vec3(.014,.022,.010):vec3(.027,.009,.026);
bg+=mode<1.5?vec3(.018,.025,.006)*exp(-dot(uv,uv)*6.):vec3(.025,.008,.016)*exp(-dot(uv,uv)*4.);
c+=blur*(mode<1.5?1.5:2.4);c+=bg;
if(mode<1.5){float scan=.95+.05*cos(q.y*resolution.y*3.14159);c*=scan;}
float vignette=1.-.45*dot(uv,uv);c*=vignette;
c=1.-exp(-c*1.8);gl_FragColor=vec4(pow(c,vec3(.85)),1.);
}`;
function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
function program(v,f){const p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,v));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,f));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;}
const art=program(vs,fs),post=program(postVS,postFS);
const points=[];for(let i=0;i<512;i++)for(let j=0;j<32;j++){const a=[i/512,j/16-1],b=[(i+1)/512,j/16-1],c=[i/512,(j+1)/16-1],d=[(i+1)/512,(j+1)/16-1];points.push(...a,...b,...c,...c,...b,...d);}
function buffer(data){const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);return b;}
const mesh=buffer(points),quad=buffer([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]);
const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,canvas.width,canvas.height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
const depth=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,canvas.width,canvas.height);
const target=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,target);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Framebuffer incomplete');
function bind(p,b,name){gl.useProgram(p);gl.bindBuffer(gl.ARRAY_BUFFER,b);const a=gl.getAttribLocation(p,name);gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);}
window.__demoRender=t=>{
 gl.viewport(0,0,canvas.width,canvas.height);gl.bindFramebuffer(gl.FRAMEBUFFER,target);gl.enable(gl.DEPTH_TEST);
 if(low)gl.clearColor(.065,.037,.11,1.);else gl.clearColor(0.,0.,0.,1.);
 gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);bind(art,mesh,'uv');gl.uniform1f(gl.getUniformLocation(art,'time'),t);gl.uniform1f(gl.getUniformLocation(art,'aspect'),canvas.width/canvas.height);gl.uniform1f(gl.getUniformLocation(art,'mode'),mode);gl.drawArrays(gl.TRIANGLES,0,points.length/2);
 gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.disable(gl.DEPTH_TEST);bind(post,quad,'p');gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(gl.getUniformLocation(post,'image'),0);gl.uniform2f(gl.getUniformLocation(post,'resolution'),canvas.width,canvas.height);gl.uniform1f(gl.getUniformLocation(post,'mode'),mode);gl.drawArrays(gl.TRIANGLES,0,6);gl.finish();
};
if(!window.__recorderStep){const tick=t=>{window.__demoRender(t/1000);requestAnimationFrame(tick)};requestAnimationFrame(tick);}
