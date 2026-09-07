// Clean-room GSM 06.10 full-rate decoder for Microsoft WAV format tag 0x0031.
// Runtime dependency: none. Implements the ETSI RPE-LTP decoder pipeline.

const B=[0,0,0,2048,-2560,94,-1792,-341,-1144];
const MIC=[0,-32,-32,-16,-16,-8,-8,-4,-4];
const INVA=[0,13107,13107,13107,13107,19223,17476,31454,29708];
const QLB=[3277,11469,21299,32767];
const FAC=[18431,20479,22527,24575,26623,28671,30719,32767];
const LAR_WIDTHS=[6,6,5,5,4,4,3,3];

function sat16(v){return v>32767?32767:v<-32768?-32768:v|0}
function add(a,b){return sat16((a|0)+(b|0))}
function sub(a,b){return sat16((a|0)-(b|0))}
function abs16(a){a|=0;return a===-32768?32767:Math.abs(a)|0}
function multR(a,b){a|=0;b|=0;if(a===-32768&&b===-32768)return 32767;return ((a*b+16384)>>15)|0}
function shlSigned(v,n){v|=0;n|=0;if(n<0)return shrSigned(v,-n);n=Math.min(n,15);return sat16(v*(2**n))}
function shrSigned(v,n){v|=0;n|=0;if(n<0)return shlSigned(v,-n);n=Math.min(n,15);return v>>n}

function readField(bytes,state,width){
  let out=0;
  for(let i=0;i<width;i++){
    const p=state.bitPos++,bit=(bytes[p>>3]>>(p&7))&1;
    out|=bit<<i;
  }
  return out;
}
function readFrame(bytes,state){
  const lar=new Int16Array(9);
  for(let i=0;i<8;i++)lar[i+1]=readField(bytes,state,LAR_WIDTHS[i]);
  const subframes=[];
  for(let s=0;s<4;s++){
    const nC=readField(bytes,state,7),bC=readField(bytes,state,2),mC=readField(bytes,state,2),xmaxC=readField(bytes,state,6),xMc=new Uint8Array(13);
    for(let i=0;i<13;i++)xMc[i]=readField(bytes,state,3);
    subframes.push({nC,bC,mC,xmaxC,xMc});
  }
  return{lar,subframes};
}
export function unpackMsGsmBlock(bytes){
  if(!(bytes instanceof Uint8Array))bytes=new Uint8Array(bytes);
  if(bytes.byteLength<65)throw new Error("GSM 6.10 block 不完整（需要 65 bytes）");
  const state={bitPos:0},a=readFrame(bytes,state),b=readFrame(bytes,state);
  if(state.bitPos!==520)throw new Error("GSM 6.10 bitstream 長度異常");
  return[a,b];
}

function decodeLar(larC){
  const out=new Int16Array(9);
  for(let i=1;i<=8;i++){
    let t1=(add(larC[i],MIC[i])<<10)|0;
    const t2=(B[i]<<1)|0;
    t1=sub(t1,t2);
    t1=multR(INVA[i],t1);
    out[i]=add(t1,t1);
  }
  return out;
}
function interpolateLar(prev,curr,block){
  const out=new Int16Array(9);
  for(let i=1;i<=8;i++){
    if(block===0)out[i]=add(add(prev[i]>>2,curr[i]>>2),prev[i]>>1);
    else if(block===1)out[i]=add(prev[i]>>1,curr[i]>>1);
    else if(block===2)out[i]=add(add(prev[i]>>2,curr[i]>>2),curr[i]>>1);
    else out[i]=curr[i];
  }
  return out;
}
function larToRp(lar){
  const rp=new Int16Array(9);
  for(let i=1;i<=8;i++){
    let t=abs16(lar[i]);
    if(t<11059)t<<=1;
    else if(t<20070)t=add(t,11059);
    else t=add(t>>2,26112);
    rp[i]=lar[i]<0?sub(0,t):t;
  }
  return rp;
}
function rpeDecode(sf){
  let exp=0;
  if(sf.xmaxC>15)exp=sub(sf.xmaxC>>3,1);
  let mant=sub(sf.xmaxC,exp<<3);
  if(mant===0){exp=-4;mant=15}
  else{
    let itest=0;
    for(let i=0;i<3;i++){
      if(mant>7)itest=1;
      if(itest===0)mant=add(mant<<1,1);
      if(itest===0)exp=sub(exp,1);
    }
  }
  mant=sub(mant,8);
  const temp1=FAC[mant],temp2=sub(6,exp),temp3=shlSigned(1,sub(temp2,1));
  const erp=new Int16Array(40);
  for(let i=0;i<13;i++){
    let t=sub(sf.xMc[i]<<1,7);
    t=(t<<12)|0;
    t=multR(temp1,t);
    t=add(t,temp3);
    const pulse=shrSigned(t,temp2),idx=sf.mC+3*i;
    if(idx<40)erp[idx]=pulse;
  }
  return erp;
}

export class Gsm610Decoder{
  constructor(){this.reset()}
  reset(){this.nrp=40;this.drpHist=new Int16Array(120);this.larPrev=new Int16Array(9);this.v=new Int16Array(9);this.msr=0}
  ltSynthesis(sf,erp){
    let nr=sf.nC;if(nr<40||nr>120)nr=this.nrp;this.nrp=nr;
    const brp=QLB[sf.bC],drp=new Int16Array(40);
    for(let k=0;k<40;k++){
      const shifted=k-nr,past=shifted<0?this.drpHist[-shifted-1]:drp[shifted];
      drp[k]=add(erp[k],multR(brp,past));
    }
    const next=new Int16Array(120);
    for(let i=0;i<40;i++)next[i]=drp[39-i];
    next.set(this.drpHist.subarray(0,80),40);
    this.drpHist=next;
    return drp;
  }
  stSynthesis(drpFrame,larCurr){
    const sr=new Int16Array(160),windows=[[0,0,12],[1,13,26],[2,27,39],[3,40,159]];
    for(const [block,start,end] of windows){
      const rp=larToRp(interpolateLar(this.larPrev,larCurr,block));
      for(let k=start;k<=end;k++){
        let sri=drpFrame[k];
        for(let i=1;i<=8;i++){
          const r=rp[9-i],vPrev=this.v[8-i];
          sri=sub(sri,multR(r,vPrev));
          this.v[9-i]=add(vPrev,multR(r,sri));
        }
        sr[k]=sri;this.v[0]=sri;
      }
    }
    this.larPrev=new Int16Array(larCurr);
    return sr;
  }
  decodeFrame(frame){
    const larCurr=decodeLar(frame.lar),drpFrame=new Int16Array(160);
    for(let s=0;s<4;s++)drpFrame.set(this.ltSynthesis(frame.subframes[s],rpeDecode(frame.subframes[s])),s*40);
    const sr=this.stSynthesis(drpFrame,larCurr),out=new Int16Array(160);
    for(let k=0;k<160;k++){
      this.msr=add(sr[k],multR(this.msr,28180));
      const doubled=add(this.msr,this.msr);
      out[k]=(doubled>>3)<<3;
    }
    return out;
  }
  decodeMsBlock(bytes){
    const [a,b]=unpackMsGsmBlock(bytes),out=new Int16Array(320);
    out.set(this.decodeFrame(a),0);out.set(this.decodeFrame(b),160);return out;
  }
}

export function createGsm610Decoder(){return new Gsm610Decoder()}
export const GSM610_INFO=Object.freeze({formatTag:49,blockAlign:65,samplesPerBlock:320,sampleRate:8000,channels:1});
