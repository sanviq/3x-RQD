#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform sampler2D uPhoto;
uniform sampler2D uHeight;
uniform vec2 uRoadSize;
uniform vec2 uBounds;
uniform vec4 uWheel; // world x, world z, unsprung height, body attachment height
uniform float uYaw;
uniform float uRotation;
uniform float uShake;
uniform float uBody;
uniform float uMode;
uniform vec3 uEye;
uniform vec3 uTarget;
uniform float uRelief;
uniform float uGrid;
uniform vec2 uHeightRange;
const float PI=3.14159265359;
const vec3 SUN=vec3(-.48,.78,-.39);
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec3 world(vec3 p){float c=cos(uYaw),s=sin(uYaw);return vec3(uWheel.x+c*p.x+s*p.z,p.y,uWheel.y-s*p.x+c*p.z);}
float heightAt(vec2 xz){
  vec2 uv=vec2(xz.x/uRoadSize.x+.5,xz.y/uRoadSize.y);
  if(any(lessThan(uv,vec2(0)))||any(greaterThan(uv,vec2(1))))return -.10;
  vec2 rg=texture(uHeight,uv).rg;
  return mix(uHeightRange.x,uHeightRange.y,(rg.r*255.*256.+rg.g*255.)/65535.)*uRelief;
}
float roadHeight(vec3 p){return heightAt(world(p).xz);}
float box(vec3 p,vec3 b){vec3 q=abs(p)-b;return length(max(q,0.))+min(max(q.x,max(q.y,q.z)),0.);}
float capsule(vec3 p,vec3 a,vec3 b,float r){vec3 q=p-a,v=b-a;return length(q-v*clamp(dot(q,v)/dot(v,v),0.,1.))-r;}
float ringX(vec3 p,float radius,float halfWidth,float thickness){
  vec2 q=abs(vec2(p.x,length(p.yz)-radius))-vec2(halfWidth,thickness);
  return length(max(q,0.))+min(max(q.x,q.y),0.);
}
vec2 nearer(vec2 a,vec2 b){return a.x<b.x?a:b;}
vec2 wheelMap(vec3 pos){
  vec3 p=pos-vec3(0,uWheel.z,0);
  float r=length(p.yz),theta=atan(p.z,p.y)-uRotation;
  vec2 q=abs(vec2(p.x,r-.282))-vec2(.0875,.033);
  float rubber=length(max(q,0.))+min(max(q.x,q.y),0.)-.030;
  float longGroove=1.-smoothstep(.003,.006,min(abs(p.x),min(abs(p.x-.054),abs(p.x+.054))));
  float across=1.-smoothstep(.055,.10,abs(fract(theta*36./(2.*PI)+abs(p.x)*4.5)-.5));
  rubber+=(longGroove*.004+across*.003)*smoothstep(.31,.335,r);
  vec2 hit=vec2(rubber,1.);
  // Cast alloy rim, machined lip, ventilated brake rotor and ten split spokes.
  hit=nearer(hit,vec2(ringX(p-vec3(.091,0,0),.214,.021,.008),2.));
  hit=nearer(hit,vec2(ringX(p-vec3(.10,0,0),.199,.005,.005),2.));
  hit=nearer(hit,vec2(max(abs(p.x+.025)-.065,abs(r-.206)-.006),7.));
  hit=nearer(hit,vec2(max(abs(p.x-.065)-.005,r-.178),3.));
  hit=nearer(hit,vec2(max(abs(p.x-.125)-.023,r-.049),2.));
  for(int i=0;i<5;i++){
    float a=float(i)*2.*PI/5.+uRotation;
    for(int j=0;j<2;j++){
      float b=a+(float(j)*2.-1.)*.115;
      vec3 start=vec3(.129,cos(a)*.037,sin(a)*.037),end=vec3(.113,cos(b)*.204,sin(b)*.204);
      hit=nearer(hit,vec2(capsule(p,start,end,.0105),2.));
    }
    vec3 bolt=vec3(.153,cos(a)*.030,sin(a)*.030);
    hit=nearer(hit,vec2(length(p-bolt)-.006,9.));
  }
  // Fixed brake caliper, visible through the rotating spokes.
  hit=nearer(hit,vec2(box(p-vec3(.079,.045,-.145),vec3(.018,.064,.025))-.008,10.));
  float base=uWheel.z,top=uWheel.w-.20;
  vec3 strut=pos-vec3(-.04,0,-.28);
  float coilPitch=(top-base)/7.;
  float angle=atan(strut.z,strut.x);
  float turn=(strut.y-base)/coilPitch-angle/(2.*PI);
  float coilY=(fract(turn+.5)-.5)*coilPitch;
  float coil=length(vec2(length(strut.xz)-.058,coilY))-.0075;
  hit=nearer(hit,vec2(max(coil,max(base-pos.y,pos.y-top)),4.));
  hit=nearer(hit,vec2(capsule(pos,vec3(-.04,base-.08,-.28),vec3(-.04,top+.05,-.28),.019),6.));
  hit=nearer(hit,vec2(capsule(pos,vec3(-.04,base-.12,-.28),vec3(-.04,base+.13,-.28),.029),7.));
  hit=nearer(hit,vec2(capsule(pos,vec3(-.1,uWheel.z-.09,.02),vec3(-.56,uWheel.w-.46,.25),.022),7.));
  // Body-mounted wheel arch follows sprung mass, independently of the axle.
  vec3 arch=pos-vec3(-.008,uWheel.w-.53,0);
  float fender=max(ringX(arch,.456,.147,.021),-arch.y+.005);
  // Inspection opening exposes the real strut position behind the wheel.
  float opening=box(pos-vec3(.03,uWheel.w-.23,-.28),vec3(.28,.11,.11));
  fender=max(fender,-opening);
  hit=nearer(hit,vec2(fender,8.));
  float liner=max(ringX(arch+vec3(.075,0,0),.423,.19,.011),-arch.y);
  liner=max(liner,-opening);
  hit=nearer(hit,vec2(liner,7.));
  hit=nearer(hit,vec2(box(pos-vec3(-.04,top+.035,-.28),vec3(.085,.012,.07))-.006,7.));
  return hit;
}
vec3 wheelNormal(vec3 p){
  const vec2 e=vec2(.00065,0);
  return normalize(vec3(wheelMap(p+e.xyy).x-wheelMap(p-e.xyy).x,wheelMap(p+e.yxy).x-wheelMap(p-e.yxy).x,wheelMap(p+e.yyx).x-wheelMap(p-e.yyx).x));
}
float boundsHit(vec3 ro,vec3 rd){
  vec3 lo=vec3(-.7,min(uWheel.z-.37,uWheel.w-.55),-.53),hi=vec3(.2,uWheel.w+.09,.53);
  vec3 t0=(lo-ro)/rd,t1=(hi-ro)/rd;
  vec3 nearT=min(t0,t1),farT=max(t0,t1);
  float a=max(nearT.x,max(nearT.y,nearT.z)),b=min(farT.x,min(farT.y,farT.z));
  return b>=max(a,0.)?max(a,.02):-1.;
}
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p){return .55*noise(p)+.28*noise(p*2.1)+.13*noise(p*4.3);}
vec3 sky(vec3 d){
  vec3 c=mix(vec3(.77,.81,.82),vec3(.25,.40,.54),smoothstep(-.05,.8,d.y));
  c+=vec3(.8,.65,.43)*pow(max(dot(d,normalize(SUN)),0.),140.)*.5;
  float clouds=fbm(d.xz/max(.12,d.y)*1.8+vec2(4,1));
  c=mix(c,vec3(.82,.84,.84),smoothstep(.53,.72,clouds)*smoothstep(.05,.25,d.y)*.7);
  // Distant roadside planting provides an environment, never inferred scene geometry.
  float angle=atan(d.x,d.z),treeLine=.018+.038*fbm(vec2(angle*90.,3.))+.015*sin(angle*35.);
  float verge=1.-smoothstep(treeLine-.004,treeLine+.004,d.y);
  vec3 trees=mix(vec3(.17,.22,.19),vec3(.30,.34,.29),noise(vec2(angle*300.,d.y*200.)));
  c=mix(c,trees,verge*.8);
  return c;
}
float softShadow(vec3 p){
  float shade=1.;
  // Ground self-shadow from the same height field used for contact.
  for(int i=1;i<=9;i++){
    float t=float(i)*.105;
    vec3 q=p+SUN*t;
    shade=min(shade,clamp(1.+(q.y-roadHeight(q))/.04,0.,1.));
  }
  if(uMode>.5)return shade;
  // Contact/vehicle shadow falls onto the road, with no floating blob below the tire.
  vec3 q=p+SUN*max(0.,(uWheel.z-p.y)/SUN.y);
  float ellipse=pow(q.x/.21,2.)+pow(q.z/.40,2.);
  return shade*(1.-.76*exp(-ellipse*1.9));
}
void main(){
  vec2 screen=(2.*gl_FragCoord.xy-uResolution)/uResolution.y;
  vec3 ro=vec3(.86,.61+uBody+uShake,-.98),target=vec3(-.32,.18+uBody*.45,4.7);
  if(uMode>.5){ro=uEye;target=uTarget;}
  vec3 forward=normalize(target-ro),right=normalize(cross(vec3(0,1,0),forward)),up=cross(forward,right);
  vec3 rd=normalize(forward+right*screen.x*.63+up*screen.y*.63);
  vec3 studio=mix(vec3(.020,.033,.044),vec3(.048,.065,.076),clamp(screen.y*.28+.5,0.,1.));
  vec3 color=uMode>.5?studio:sky(rd);
  float roadT=10000.;
  if(rd.y<-.0001){
    float t=max(.02,(uBounds.y-ro.y)/rd.y);
    float endT=min(max(90.,uRoadSize.y*3.),(uBounds.x-.12-ro.y)/rd.y);
    for(int i=0;i<48;i++){
      if(t>endT)break;
      vec3 p=ro+rd*t;float gap=p.y-roadHeight(p);
      if(gap<.001){roadT=t;break;}
      t+=max(.006,gap/max(.02,-rd.y)*.72);
    }
    if(roadT<9999.){
      vec3 p=ro+rd*roadT,wp=world(p);
      vec2 uv=vec2(wp.x/uRoadSize.x+.5,1.-wp.z/uRoadSize.y);
      bool onRoad=uv.x>=0.&&uv.x<=1.&&uv.y>=0.&&uv.y<=1.;
      float e=.018;
      vec3 n=normalize(vec3(roadHeight(p-vec3(e,0,0))-roadHeight(p+vec3(e,0,0)),2.*e,roadHeight(p-vec3(0,0,e))-roadHeight(p+vec3(0,0,e))));
      float edge=abs(wp.x)-uRoadSize.x*.5;
      vec3 verge=mix(vec3(.12,.115,.10),vec3(.07,.095,.046),smoothstep(.05,.4,edge));
      verge*=.65+.7*noise(wp.xz*70.)+.2*noise(wp.xz*270.);
      vec3 albedo=onRoad?pow(texture(uPhoto,uv).rgb,vec3(2.2)):verge;
      if(onRoad&&uMode>.5&&uGrid>.5){
        vec2 grid=abs(fract(wp.xz+.5)-.5)/max(fwidth(wp.xz),vec2(.00001));
        float line=1.-clamp(min(grid.x,grid.y),0.,1.);albedo=mix(albedo,vec3(.55,.66,.67),line*.25);
      }
      float grit=hash(floor(wp.xz*1400.));
      albedo*=.92+grit*.16;
      float diffuse=max(0.,dot(n,SUN)),shadow=softShadow(p);
      float ao=clamp(1.+roadHeight(p)*1.5,.48,1.);
      color=albedo*(.42*ao+diffuse*.95*shadow);
      float spec=pow(max(dot(reflect(-SUN,n),-rd),0.),48.)*.035;
      color+=spec*shadow;
      float fog=1.-exp(-roadT*.012);
      if(uMode<.5)color=mix(color,sky(vec3(rd.x,.01,rd.z))*.66,fog);
      else if(!onRoad)color=studio;
    }
  }
  float t=uMode<.5?boundsHit(ro,rd):-1.;
  if(t>0.){
    for(int i=0;i<88;i++){
      if(t>min(roadT,5.))break;
      vec3 p=ro+rd*t;vec2 hit=wheelMap(p);
      if(hit.x<.00065){
        vec3 n=wheelNormal(p),reflection=reflect(rd,n),base=vec3(.018,.020,.022);
        float metal=0.,rough=.6;
        if(hit.y>1.5&&hit.y<2.5){base=vec3(.39,.42,.45);metal=.88;rough=.17;}
        if(hit.y>2.5&&hit.y<3.5){base=vec3(.12,.13,.14);metal=.7;rough=.38;
          float a=atan(p.z,p.y-uWheel.z)-uRotation;
          if(fract(a*20./(2.*PI))<.16&&length(vec2(p.y-uWheel.z,p.z))>.09)base*=.3;
        }
        if(hit.y>3.5&&hit.y<4.5){base=vec3(.30,.22,.065);metal=.65;rough=.24;}
        if(hit.y>5.5&&hit.y<6.5){base=vec3(.45,.48,.5);metal=.95;rough=.12;}
        if(hit.y>6.5&&hit.y<7.5){base=vec3(.026,.03,.033);metal=.4;}
        if(hit.y>7.5&&hit.y<8.5){base=vec3(.085,.125,.14);metal=.65;rough=.15;}
        if(hit.y>8.5&&hit.y<9.5){base=vec3(.58);metal=.95;rough=.1;}
        if(hit.y>9.5){base=vec3(.25,.09,.033);metal=.65;rough=.26;}
        float diffuse=max(dot(n,SUN),0.);
        float fresnel=pow(1.-max(dot(n,-rd),0.),5.);
        vec3 environment=sky(reflection);
        environment=mix(vec3(.06,.065,.06),environment,smoothstep(-.2,.45,reflection.y));
        float highlight=pow(max(dot(reflect(-SUN,n),-rd),0.),mix(24.,180.,1.-rough));
        float occlusion=1.;
        for(int a=1;a<=3;a++){float distance=float(a)*.013;occlusion-=max(0.,distance-wheelMap(p+n*distance).x)*3.5;}
        occlusion=clamp(occlusion,.35,1.);
        color=base*(.35*occlusion+diffuse*.8)*(1.-metal*.55);
        color+=environment*(metal*.64+fresnel*.18)+highlight*mix(.09,1.2,metal);
        if(hit.y<1.5){
          vec3 lp=p-vec3(0,uWheel.z,0);
          // Fine molded rubber grain and lettering bands remain locked to wheel rotation.
          float a=atan(lp.z,lp.y)-uRotation;
          float grain=hash(floor(vec2(a*160.,length(lp.yz)*1800.)));
          color*=.88+.22*grain;
          float band=1.-smoothstep(.0007,.0018,abs(length(lp.yz)-.27));
          color+=band*.012;
          float letters=step(.76,fract(a*22.))*step(.245,length(lp.yz))*step(length(lp.yz),.26)*step(.107,abs(lp.x));
          color+=letters*.009;
        }
        break;
      }
      t+=max(.0005,hit.x*.82);
    }
  }
  // Gentle filmic tone curve, gamma and lens vignette.
  color=vec3(1.)-exp(-color*1.45);
  color=pow(color,vec3(1./2.2));
  color*=1.-.13*pow(length(screen*vec2(.45,.65)),2.);
  fragColor=vec4(clamp(color,0.,1.),1.);
}
